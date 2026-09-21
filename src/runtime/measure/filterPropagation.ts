import type { Dataset } from '../../domain/data'
import type { ColumnRef, ModelTable, SemanticModel } from '../../domain/model'
import { diagnostic, type ExpressionDiagnostic } from '../../expression/diagnostics'
import type { ExecutionTraceNode } from '../../expression/trace'
import { modelTableFor, validateModel } from '../model/graphAnalysis'
import { resolveColumnRef, resolveTableRef } from '../model/modelRuntime'
import {
  createEmptyRelationshipState,
  relationshipPropagationEdges,
  type EffectiveRelationshipState,
  type RelationshipPropagationEdge,
} from '../model/relationshipHelpers'
import type { ColumnFilter, FilterContext } from './filterContext'

/** `'all'` means "unfiltered" — every row of the table is visible. Kept lazy so an unfiltered 100k-row fact table never materializes a Set. */
export type RowSelection = Set<number> | 'all'

export interface TableRowSummary {
  modelTableId: string
  tableName: string
  totalRows: number
  visibleRows: number
}

export interface DirectFilterSummary {
  modelTableId: string
  tableName: string
  columnName: string
  operator: ColumnFilter['operator']
  values: unknown[]
  rowsBefore: number
  rowsAfter: number
}

/**
 * One directed propagation hop — the generic replacement for the old
 * `one`/`many`-specific shape (sprint brief §53). A single relationship can
 * contribute 0, 1 or 2 of these per resolution, depending on its effective
 * cardinality/cross-filter direction (see `relationshipPropagationEdges`).
 */
export interface PropagationStep {
  relationshipId: string
  sourceModelTableId: string
  sourceTableName: string
  sourceColumnName: string
  targetModelTableId: string
  targetTableName: string
  targetColumnName: string
  direction: RelationshipPropagationEdge['direction']
  targetRowsBefore: number
  targetRowsAfter: number
}

export interface ResolvedFilterState {
  valid: boolean
  diagnostics: ExpressionDiagnostic[]
  rowSelections: Map<string, RowSelection>
  tableSummaries: TableRowSummary[]
  directFilterSummaries: DirectFilterSummary[]
  propagationSteps: PropagationStep[]
  trace: ExecutionTraceNode
  /** Which relationships this resolution's `relationshipState` activated/suppressed relative to the persisted model — surfaced for the Context Explorer (sprint brief §50-51), never inferred from source text. */
  relationshipOverrides?: { activated: string[]; suppressed: string[] }
}

function isVisible(selection: RowSelection, rowIndex: number): boolean {
  return selection === 'all' || selection.has(rowIndex)
}

export function selectionSize(selection: RowSelection, totalRows: number): number {
  return selection === 'all' ? totalRows : selection.size
}

function intersectIntoSet(existing: RowSelection, matched: Set<number>): Set<number> {
  if (existing === 'all') return matched
  const result = new Set<number>()
  for (const index of matched) if (existing.has(index)) result.add(index)
  return result
}

function columnMatches(value: unknown, filter: ColumnFilter): boolean {
  if (filter.operator === 'equals') return value === filter.values[0]
  return filter.values.includes(value)
}

/** Groups filters by resolved model table and AND-intersects every filter that lands on the same table. */
function applyDirectFilters(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  filters: ColumnFilter[],
  rowSelections: Map<string, RowSelection>,
  summaries: DirectFilterSummary[],
): void {
  for (const filter of filters) {
    const modelTable = modelTableFor(model, filter.column)
    const resolvedColumn = resolveColumnRef(datasets, filter.column)
    if (!modelTable || !resolvedColumn) continue

    const totalRows = resolvedColumn.table.rowCount
    const before = rowSelections.get(modelTable.id) ?? 'all'
    const matched = new Set<number>()
    resolvedColumn.table.rows.forEach((row, rowIndex) => {
      if (columnMatches(row[resolvedColumn.column.name] ?? null, filter)) matched.add(rowIndex)
    })
    const after = intersectIntoSet(before, matched)
    rowSelections.set(modelTable.id, after)

    summaries.push({
      modelTableId: modelTable.id,
      tableName: resolvedColumn.table.name,
      columnName: resolvedColumn.column.name,
      operator: filter.operator,
      values: filter.values,
      rowsBefore: selectionSize(before, totalRows),
      rowsAfter: after.size,
    })
  }
}

