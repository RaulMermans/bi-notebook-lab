import type { Dataset } from '../domain/data'
import type { SemanticModel } from '../domain/model'
import { resolveColumnRef, resolveTableRef } from '../runtime/model/modelRuntime'
import type { BinaryOperator } from './ast'
import type { BoundExpression } from './binder'
import { buildRelatedIndex, resolveManySideColumn, resolveOneSideTable } from './relatedLookup'
import type { RowContext } from './rowContext'
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
  relatedIndexCache: Map<string, Map<unknown, Record<string, unknown>>>
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

function getRelatedIndex(ctx: EvalContext, relationshipId: string): Map<unknown, Record<string, unknown>> | undefined {
  const cached = ctx.relatedIndexCache.get(relationshipId)
  if (cached) return cached

  const relationship = ctx.model.relationships.find((r) => r.id === relationshipId)
  if (!relationship) return undefined
  const oneSide = resolveOneSideTable(ctx.datasets, relationship)
  if (!oneSide) return undefined

  const index = buildRelatedIndex(oneSide.table, oneSide.column)
  ctx.relatedIndexCache.set(relationshipId, index)
  return index
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
      const manyColumn = relationship ? resolveManySideColumn(ctx.datasets, relationship) : undefined
      if (!relationship || !manyColumn) {
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

      const foreignKeyValue = rowContext.row[manyColumn.name] ?? null
      const index = getRelatedIndex(ctx, node.relationshipId)
      const matchedRow = foreignKeyValue !== null && index ? index.get(foreignKeyValue) : undefined
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
