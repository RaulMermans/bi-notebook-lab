import type { DataType, Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import { diagnostic, type ExpressionDiagnostic } from '../../expression/diagnostics'
import type { BinaryOperator } from '../../expression/ast'
import { bindMeasureExpression, type BoundMeasureExpression } from '../../expression/measureBinder'
import { parseExpression } from '../../expression/parser'
import type { ExecutionTraceNode } from '../../expression/trace'
import { compareScalarValues } from './booleanFilter'
import { computeAggregation, computeCountRows } from './aggregation'
import {
  applyFilterModifier,
  buildEffectiveContext,
  cloneEffectiveContext,
  toFilterContext,
  toTableSelectionIndexes,
  type EffectiveContext,
} from './contextModifier'
import { EMPTY_FILTER_CONTEXT, type FilterContext } from './filterContext'
import {
  resolveFilterContext,
  resolveFilterContextUnchecked,
  selectionSize,
  visibleRowIndices,
  type ResolvedFilterState,
} from './filterPropagation'
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
  /**
   * Set only by a `Calculate` node (and passed through by `evaluateMeasureById`
   * for a measure whose *top-level* expression is a `CALCULATE`): the modified
   * `ResolvedFilterState` CALCULATE actually evaluated under. `evaluateMeasure`
   * surfaces this instead of the outer/external filter state so the Context
   * Explorer diagram reflects "Spain", not the external "France" slicer, for a
   * measure like `Spain Revenue` (docs/CALCULATE.md "Context Explorer
   * integration"). Left undefined for every other node kind — a bounded,
   * documented limitation for expressions that mix several different
   * CALCULATE contexts (e.g. `[Spain Revenue] - [France Revenue]`), where no
   * single filter state could represent the whole result anyway.
   */
  effectiveFilterState?: ResolvedFilterState
}

interface MeasureEvalContext {
  model: SemanticModel
  datasets: Record<string, Dataset>
  filterState: ResolvedFilterState
  /** The context-modification bookkeeping (`ColumnFilter`s + FILTER-derived table selections) that produced `filterState` — CALCULATE reads this as its "incoming" context to modify (docs/CALCULATE.md). */
  effectiveContext: EffectiveContext
  /**
   * Per-evaluation-*scope* cache so a measure referenced several times under
   * the *same* filter context is only computed once (docs/MEASURES.md
   * "Measure reference trace"). CALCULATE always evaluates its inner
   * expression with a **fresh** cache (never inherited from the outer scope)
   * — reusing a value computed under a different `FilterContext` here would
   * be the exact bug sprint brief §32 calls out (e.g. a France-context
   * `[Total Revenue]` must never leak into a CALCULATE'd Spain context).
   */
  cache: Map<string, NodeResult>
  /** Shared across every nested scope of one `evaluateMeasure` call — cycle detection is structural, not context-dependent. */
  visiting: Set<string>
  /** Shared across every nested scope — a column's raw values don't depend on filter context, only which row *indexes* are visible does. */
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
        effectiveFilterState: evaluated.effectiveFilterState,
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