/** Builds a `foreign key value -> target-side row indices` index for one propagation edge, reused across the fixed-point loop instead of rescanning the target table every iteration. */
function buildTargetKeyIndex(datasets: Record<string, Dataset>, targetColumn: ColumnRef): Map<unknown, number[]> | undefined {
  const resolved = resolveColumnRef(datasets, targetColumn)
  if (!resolved) return undefined
  const index = new Map<unknown, number[]>()
  resolved.table.rows.forEach((row, rowIndex) => {
    const value = row[resolved.column.name]
    if (value === null || value === undefined) return
    const bucket = index.get(value)
    if (bucket) bucket.push(rowIndex)
    else index.set(value, [rowIndex])
  })
  return index
}

function allowedKeysFromSource(datasets: Record<string, Dataset>, sourceColumn: ColumnRef, sourceSelection: RowSelection): Set<unknown> {
  const resolved = resolveColumnRef(datasets, sourceColumn)
  const allowed = new Set<unknown>()
  if (!resolved) return allowed
  resolved.table.rows.forEach((row, rowIndex) => {
    if (!isVisible(sourceSelection, rowIndex)) return
    const value = row[resolved.column.name]
    if (value !== null && value !== undefined) allowed.add(value)
  })
  return allowed
}

function tableLabel(model: SemanticModel, datasets: Record<string, Dataset>, ref: { datasetId: string; tableId: string }): string {
  const modelTable = modelTableFor(model, ref)
  if (!modelTable) return 'Unknown table'
  return resolveTableRef(datasets, modelTable)?.table.name ?? 'Unknown table'
}

/**
 * Propagates row selections through every effective directed propagation
 * edge (sprint brief §11-14) to a fixed point — generic across `1 → *`,
 * `* → 1`, `1 ↔ 1` and `* → *`, since every edge reduces to the same "key
 * value membership" step (`buildTargetKeyIndex`/`allowedKeysFromSource`)
 * regardless of cardinality. Row selections only ever shrink during
 * resolution, and the loop is bounded by `tables + edges` — if that bound is
 * exhausted without reaching a fixed point (which the monotonic-shrink
 * invariant should make impossible), resolution fails closed with
 * `PROPAGATION_DID_NOT_CONVERGE` rather than looping forever or returning a
 * partially-resolved state silently (sprint brief §14).
 */
function propagate(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  rowSelections: Map<string, RowSelection>,
  steps: PropagationStep[],
  relationshipState: EffectiveRelationshipState,
): { converged: boolean } {
  const edges = relationshipPropagationEdges(model, relationshipState)
  const targetIndexCache = new Map<string, Map<unknown, number[]> | undefined>()
  const edgeKey = (edge: RelationshipPropagationEdge) => `${edge.relationshipId}:${edge.direction}`

  let changed = true
  let iterations = 0
  const maxIterations = model.tables.length + edges.length + 1

  while (changed) {
    if (iterations > maxIterations) return { converged: false }
    changed = false
    iterations += 1

    for (const edge of edges) {
      const sourceSelection = rowSelections.get(edge.sourceModelTableId) ?? 'all'
      if (sourceSelection === 'all') continue // nothing constrained on the source side yet — no propagation needed from here

      const key = edgeKey(edge)
      if (!targetIndexCache.has(key)) targetIndexCache.set(key, buildTargetKeyIndex(datasets, edge.targetColumn))
      const targetIndex = targetIndexCache.get(key)
      const targetResolved = resolveColumnRef(datasets, edge.targetColumn)
      if (!targetIndex || !targetResolved) continue

      const allowedKeys = allowedKeysFromSource(datasets, edge.sourceColumn, sourceSelection)
      const matched = new Set<number>()
      for (const value of allowedKeys) {
        for (const rowIndex of targetIndex.get(value) ?? []) matched.add(rowIndex)
      }

      const before = rowSelections.get(edge.targetModelTableId) ?? 'all'
      const beforeSize = selectionSize(before, targetResolved.table.rowCount)
      const after = intersectIntoSet(before, matched)

      const sameAsBefore = before !== 'all' && before.size === after.size && [...after].every((i) => before.has(i))
      if (before === 'all' || !sameAsBefore) {
        rowSelections.set(edge.targetModelTableId, after)
        changed = true
        steps.push({
          relationshipId: edge.relationshipId,
          sourceTableName: tableLabel(model, datasets, edge.sourceColumn),
          sourceModelTableId: edge.sourceModelTableId,
          sourceColumnName: resolveColumnRef(datasets, edge.sourceColumn)?.column.name ?? '',
          targetTableName: tableLabel(model, datasets, edge.targetColumn),
          targetModelTableId: edge.targetModelTableId,
          targetColumnName: targetResolved.column.name,
          direction: edge.direction,
          targetRowsBefore: beforeSize,
          targetRowsAfter: after.size,
        })
      }
    }
  }

  return { converged: true }
}

