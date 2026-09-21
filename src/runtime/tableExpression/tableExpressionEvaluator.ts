import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { ExpressionDiagnostic } from '../../expression/diagnostics'
import type { ExecutionTraceNode } from '../../expression/trace'
import { evaluateTimeIntelligenceTable } from '../timeIntelligence/timeIntelligenceEvaluator'
import { evaluatePredicateForRow } from '../measure/booleanFilter'
import { isRowVisible, visibleRowIndices, type ResolvedFilterState } from '../measure/filterPropagation'
import { resolveTableRef } from '../model/modelRuntime'
import type { BoundTableExpression, TableExpressionRow } from './tableExpressionTypes'

export interface TableExpressionEvalContext {
  model: SemanticModel
  datasets: Record<string, Dataset>
  /** Ambient row visibility a `BaseTable` reads from — sprint brief §5: `SUMX(Sales, ...)` only iterates Sales rows visible under the *current* FilterContext, never the full 1,500-row source table. */
  filterState: ResolvedFilterState
}

export interface EvaluatedTableExpression {
  rows: TableExpressionRow[]
  /** The model table every row is ultimately lineage-rooted at (a `FilterTable`'s own table, or a `VALUES`/`DISTINCT` column's owning table). */
  modelTableId: string
  trace: ExecutionTraceNode
  /** Sprint 10: a runtime-only failure that can only be detected once the *actual* visible dates are known (e.g. `DATEADD`'s non-contiguous-context check, sprint brief §26) — absent for every other table-expression kind, whose failures are always caught at bind time. */
  diagnostics?: ExpressionDiagnostic[]
}

function resolveRowCount(model: SemanticModel, datasets: Record<string, Dataset>, modelTableId: string): number {
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  return resolved?.table.rowCount ?? 0
}

function evaluateBaseTable(modelTableId: string, tableName: string, ctx: TableExpressionEvalContext): EvaluatedTableExpression {
  const modelTable = ctx.model.tables.find((t) => t.id === modelTableId)
  const resolved = modelTable ? resolveTableRef(ctx.datasets, modelTable) : undefined
  if (!resolved) {
    return { rows: [], modelTableId, trace: { kind: 'table-expression', label: tableName, metadata: { rows: 0 } } }
  }

  const totalRows = resolved.table.rowCount
  const visible = visibleRowIndices(ctx.filterState, modelTableId, totalRows)
  const rows: TableExpressionRow[] = visible.map((rowIndex) => ({ kind: 'model-row', modelTableId, rowIndex, row: resolved.table.rows[rowIndex] }))

  return {
    rows,
    modelTableId,
    trace: { kind: 'table-expression', label: tableName, metadata: { totalRows, visibleRows: rows.length } },
  }
}

function evaluateFilterTable(
  bound: Extract<BoundTableExpression, { kind: 'FilterTable' }>,
  ctx: TableExpressionEvalContext,
): EvaluatedTableExpression {
  const input = evaluateTableExpression(bound.input, ctx)
  const matched = input.rows.filter((row) => row.kind === 'model-row' && evaluatePredicateForRow(bound.predicate, row.row))

  return {
    rows: matched,
    modelTableId: bound.modelTableId,
    trace: {
      kind: 'table-expression',
      label: bound.label,
      metadata: { inputRows: input.rows.length, matched: matched.length },
      children: [input.trace],
    },
  }
}

function evaluateColumnTable(
  bound: Extract<BoundTableExpression, { kind: 'ValuesTable' | 'DistinctTable' }>,
  ctx: TableExpressionEvalContext,
): EvaluatedTableExpression {
  const base = evaluateBaseTable(bound.modelTableId, bound.tableName, ctx)
  const seen = new Set<unknown>()
  const rows: TableExpressionRow[] = []

  for (const row of base.rows) {
    if (row.kind !== 'model-row') continue
    const value = row.row[bound.columnName] ?? null
    if (seen.has(value)) continue
    seen.add(value)
    rows.push({ kind: 'value-row', sourceColumn: bound.column, sourceModelTableId: bound.modelTableId, value })
  }

  const label = `${bound.kind === 'ValuesTable' ? 'VALUES' : 'DISTINCT'}(${bound.tableName}[${bound.columnName}])`
  return {
    rows,
    modelTableId: bound.modelTableId,
    trace: {
      kind: 'table-expression',
      label,
      metadata: { visibleSourceRows: base.rows.length, distinctValues: rows.length },
    },
  }
}

/**
 * Evaluates a `BoundTableExpression` into a concrete row set — the single
 * evaluator every consumer (CALCULATE's FILTER modifier, COUNTROWS, the
 * iterator functions) shares (sprint brief §2/§6). Always respects
 * `ctx.filterState`'s ambient row visibility for the underlying model table,
 * so a table expression evaluated under `Country = Spain` only ever sees
 * Spain's rows.
 */
export function evaluateTableExpression(bound: BoundTableExpression, ctx: TableExpressionEvalContext): EvaluatedTableExpression {
  switch (bound.kind) {
    case 'BaseTable':
      return evaluateBaseTable(bound.modelTableId, bound.tableName, ctx)
    case 'FilterTable':
      return evaluateFilterTable(bound, ctx)
    case 'ValuesTable':
    case 'DistinctTable':
      return evaluateColumnTable(bound, ctx)
    case 'TimeIntelligenceTable':
      return evaluateTimeIntelligenceTable(bound, ctx)
  }
}

/** Converts an evaluated table expression's `model-row`s into the `Set<number>` row-index representation CALCULATE's `EffectiveContext`/`resolveFilterContextUnchecked` already use — `undefined` for a `VALUES`/`DISTINCT` result, which has no model-row index set. */
export function tableExpressionRowIndexSet(result: EvaluatedTableExpression): Set<number> | undefined {
  if (result.rows.some((r) => r.kind !== 'model-row')) return undefined
  return new Set(result.rows.map((r) => (r as Extract<TableExpressionRow, { kind: 'model-row' }>).rowIndex))
}

export function tableExpressionRowCount(bound: BoundTableExpression, model: SemanticModel, datasets: Record<string, Dataset>): number {
  return resolveRowCount(model, datasets, bound.modelTableId)
}
