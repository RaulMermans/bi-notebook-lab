import type { Dataset } from '../domain/data'
import type { SemanticModel } from '../domain/model'
import { resolveColumnRef, resolveTableRef } from '../runtime/model/modelRuntime'
import type { BinaryOperator } from './ast'
import type { BoundExpression } from './binder'
import { buildRelatedIndex, resolveRelatedIndexAndKey } from './relatedLookup'
import type { RowContext } from './rowContext'
import { compareScalarValues } from './scalarComparison'
import type { ExecutionTraceNode } from './trace'

export type RowEvaluationErrorCode = 'TYPE_MISMATCH' | 'DIVISION_ERROR'

export interface RowEvaluationError {
  rowIndex: number
  code: RowEvaluationErrorCode
  message: string
}

/**
 * Per-evaluation execution context. `relatedIndexCache` is built lazily and
 * reused across every row in a single evaluation pass, so a calculated
 * column with `RELATED` stays O(n) instead of re-scanning the one-side
 * table per row (see docs/CALCULATED_COLUMNS.md "RELATED lookup index").
 */
export interface EvalContext {
  model: SemanticModel
  datasets: Record<string, Dataset>
  relatedIndexCache: Map<string, { index: Map<unknown, Record<string, unknown>>; keyColumnName: string }>
}

export function createEvalContext(model: SemanticModel, datasets: Record<string, Dataset>): EvalContext {
  return { model, datasets, relatedIndexCache: new Map() }
}

interface NodeResult {
  value: unknown
  trace: ExecutionTraceNode
  error?: RowEvaluationError
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value)
}

function runtimeTypeLabel(value: unknown): string {
  if (value === null || value === undefined) return 'blank'
  return typeof value
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'BLANK'
  return String(value)
}

function columnNameOf(ctx: EvalContext, ref: { datasetId: string; tableId: string; columnId: string }): string {
  return resolveColumnRef(ctx.datasets, ref)?.column.name ?? ref.columnId
}

function getRelatedIndex(
  ctx: EvalContext,
  relationshipId: string,
  targetColumnRef: { datasetId: string; tableId: string; columnId: string },
): { index: Map<unknown, Record<string, unknown>>; keyColumnName: string } | undefined {
  const cacheKey = `${relationshipId}:${targetColumnRef.datasetId}:${targetColumnRef.tableId}`
  const cached = ctx.relatedIndexCache.get(cacheKey)
  if (cached) return cached

  const relationship = ctx.model.relationships.find((r) => r.id === relationshipId)
  if (!relationship) return undefined
  const resolved = resolveRelatedIndexAndKey(ctx.datasets, relationship, targetColumnRef)
  if (!resolved) return undefined

  const index = buildRelatedIndex(resolved.indexTable, resolved.indexColumn)
  const result = { index, keyColumnName: resolved.keyColumn.name }
  ctx.relatedIndexCache.set(cacheKey, result)
  return result
}

function applyBinary(operator: BinaryOperator, left: number, right: number): number {
  switch (operator) {
    case '+':
      return left + right
    case '-':
      return left - right
    case '*':
      return left * right
    case '/':
      return left / right
  }
}

