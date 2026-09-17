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
