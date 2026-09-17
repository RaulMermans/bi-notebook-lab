import type { DataType, Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import { diagnostic, type ExpressionDiagnostic } from '../../expression/diagnostics'
import type { BinaryOperator } from '../../expression/ast'
import { bindMeasureExpression, type BoundMeasureExpression } from '../../expression/measureBinder'
import { parseExpression } from '../../expression/parser'
import type { ExecutionTraceNode } from '../../expression/trace'
import { computeAggregation, computeCountRows } from './aggregation'
import { EMPTY_FILTER_CONTEXT, type FilterContext } from './filterContext'
import { resolveFilterContext, selectionSize, visibleRowIndices, type ResolvedFilterState } from './filterPropagation'
import { getLogicalColumnValues, type LogicalColumnRef } from './logicalColumn'
import { resolveTableRef } from '../model/modelRuntime'

export interface MeasureExecution {
  measureId: string
  value: unknown
  dataType: DataType | 'unknown'
  diagnostics: ExpressionDiagnostic[]
  trace?: ExecutionTraceNode
  filterState?: ResolvedFilterState
}

interface NodeResult {
  value: unknown
  trace: ExecutionTraceNode
  diagnostics: ExpressionDiagnostic[]
}

interface MeasureEvalContext {
  model: SemanticModel
  datasets: Record<string, Dataset>
  filterState: ResolvedFilterState
  /** Per-evaluation cache so a measure referenced by several other measures is only computed once (docs/MEASURES.md "Measure reference trace"). */
  cache: Map<string, NodeResult>
  visiting: Set<string>
  columnValuesCache: Map<string, unknown[]>
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'BLANK'
  return String(value)
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

function resolveTableRowCount(ctx: MeasureEvalContext, modelTableId: string): number {
  const modelTable = ctx.model.tables.find((t) => t.id === modelTableId)
  const resolved = modelTable ? resolveTableRef(ctx.datasets, modelTable) : undefined
  return resolved?.table.rowCount ?? 0
}

function getColumnValues(ctx: MeasureEvalContext, ref: LogicalColumnRef): unknown[] {
  const key = `${ref.modelTableId}:${ref.kind}:${ref.columnId}`
  const cached = ctx.columnValuesCache.get(key)
  if (cached) return cached
  const values = getLogicalColumnValues(ctx.model, ctx.datasets, ref)
  ctx.columnValuesCache.set(key, values)
  return values
}

/** Recursively evaluates a measure by id, using and populating `ctx.cache` so a shared dependency is only computed once per evaluation. */
function evaluateMeasureById(measureId: string, ctx: MeasureEvalContext): NodeResult {
  const cached = ctx.cache.get(measureId)
  if (cached) return cached

  const measure = ctx.model.measures.find((m) => m.id === measureId)
  if (!measure) {
    const result: NodeResult = {
      value: null,
      trace: { kind: 'measure-reference', label: 'Unknown measure', value: null },
      diagnostics: [diagnostic('error', 'UNKNOWN_MEASURE', 'This measure no longer exists in the model.')],
    }
    ctx.cache.set(measureId, result)
    return result
  }

  if (ctx.visiting.has(measureId)) {
    const result: NodeResult = {
      value: null,
      trace: { kind: 'measure-reference', label: `[${measure.name}]`, value: null },
      diagnostics: [
        diagnostic('error', 'MEASURE_DEPENDENCY_CYCLE', `"${measure.name}" is part of a measure dependency cycle.`, undefined, {
          measure: measure.name,
        }),
      ],
    }
    ctx.cache.set(measureId, result)
    return result
  }

  ctx.visiting.add(measureId)
  let result: NodeResult
  const parsed = parseExpression(measure.expression)
  if (!parsed.expression) {
    result = { value: null, trace: { kind: 'measure-reference', label: `[${measure.name}]`, value: null }, diagnostics: parsed.diagnostics }
  } else {
    const bound = bindMeasureExpression(parsed.expression, { model: ctx.model, datasets: ctx.datasets })
    if (!bound.bound) {
      result = { value: null, trace: { kind: 'measure-reference', label: `[${measure.name}]`, value: null }, diagnostics: bound.diagnostics }
    } else {
      const evaluated = evaluateNode(bound.bound, ctx)
      result = {
        value: evaluated.value,
        trace: { kind: 'measure-reference', label: `[${measure.name}]`, value: evaluated.value, children: [evaluated.trace] },
        diagnostics: evaluated.diagnostics,
      }
    }
  }
  ctx.visiting.delete(measureId)
  ctx.cache.set(measureId, result)
  return result
}

/** Evaluates one bound measure node against the resolved filter context. Pure — no I/O beyond the evaluation-local caches on `ctx`. */
function evaluateNode(node: BoundMeasureExpression, ctx: MeasureEvalContext): NodeResult {
  switch (node.kind) {
    case 'Literal':
      return { value: node.value, trace: { kind: 'literal', label: formatValue(node.value), value: node.value }, diagnostics: [] }

    case 'MeasureReference':
      return evaluateMeasureById(node.measureId, ctx)

    case 'Unary': {
      const operand = evaluateNode(node.operand, ctx)
      let value: unknown = null
      if (operand.diagnostics.length === 0 && operand.value !== null) {
        value = -(operand.value as number)
      }
      return {
        value,
        diagnostics: operand.diagnostics,
        trace: { kind: 'unary-operation', label: `-(${formatValue(operand.value)})`, value, children: [operand.trace] },
      }
    }

    case 'Binary': {
      const left = evaluateNode(node.left, ctx)
      const right = evaluateNode(node.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      let value: unknown = null
      if (diagnostics.length === 0) {
        if (left.value === null || right.value === null) {
          value = null
        } else if (node.operator === '/' && (right.value as number) === 0) {
          diagnostics.push(diagnostic('error', 'DIVISION_ERROR', 'Division by zero.'))
        } else {
          value = applyBinary(node.operator, left.value as number, right.value as number)
        }
      }
      return {
        value,
        diagnostics,
        trace: {
          kind: 'binary-operation',
          label: `${formatValue(left.value)} ${node.operator} ${formatValue(right.value)}`,
          value,
          children: [left.trace, right.trace],
        },
      }
    }

    case 'Aggregation': {
      const values = getColumnValues(ctx, node.column)
      const totalRows = resolveTableRowCount(ctx, node.modelTableId)
      const visible = visibleRowIndices(ctx.filterState, node.modelTableId, totalRows)
      const result = computeAggregation(node.function, node.label, values, visible, totalRows)
      return { value: result.value, diagnostics: [], trace: result.trace }
    }

    case 'CountRows': {
      const totalRows = resolveTableRowCount(ctx, node.modelTableId)
      const visibleCount = selectionSize(ctx.filterState.rowSelections.get(node.modelTableId) ?? 'all', totalRows)
      const result = computeCountRows(node.label, visibleCount, totalRows)
      return { value: result.value, diagnostics: [], trace: result.trace }
    }

    case 'Divide': {
      const numerator = evaluateNode(node.numerator, ctx)
      const denominator = evaluateNode(node.denominator, ctx)
      const alternate = node.alternate ? evaluateNode(node.alternate, ctx) : undefined
      const diagnostics = [...numerator.diagnostics, ...denominator.diagnostics, ...(alternate?.diagnostics ?? [])]

      let value: unknown = null
      if (diagnostics.length === 0) {
        const denominatorValue = denominator.value as number | null
        if (denominatorValue === null || denominatorValue === 0) {
          value = alternate ? alternate.value : null
        } else {
          value = (numerator.value as number) / denominatorValue
        }
      }

      const children = [numerator.trace, denominator.trace, ...(alternate ? [alternate.trace] : [])]
      return {
        value,
        diagnostics,
        trace: {
          kind: 'binary-operation',
          label: `DIVIDE(${formatValue(numerator.value)}, ${formatValue(denominator.value)})`,
          value,
          children,
        },
      }
    }
  }
}

function inferMeasureDataType(value: unknown): DataType | 'unknown' {
  if (value === null || value === undefined) return 'unknown'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'decimal'
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'string') return 'string'
  return 'unknown'
}

/**
 * Evaluates a measure by id under a `FilterContext` (empty by default —
 * "no filters"). This is the Sprint 4 counterpart to
 * `evaluateCalculatedColumn`: it recomputes everything from the persisted
 * expression rather than trusting any cached result (see docs/MEASURES.md).
 */
export function evaluateMeasure(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  measureId: string,
  filterContext: FilterContext = EMPTY_FILTER_CONTEXT,
): MeasureExecution {
  const filterState = resolveFilterContext(model, datasets, filterContext)
  if (!filterState.valid) {
    return { measureId, value: undefined, dataType: 'unknown', diagnostics: filterState.diagnostics, trace: filterState.trace, filterState }
  }

  const ctx: MeasureEvalContext = {
    model,
    datasets,
    filterState,
    cache: new Map(),
    visiting: new Set(),
    columnValuesCache: new Map(),
  }

  const result = evaluateMeasureById(measureId, ctx)
  return {
    measureId,
    value: result.value,
    dataType: inferMeasureDataType(result.value),
    diagnostics: result.diagnostics,
    trace: result.trace,
    filterState,
  }
}