/** Evaluates one bound expression against one row context. Pure — no I/O, no mutation of `ctx` beyond the related-index cache. */
function evaluateNode(node: BoundExpression, rowContext: RowContext, ctx: EvalContext, rowIndex: number): NodeResult {
  switch (node.kind) {
    case 'Literal':
      return { value: node.value, trace: { kind: 'literal', label: formatValue(node.value), value: node.value } }

    case 'ColumnReference': {
      const name = columnNameOf(ctx, node.ref)
      const value = rowContext.row[name] ?? null
      return { value, trace: { kind: 'column-read', label: node.label, value } }
    }

    case 'Unary': {
      const operand = evaluateNode(node.operand, rowContext, ctx, rowIndex)
      let value: unknown = null
      let error = operand.error

      if (!error) {
        if (operand.value === null) {
          value = null
        } else if (!isNumber(operand.value)) {
          error = { rowIndex, code: 'TYPE_MISMATCH', message: `Cannot negate a ${runtimeTypeLabel(operand.value)} value.` }
        } else {
          value = -operand.value
        }
      }

      return {
        value,
        error,
        trace: { kind: 'unary-operation', label: `-(${formatValue(operand.value)})`, value, children: [operand.trace] },
      }
    }

    case 'Binary': {
      const left = evaluateNode(node.left, rowContext, ctx, rowIndex)
      const right = evaluateNode(node.right, rowContext, ctx, rowIndex)
      const children = [left.trace, right.trace]
      let value: unknown = null
      let error = left.error ?? right.error

      if (!error) {
        if (left.value === null || right.value === null) {
          value = null
        } else if (!isNumber(left.value) || !isNumber(right.value)) {
          error = {
            rowIndex,
            code: 'TYPE_MISMATCH',
            message: `Cannot use operator "${node.operator}" with a ${runtimeTypeLabel(left.value)} and a ${runtimeTypeLabel(right.value)} value.`,
          }
        } else if (node.operator === '/' && right.value === 0) {
          error = { rowIndex, code: 'DIVISION_ERROR', message: 'Division by zero.' }
        } else {
          value = applyBinary(node.operator, left.value, right.value)
        }
      }

      return {
        value,
        error,
        trace: {
          kind: 'binary-operation',
          label: `${formatValue(left.value)} ${node.operator} ${formatValue(right.value)}`,
          value,
          children,
        },
      }
    }

    case 'Related': {
      const relationship = ctx.model.relationships.find((r) => r.id === node.relationshipId)
      const resolved = relationship ? getRelatedIndex(ctx, node.relationshipId, node.targetColumnRef) : undefined
      if (!relationship || !resolved) {
        return {
          value: null,
          trace: {
            kind: 'related-lookup',
            label: node.label,
            value: null,
            metadata: { matched: false, reason: 'relationship no longer available' },
          },
        }
      }

      const foreignKeyValue = rowContext.row[resolved.keyColumnName] ?? null
      const matchedRow = foreignKeyValue !== null ? resolved.index.get(foreignKeyValue) : undefined
      const value = matchedRow ? (matchedRow[columnNameOf(ctx, node.targetColumnRef)] ?? null) : null

      return {
        value,
        trace: {
          kind: 'related-lookup',
          label: node.label,
          value,
          metadata: { matched: Boolean(matchedRow), foreignKeyValue, relationshipId: node.relationshipId },
        },
      }
    }

    case 'Comparison': {
      const left = evaluateNode(node.left, rowContext, ctx, rowIndex)
      const right = evaluateNode(node.right, rowContext, ctx, rowIndex)
      const error = left.error ?? right.error
      const value = error ? null : compareScalarValues(node.operator, left.value, right.value)
      return {
        value,
        error,
        trace: {
          kind: 'binary-operation',
          label: `${formatValue(left.value)} ${node.operator} ${formatValue(right.value)}`,
          value,
          children: [left.trace, right.trace],
        },
      }
    }

    case 'Logical': {
      const left = evaluateNode(node.left, rowContext, ctx, rowIndex)
      if (!left.error) {
        if (node.operator === '&&' && left.value === false) {
          return { value: false, trace: { kind: 'binary-operation', label: `${formatValue(left.value)} && ⋯`, value: false, children: [left.trace] } }
        }
        if (node.operator === '||' && left.value === true) {
          return { value: true, trace: { kind: 'binary-operation', label: `${formatValue(left.value)} || ⋯`, value: true, children: [left.trace] } }
        }
      }
      const right = evaluateNode(node.right, rowContext, ctx, rowIndex)
      const error = left.error ?? right.error
      const value = error ? null : node.operator === '&&' ? Boolean(left.value) && Boolean(right.value) : Boolean(left.value) || Boolean(right.value)
      return {
        value,
        error,
        trace: {
          kind: 'binary-operation',
          label: `${formatValue(left.value)} ${node.operator} ${formatValue(right.value)}`,
          value,
          children: [left.trace, right.trace],
        },
      }
    }

    case 'If': {
      const condition = evaluateNode(node.condition, rowContext, ctx, rowIndex)
      if (condition.error) {
        return { value: null, error: condition.error, trace: { kind: 'conditional', label: 'IF', value: null, children: [condition.trace] } }
      }
      if (typeof condition.value !== 'boolean') {
        return {
          value: null,
          error: { rowIndex, code: 'TYPE_MISMATCH', message: "IF's condition must evaluate to TRUE or FALSE." },
          trace: { kind: 'conditional', label: 'IF', value: null, children: [condition.trace] },
        }
      }
      if (condition.value) {
        const branch = evaluateNode(node.whenTrue, rowContext, ctx, rowIndex)
        return { value: branch.value, error: branch.error, trace: { kind: 'conditional', label: 'IF → true', value: branch.value, children: [condition.trace, branch.trace] } }
      }
      if (!node.whenFalse) {
        return { value: null, trace: { kind: 'conditional', label: 'IF → false (no branch, BLANK)', value: null, children: [condition.trace] } }
      }
      const branch = evaluateNode(node.whenFalse, rowContext, ctx, rowIndex)
      return { value: branch.value, error: branch.error, trace: { kind: 'conditional', label: 'IF → false', value: branch.value, children: [condition.trace, branch.trace] } }
    }

    case 'Switch': {
      const switchValue = evaluateNode(node.expression, rowContext, ctx, rowIndex)
      if (switchValue.error) {
        return { value: null, error: switchValue.error, trace: { kind: 'conditional', label: 'SWITCH', value: null, children: [switchValue.trace] } }
      }
      for (const branchCase of node.cases) {
        const caseValue = evaluateNode(branchCase.value, rowContext, ctx, rowIndex)
        if (caseValue.error) {
          return { value: null, error: caseValue.error, trace: { kind: 'conditional', label: 'SWITCH', value: null, children: [switchValue.trace, caseValue.trace] } }
        }
        if (compareScalarValues('=', switchValue.value, caseValue.value)) {
          const result = evaluateNode(branchCase.result, rowContext, ctx, rowIndex)
          return {
            value: result.value,
            error: result.error,
            trace: {
              kind: 'switch-case',
              label: `SWITCH matched ${formatValue(caseValue.value)}`,
              value: result.value,
              children: [switchValue.trace, caseValue.trace, result.trace],
            },
          }
        }
      }
      if (node.defaultResult) {
        const result = evaluateNode(node.defaultResult, rowContext, ctx, rowIndex)
        return { value: result.value, error: result.error, trace: { kind: 'switch-case', label: 'SWITCH default', value: result.value, children: [switchValue.trace, result.trace] } }
      }
      return { value: null, trace: { kind: 'switch-case', label: 'SWITCH (no match, BLANK)', value: null, children: [switchValue.trace] } }
    }

    case 'Blank':
      return { value: null, trace: { kind: 'literal', label: 'BLANK', value: null } }
  }
}

