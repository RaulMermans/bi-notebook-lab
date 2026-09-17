import type { Dataset } from '../../domain/data'
import type { ModelTable, Relationship, SemanticModel } from '../../domain/model'
import { diagnostic, type ExpressionDiagnostic } from '../../expression/diagnostics'
import type { ExecutionTraceNode } from '../../expression/trace'
import { activeRelationships, modelTableFor, validateModel } from '../model/graphAnalysis'
import { resolveColumnRef, resolveTableRef } from '../model/modelRuntime'
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
  tableName: string
  columnName: string
  operator: ColumnFilter['operator']
  values: unknown[]
  rowsBefore: number
  rowsAfter: number
}

export interface PropagationStep {
  relationshipId: string
  oneTableName: string
  manyTableName: string
  oneKeyColumnName: string
  manyKeyColumnName: string
  manyRowsBefore: number
  manyRowsAfter: number
}

export interface ResolvedFilterState {
  valid: boolean
  diagnostics: ExpressionDiagnostic[]
  rowSelections: Map<string, RowSelection>
  tableSummaries: TableRowSummary[]
  directFilterSummaries: DirectFilterSummary[]
  propagationSteps: PropagationStep[]
  trace: ExecutionTraceNode
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
      tableName: resolvedColumn.table.name,
      columnName: resolvedColumn.column.name,
      operator: filter.operator,
      values: filter.values,
      rowsBefore: selectionSize(before, totalRows),
      rowsAfter: after.size,
    })
  }
}

/** Builds a `foreign key value -> many-side row indices` index for one relationship, reused across the fixed-point loop instead of rescanning the many-side table every iteration. */
function buildManySideKeyIndex(datasets: Record<string, Dataset>, relationship: Relationship): Map<unknown, number[]> | undefined {
  const resolved = resolveColumnRef(datasets, relationship.many)
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

function allowedKeysFromOneSide(datasets: Record<string, Dataset>, relationship: Relationship, oneSelection: RowSelection): Set<unknown> {
  const resolved = resolveColumnRef(datasets, relationship.one)
  const allowed = new Set<unknown>()
  if (!resolved) return allowed
  resolved.table.rows.forEach((row, rowIndex) => {
    if (!isVisible(oneSelection, rowIndex)) return
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
 * Propagates row selections through active `1 → *` relationships to a fixed
 * point, so transitive chains (Region → Customers → Sales) resolve without
 * hardcoding hop counts. Cycles/ambiguous paths are rejected upstream by the
 * `FILTER_GRAPH_INVALID` guard in `resolveFilterContext`, so this loop always
 * terminates within `relationships.length + 1` passes.
 */
function propagate(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  rowSelections: Map<string, RowSelection>,
  steps: PropagationStep[],
): void {
  const relationships = activeRelationships(model)
  const manyIndexCache = new Map<string, Map<unknown, number[]> | undefined>()

  let changed = true
  let iterations = 0
  const maxIterations = relationships.length + 1

  while (changed && iterations <= maxIterations) {
    changed = false
    iterations += 1

    for (const relationship of relationships) {
      const oneTable = modelTableFor(model, relationship.one)
      const manyTable = modelTableFor(model, relationship.many)
      if (!oneTable || !manyTable) continue

      const oneSelection = rowSelections.get(oneTable.id) ?? 'all'
      if (oneSelection === 'all') continue // nothing constrained on the "1" side yet — no propagation needed from here

      if (!manyIndexCache.has(relationship.id)) {
        manyIndexCache.set(relationship.id, buildManySideKeyIndex(datasets, relationship))
      }
      const manyIndex = manyIndexCache.get(relationship.id)
      const manyResolved = resolveColumnRef(datasets, relationship.many)
      if (!manyIndex || !manyResolved) continue

      const allowedKeys = allowedKeysFromOneSide(datasets, relationship, oneSelection)
      const matched = new Set<number>()
      for (const key of allowedKeys) {
        for (const rowIndex of manyIndex.get(key) ?? []) matched.add(rowIndex)
      }

      const before = rowSelections.get(manyTable.id) ?? 'all'
      const beforeSize = selectionSize(before, manyResolved.table.rowCount)
      const after = intersectIntoSet(before, matched)

      const sameAsBefore = before !== 'all' && before.size === after.size && [...after].every((i) => before.has(i))
      if (before === 'all' || !sameAsBefore) {
        rowSelections.set(manyTable.id, after)
        changed = true
        steps.push({
          relationshipId: relationship.id,
          oneTableName: tableLabel(model, datasets, relationship.one),
          manyTableName: tableLabel(model, datasets, relationship.many),
          oneKeyColumnName: resolveColumnRef(datasets, relationship.one)?.column.name ?? '',
          manyKeyColumnName: manyResolved.column.name,
          manyRowsBefore: beforeSize,
          manyRowsAfter: after.size,
        })
      }
    }
  }
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
    children.push({
      kind: 'relationship-propagation',
      label: `${step.oneTableName}[${step.oneKeyColumnName}] 1 → * ${step.manyTableName}[${step.manyKeyColumnName}]`,
      metadata: { manyRowsBefore: step.manyRowsBefore, manyRowsAfter: step.manyRowsAfter },
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
 * Resolves a `FilterContext` into concrete row selections per model table:
 * direct filters first, then fixed-point propagation through active `1 → *`
 * relationships. Fails closed with `FILTER_GRAPH_INVALID` if the model's own
 * relationship graph is already invalid (`ACTIVE_CYCLE`/`AMBIGUOUS_PATH`) —
 * see docs/FILTER_CONTEXT.md "Invalid filter graphs".
 */
export function resolveFilterContext(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  filterContext: FilterContext,
): ResolvedFilterState {
  const modelDiagnostics = validateModel(model, datasets)
  const graphIssues = modelDiagnostics.filter((d) => d.code === 'ACTIVE_CYCLE' || d.code === 'AMBIGUOUS_PATH')

  if (graphIssues.length > 0) {
    const diagnostics: ExpressionDiagnostic[] = [
      diagnostic(
        'error',
        'FILTER_GRAPH_INVALID',
        `This model's relationship graph is invalid (${graphIssues.map((d) => d.code).join(', ')}), so measures can't be evaluated deterministically. Fix the model diagnostics first.`,
        undefined,
        { modelDiagnostics: graphIssues },
      ),
    ]
    return {
      valid: false,
      diagnostics,
      rowSelections: new Map(),
      tableSummaries: [],
      directFilterSummaries: [],
      propagationSteps: [],
      trace: { kind: 'filter-context', label: 'Filter graph invalid', metadata: { codes: graphIssues.map((d) => d.code) } },
    }
  }

  const rowSelections = new Map<string, RowSelection>()
  const directFilterSummaries: DirectFilterSummary[] = []
  applyDirectFilters(model, datasets, filterContext.filters, rowSelections, directFilterSummaries)

  const propagationSteps: PropagationStep[] = []
  propagate(model, datasets, rowSelections, propagationSteps)

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
  }
}

export function visibleRowIndices(state: ResolvedFilterState, modelTableId: string, totalRows: number): number[] {
  const selection = state.rowSelections.get(modelTableId) ?? 'all'
  if (selection === 'all') return Array.from({ length: totalRows }, (_, i) => i)
  return [...selection].sort((a, b) => a - b)
}

export function isRowVisible(state: ResolvedFilterState, modelTableId: string, rowIndex: number): boolean {
  return isVisible(state.rowSelections.get(modelTableId) ?? 'all', rowIndex)
}