function buildTrace(
  filterContext: FilterContext,
  directFilterSummaries: DirectFilterSummary[],
  propagationSteps: PropagationStep[],
  tableSummaries: TableRowSummary[],
): ExecutionTraceNode {
  const children: ExecutionTraceNode[] = []

  for (const summary of directFilterSummaries) {
    children.push({
      kind: 'filter-context',
      label: `${summary.tableName}[${summary.columnName}] ${summary.operator} ${summary.values.map(String).join(', ')}`,
      metadata: { rowsBefore: summary.rowsBefore, rowsAfter: summary.rowsAfter },
    })
  }

  for (const step of propagationSteps) {
    const arrow = step.direction === 'left-to-right' ? '→' : '←'
    children.push({
      kind: 'relationship-propagation',
      label: `${step.sourceTableName}[${step.sourceColumnName}] ${arrow} ${step.targetTableName}[${step.targetColumnName}]`,
      metadata: { targetRowsBefore: step.targetRowsBefore, targetRowsAfter: step.targetRowsAfter },
    })
  }

  return {
    kind: 'filter-context',
    label: filterContext.filters.length === 0 ? 'No filters' : `${filterContext.filters.length} filter(s)`,
    children,
    metadata: { tables: tableSummaries },
  }
}

/**
 * Checks the model's own relationship graph once — validity is a property of
 * `model` alone (no runtime overrides — see `runtime/measure/contextModifier.ts`'s
 * `EffectiveRelationshipState` for why per-call overrides don't need their
 * own live re-validation, docs/ADVANCED_RELATIONSHIPS.md "USERELATIONSHIP
 * and ambiguity"), independent of any `FilterContext`, so a CALCULATE-heavy
 * evaluation (which may resolve many nested contexts against the *same*
 * model) only needs to run this once per `evaluateMeasure` call rather than
 * once per nested resolution (sprint brief §68 "avoid obvious repeated
 * recomputation"). See `resolveFilterContext` (the checked, public entry
 * point) and `resolveFilterContextUnchecked` (used internally once validity
 * is already known).
 */
export function checkFilterGraphValidity(model: SemanticModel, datasets: Record<string, Dataset>): ExpressionDiagnostic[] {
  const modelDiagnostics = validateModel(model, datasets)
  const graphIssues = modelDiagnostics.filter((d) => d.code === 'AMBIGUOUS_FILTER_PATH')
  if (graphIssues.length === 0) return []
  return [
    diagnostic(
      'error',
      'FILTER_GRAPH_INVALID',
      `This model's relationship graph is invalid (${graphIssues.map((d) => d.code).join(', ')}), so measures can't be evaluated deterministically. Fix the model diagnostics first.`,
      undefined,
      { modelDiagnostics: graphIssues },
    ),
  ]
}

function invalidFilterState(diagnostics: ExpressionDiagnostic[]): ResolvedFilterState {
  return {
    valid: false,
    diagnostics,
    rowSelections: new Map(),
    tableSummaries: [],
    directFilterSummaries: [],
    propagationSteps: [],
    trace: { kind: 'filter-context', label: 'Filter graph invalid', metadata: { codes: diagnostics.map((d) => d.code) } },
  }
}

