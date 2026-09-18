import type { ColumnRef } from '../../domain/model'

/**
 * A single-column filter constraining a table's visible rows. Sprint 4
 * supports equality and set membership only — see docs/FILTER_CONTEXT.md
 * for why richer boolean expressions (CALCULATE/FILTER) are deferred.
 */
export interface ColumnFilter {
  column: ColumnRef
  operator: 'equals' | 'in'
  values: unknown[]
}

/**
 * The explicit, first-class filter context a measure evaluates in — the
 * counterpart to `RowContext` for calculated columns. All filters apply
 * simultaneously with AND semantics (docs/FILTER_CONTEXT.md).
 */
export interface FilterContext {
  filters: ColumnFilter[]
}

export const EMPTY_FILTER_CONTEXT: FilterContext = { filters: [] }

function filterColumnKey(filter: ColumnFilter): string {
  return `${filter.column.datasetId}:${filter.column.tableId}:${filter.column.columnId}`
}

/**
 * Combines two `FilterContext`s into one, per Sprint 7 brief §13 — the
 * canonical merge used to intersect a notebook/slicer `FilterContext` with a
 * Visual's own per-member filter (`runtime/visual/*`). Rule:
 *
 * - A filter on a column not already present in `base` is added as-is
 *   (different columns always combine with AND — this is exactly what
 *   `FilterContext.filters` already means).
 * - A filter on a column already present in `base` **intersects** the two
 *   value sets rather than appending a second, contradictory constraint on
 *   the same column. `Country IN [Spain, France]` merged with
 *   `Country = Spain` collapses to `Country = Spain`; two flatly
 *   contradictory filters (`Country = Spain` merged with `Country = France`)
 *   collapse to an empty value set, which deterministically matches zero
 *   rows downstream (`columnMatches` in `filterPropagation.ts`) rather than
 *   silently picking one side.
 */
export function mergeFilterContexts(base: FilterContext, additional: FilterContext): FilterContext {
  const byColumn = new Map<string, ColumnFilter>()
  for (const filter of base.filters) byColumn.set(filterColumnKey(filter), filter)

  for (const filter of additional.filters) {
    const key = filterColumnKey(filter)
    const existing = byColumn.get(key)
    if (!existing) {
      byColumn.set(key, filter)
      continue
    }
    const existingValues = new Set(existing.values)
    const intersected = filter.values.filter((value) => existingValues.has(value))
    byColumn.set(key, {
      column: filter.column,
      operator: intersected.length <= 1 ? 'equals' : 'in',
      values: intersected,
    })
  }

  return { filters: [...byColumn.values()] }
}