    case 'Comparison': {
      const left = evaluateNode(node.left, ctx)
      const right = evaluateNode(node.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      const value = diagnostics.length === 0 ? compareScalarValues(node.operator, left.value, right.value) : null
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

    case 'Logical': {
      const left = evaluateNode(node.left, ctx)
      // Short-circuit (sprint brief §11): only evaluate `right` when its value could change the result.
      if (left.diagnostics.length === 0) {
        if (node.operator === '&&' && left.value === false) {
          return { value: false, diagnostics: [], trace: { kind: 'binary-operation', label: `${formatValue(left.value)} && ⋯`, value: false, children: [left.trace] } }
        }
        if (node.operator === '||' && left.value === true) {
          return { value: true, diagnostics: [], trace: { kind: 'binary-operation', label: `${formatValue(left.value)} || ⋯`, value: true, children: [left.trace] } }
        }
      }
      const right = evaluateNode(node.right, ctx)
      const diagnostics = [...left.diagnostics, ...right.diagnostics]
      const value =
        diagnostics.length === 0
          ? node.operator === '&&'
            ? Boolean(left.value) && Boolean(right.value)
            : Boolean(left.value) || Boolean(right.value)
          : null
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

    case 'Calculate':
      return evaluateCalculate(node, ctx)

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

/**
 * Evaluates `CALCULATE(expression, modifiers...)` (docs/CALCULATE.md):
 *
 * 1. Clone the enclosing scope's `EffectiveContext` (never mutate it — a
 *    sibling expression evaluated after this CALCULATE must still see the
 *    unmodified outer context).
 * 2. Apply every filter modifier **sequentially**, left to right (sprint
 *    brief §28 "Modifier Ordering") — a row-scanning modifier (a direct
 *    inequality, or FILTER) reads row visibility from the *outer* scope's
 *    already-resolved `filterState`, not from sibling modifiers processed
 *    earlier in this same call (docs/CALCULATE.md "FILTER and the ambient
 *    context" — this is what makes a `FILTER` argument automatically
 *    intersect with whatever the caller already had filtered, sprint brief
 *    §51, with no separate intersection logic needed).
 * 3. Resolve the modified context once (`resolveFilterContextUnchecked` — the
 *    model's relationship graph was already validated once at the top of
 *    `evaluateMeasure`, sprint brief §68).
 * 4. Evaluate the inner expression under a **fresh** cache but the *same*
 *    `visiting`/`columnValuesCache` (see `MeasureEvalContext` doc comment for
 *    why — sprint brief §32/§64's "context-safe cache" requirement).
 */
function evaluateCalculate(
  node: Extract<BoundMeasureExpression, { kind: 'Calculate' }>,
  ctx: MeasureEvalContext,
): NodeResult & { effectiveFilterState: ResolvedFilterState } {
  const nextEffectiveContext = cloneEffectiveContext(ctx.effectiveContext)
  const modifierTraces: ExecutionTraceNode[] = []

  for (const modifier of node.modifiers) {
    const outcome = applyFilterModifier(ctx.model, ctx.datasets, nextEffectiveContext, modifier, ctx.filterState)
    modifierTraces.push(buildModifierTraceNode(outcome))
  }

  const innerFilterContext = toFilterContext(nextEffectiveContext)
  const innerTableSelections = toTableSelectionIndexes(nextEffectiveContext)
  const innerFilterState = resolveFilterContextUnchecked(ctx.model, ctx.datasets, innerFilterContext, innerTableSelections)

  const calcCtx: MeasureEvalContext = {
    model: ctx.model,
    datasets: ctx.datasets,
    filterState: innerFilterState,
    effectiveContext: nextEffectiveContext,
    cache: new Map(),
    visiting: ctx.visiting,
    columnValuesCache: ctx.columnValuesCache,
  }

  const inner = evaluateNode(node.expression, calcCtx)

  const trace: ExecutionTraceNode = {
    kind: 'calculate',
    label: node.label,
    value: inner.value,
    children: [
      { kind: 'filter-context', label: 'Incoming context', children: ctx.filterState.trace.children, metadata: ctx.filterState.trace.metadata },
      ...modifierTraces,
      { kind: 'filter-context', label: 'Modified context', children: innerFilterState.trace.children, metadata: innerFilterState.trace.metadata },
      inner.trace,
    ],
  }

  return { value: inner.value, diagnostics: inner.diagnostics, trace, effectiveFilterState: innerFilterState }
}

function buildModifierTraceNode(outcome: ReturnType<typeof applyFilterModifier>): ExecutionTraceNode {
  if (outcome.kind === 'PredicateFilter') {
    return {
      kind: 'table-filter',
      label: outcome.label,
      metadata: { tableName: outcome.tableName, inputRows: outcome.inputRows, rowsMatched: outcome.rowsMatched },
    }
  }
  if (outcome.kind === 'ReplaceColumnFilter') {
    return { kind: 'boolean-filter', label: outcome.label }
  }
  return { kind: 'remove-filters', label: outcome.label, metadata: { removed: outcome.removedLabels ?? [] } }
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
    effectiveContext: buildEffectiveContext(filterContext),
    cache: new Map(),
    visiting: new Set(),
    columnValuesCache: new Map(),
  }

  const result = evaluateMeasureById(measureId, ctx)
  // A CALCULATE at the measure's top level evaluated under a *modified*
  // context — surface that instead of the outer/external one, so downstream
  // consumers (Context Explorer's diagram, Visual Cells) reflect what the
  // measure actually computed against (docs/CALCULATE.md "Context Explorer
  // integration"). See the `effectiveFilterState` doc comment on `NodeResult`
  // for the bounded scope of this substitution.
  const effectiveFilterState = result.effectiveFilterState ?? filterState
  return {
    measureId,
    value: result.value,
    dataType: inferMeasureDataType(result.value),
    diagnostics: result.diagnostics,
    trace: result.trace,
    filterState: effectiveFilterState,
  }
}