export interface RowTrace {
  rowIndex: number
  trace: ExecutionTraceNode
}

export interface EvaluateBoundExpressionResult {
  values: unknown[]
  errors: RowEvaluationError[]
  previewTraces: RowTrace[]
}

/** Full row-context traces are only kept for this many leading rows — see docs/CALCULATED_COLUMNS.md "Performance". */
export const DEFAULT_PREVIEW_LIMIT = 100

/** Evaluates a bound expression once per row of its target table. */
export function evaluateBoundExpressionOverTable(
  bound: BoundExpression,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  modelTableId: string,
  previewLimit: number = DEFAULT_PREVIEW_LIMIT,
): EvaluateBoundExpressionResult {
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  if (!resolved) return { values: [], errors: [], previewTraces: [] }

  const ctx = createEvalContext(model, datasets)
  const values: unknown[] = []
  const errors: RowEvaluationError[] = []
  const previewTraces: RowTrace[] = []

  resolved.table.rows.forEach((row, rowIndex) => {
    const rowContext: RowContext = { modelId: model.id, modelTableId, rowIndex, row }
    const result = evaluateNode(bound, rowContext, ctx, rowIndex)
    values.push(result.value)
    if (result.error) errors.push(result.error)
    if (rowIndex < previewLimit) {
      previewTraces.push({ rowIndex, trace: { kind: 'result', label: 'Result', value: result.value, children: [result.trace] } })
    }
  })

  return { values, errors, previewTraces }
}

/** Re-evaluates a single row on demand (for the row-context visualizer). */
export function evaluateSingleRow(
  bound: BoundExpression,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  modelTableId: string,
  rowIndex: number,
): { value: unknown; trace: ExecutionTraceNode; error?: RowEvaluationError } | undefined {
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  const row = resolved?.table.rows[rowIndex]
  if (!resolved || !row) return undefined

  const ctx = createEvalContext(model, datasets)
  const rowContext: RowContext = { modelId: model.id, modelTableId, rowIndex, row }
  const result = evaluateNode(bound, rowContext, ctx, rowIndex)
  return { value: result.value, error: result.error, trace: { kind: 'result', label: 'Result', value: result.value, children: [result.trace] } }
}