/**
 * Resolves a `FilterContext` into concrete row selections per model table,
 * *assuming* the model's relationship graph has already been checked valid
 * (`checkFilterGraphValidity`) — used by CALCULATE's nested resolutions
 * within one `evaluateMeasure` call. `tableSelections`, when given, seeds a
 * table's *starting* row selection (instead of the `'all'` default) before
 * direct filters and propagation run — this is how a `FILTER(Table,
 * predicate)`-derived row subset (sprint brief §21) both AND-combines with
 * any ordinary `ColumnFilter` landing on the same table and propagates
 * through active relationships exactly like a direct filter would, with no
 * changes to `propagate()` itself. `relationshipState`, when given, scopes
 * which relationships are effectively active/suppressed and which direction
 * they filter in for *this* resolution only (Sprint 11's `USERELATIONSHIP`/
 * `CROSSFILTER` — see `contextModifier.ts`'s `EffectiveContext`); it never
 * mutates the persisted model.
 */
export function resolveFilterContextUnchecked(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  filterContext: FilterContext,
  tableSelections?: Map<string, Set<number>>,
  relationshipState: EffectiveRelationshipState = createEmptyRelationshipState(),
): ResolvedFilterState {
  const rowSelections = new Map<string, RowSelection>()
  if (tableSelections) {
    for (const [modelTableId, indexes] of tableSelections) rowSelections.set(modelTableId, indexes)
  }

  const directFilterSummaries: DirectFilterSummary[] = []
  applyDirectFilters(model, datasets, filterContext.filters, rowSelections, directFilterSummaries)

  const propagationSteps: PropagationStep[] = []
  const { converged } = propagate(model, datasets, rowSelections, propagationSteps, relationshipState)

  if (!converged) {
    return invalidFilterState([
      diagnostic(
        'error',
        'PROPAGATION_DID_NOT_CONVERGE',
        "Filter propagation did not settle within the expected number of passes. This shouldn't happen — please report it.",
      ),
    ])
  }

  const tableSummaries: TableRowSummary[] = model.tables.map((table: ModelTable) => {
    const resolved = resolveTableRef(datasets, table)
    const totalRows = resolved?.table.rowCount ?? 0
    const selection = rowSelections.get(table.id) ?? 'all'
    return {
      modelTableId: table.id,
      tableName: resolved?.table.name ?? 'Unknown table',
      totalRows,
      visibleRows: selectionSize(selection, totalRows),
    }
  })

  return {
    valid: true,
    diagnostics: [],
    rowSelections,
    tableSummaries,
    directFilterSummaries,
    propagationSteps,
    trace: buildTrace(filterContext, directFilterSummaries, propagationSteps, tableSummaries),
    relationshipOverrides: {
      activated: [...relationshipState.activatedRelationshipIds],
      suppressed: [...relationshipState.suppressedRelationshipIds],
    },
  }
}

/**
 * Resolves a `FilterContext` into concrete row selections per model table:
 * direct filters first, then fixed-point propagation through every
 * effective directed propagation edge. Fails closed with
 * `FILTER_GRAPH_INVALID` if the model's own relationship graph is already
 * invalid (`AMBIGUOUS_FILTER_PATH`) — see docs/FILTER_CONTEXT.md "Invalid
 * filter graphs".
 */
export function resolveFilterContext(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  filterContext: FilterContext,
  tableSelections?: Map<string, Set<number>>,
  relationshipState?: EffectiveRelationshipState,
): ResolvedFilterState {
  const graphDiagnostics = checkFilterGraphValidity(model, datasets)
  if (graphDiagnostics.length > 0) return invalidFilterState(graphDiagnostics)
  return resolveFilterContextUnchecked(model, datasets, filterContext, tableSelections, relationshipState)
}

export function visibleRowIndices(state: ResolvedFilterState, modelTableId: string, totalRows: number): number[] {
  const selection = state.rowSelections.get(modelTableId) ?? 'all'
  if (selection === 'all') return Array.from({ length: totalRows }, (_, i) => i)
  return [...selection].sort((a, b) => a - b)
}

export function isRowVisible(state: ResolvedFilterState, modelTableId: string, rowIndex: number): boolean {
  return isVisible(state.rowSelections.get(modelTableId) ?? 'all', rowIndex)
}
