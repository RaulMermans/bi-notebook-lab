import type { Dataset } from '../../domain/data'
import type { ColumnRef, SemanticModel } from '../../domain/model'
import type { ExpressionDiagnostic } from '../../expression/diagnostics'
import type { ExecutionTraceNode } from '../../expression/trace'
import { modelTableFor } from '../model/graphAnalysis'
import { resolveTableRef } from '../model/modelRuntime'
import { computeTimeIntelligenceRowIndexes } from '../timeIntelligence/timeIntelligenceEvaluator'
import { evaluateTableExpression, tableExpressionRowIndexSet } from '../tableExpression/tableExpressionEvaluator'
import type { BoundFilterTable, BoundTimeIntelligenceTable } from '../tableExpression/tableExpressionTypes'
import type { BoundPredicateNode } from './booleanFilter'
import type { ColumnFilter, FilterContext } from './filterContext'
import { selectionSize, type ResolvedFilterState } from './filterPropagation'

/**
 * CALCULATE's context-modification layer (sprint brief §4/§48): a set of
 * explicit operations — replace a column's filter, remove a column's/table's
 * filter, clear everything, install a FILTER-derived row selection — kept
 * deliberately separate from `mergeFilterContexts` (`filterContext.ts`),
 * whose same-column **intersection** semantics is exactly wrong for
 * CALCULATE's same-column **replacement** semantics (docs/CALCULATE.md
 * "Same-column replacement").
 */

export interface ReplaceColumnFilterModifier {
  kind: 'ReplaceColumnFilter'
  column: ColumnRef
  operator: 'equals' | 'in'
  values: unknown[]
  label: string
}

/**
 * A row-selection-producing filter: either a direct multi-column CALCULATE
 * boolean argument (`tableWide: false` — replaces only the columns it
 * references) or `FILTER(Table, predicate)` (`tableWide: true` — replaces
 * everything on that table, matching real DAX's table-argument replacement;
 * see docs/CALCULATE.md "Table-wide vs. column-scoped replacement").
 */
export interface PredicateFilterModifier {
  kind: 'PredicateFilter'
  modelTableId: string
  referencedColumns: ColumnRef[]
  predicate: BoundPredicateNode
  label: string
  tableWide: boolean
}

export interface RemoveColumnsModifier {
  kind: 'RemoveColumns'
  columns: ColumnRef[]
  label: string
}

export interface RemoveTablesModifier {
  kind: 'RemoveTables'
  modelTableIds: string[]
  label: string
}

export interface ClearAllFiltersModifier {
  kind: 'ClearAllFilters'
  label: string
}

/**
 * Sprint 10 (Classic Time Intelligence, sprint brief §20-§22): a Classic
 * time-intelligence table (`SAMEPERIODLASTYEAR`, `DATEADD`, `PREVIOUSMONTH`,
 * `PREVIOUSYEAR`, `DATESYTD`) replaces the marked Date Table's *entire*
 * current filter state with a freshly computed date set — never an ordinary
 * intersection (`mergeFilterContexts`) and never routed through
 * `PredicateFilter`'s boolean-predicate machinery, since the target date set
 * is computed deterministically, not learner-authored. See
 * docs/TIME_INTELLIGENCE.md "Date Table filter replacement".
 */
export interface DateTableReplaceModifier {
  kind: 'DateTableReplace'
  bound: BoundTimeIntelligenceTable
  label: string
}

export type FilterModifier =
  | ReplaceColumnFilterModifier
  | PredicateFilterModifier
  | RemoveColumnsModifier
  | RemoveTablesModifier
  | ClearAllFiltersModifier
  | DateTableReplaceModifier

export interface EffectiveTableSelection {
  modelTableId: string
  includedRowIndexes: Set<number>
  totalRows: number
  /** `null` = table-wide (FILTER, or a table-level remove target); non-null = the specific columns whose predicate produced this selection, so REMOVEFILTERS(column)/ALL(column) can undo it (docs/CALCULATE.md). */
  scopeColumns: ColumnRef[] | null
  label: string
}

/** The running, mutable state a CALCULATE call folds its filter arguments into. Transient — never persisted, never the public `FilterContext` contract (sprint brief §47). */
export interface EffectiveContext {
  columnFilters: Map<string, ColumnFilter>
  tableSelections: Map<string, EffectiveTableSelection>
}

function columnKey(ref: ColumnRef): string {
  return `${ref.datasetId}:${ref.tableId}:${ref.columnId}`
}

export function cloneEffectiveContext(ctx: EffectiveContext): EffectiveContext {
  return { columnFilters: new Map(ctx.columnFilters), tableSelections: new Map(ctx.tableSelections) }
}

/**
 * Builds the starting `EffectiveContext` for a measure evaluation from the
 * external (learner/visual-supplied) `FilterContext`. Multiple filters on the
 * same column are folded with the same same-column-intersects rule as
 * `mergeFilterContexts` — this is a normalization for CALCULATE's own
 * bookkeeping, not a behavior change: `resolveFilterContext` already
 * intersects same-table filters row-by-row today, so the resulting row
 * selection is identical either way.
 */
export function buildEffectiveContext(filterContext: FilterContext): EffectiveContext {
  const columnFilters = new Map<string, ColumnFilter>()
  for (const filter of filterContext.filters) {
    const key = columnKey(filter.column)
    const existing = columnFilters.get(key)
    if (!existing) {
      columnFilters.set(key, filter)
      continue
    }
    const existingValues = new Set(existing.values)
    const intersected = filter.values.filter((value) => existingValues.has(value))
    columnFilters.set(key, { column: filter.column, operator: intersected.length <= 1 ? 'equals' : 'in', values: intersected })
  }
  return { columnFilters, tableSelections: new Map() }
}

export function toFilterContext(ctx: EffectiveContext): FilterContext {
  return { filters: [...ctx.columnFilters.values()] }
}

export function toTableSelectionIndexes(ctx: EffectiveContext): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>()
  for (const [modelTableId, selection] of ctx.tableSelections) result.set(modelTableId, selection.includedRowIndexes)
  return result
}

function columnLabel(model: SemanticModel, datasets: Record<string, Dataset>, ref: ColumnRef): string {
  const modelTable = modelTableFor(model, ref)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  const column = resolved?.table.columns.find((c) => c.id === ref.columnId)
  return `${resolved?.table.name ?? 'Unknown table'}[${column?.name ?? ref.columnId}]`
}

/** What actually changed — used to build the `filter-modifier`/`remove-filters`/`table-filter` trace nodes (sprint brief §35-§37), never reconstructed from source text. */
export interface ModifierOutcome {
  kind: FilterModifier['kind']
  label: string
  removedLabels?: string[]
  tableName?: string
  inputRows?: number
  rowsMatched?: number
  /** Sprint 10: a runtime-only failure (e.g. `DATEADD_NON_CONTIGUOUS_CONTEXT`) that can only be detected once the modifier is actually applied — absent for every other modifier kind. */
  diagnostics?: ExpressionDiagnostic[]
  /** Sprint 10: `DateTableReplace`'s rich date-shift trace (sprint brief §46) — built by `computeTimeIntelligenceRowIndexes`, surfaced as-is rather than re-derived. */
  trace?: ExecutionTraceNode
}

/**
 * Applies one bound `FilterModifier` to a working `EffectiveContext` (mutated
 * in place — callers clone first via `cloneEffectiveContext`). `ambientState`
 * is the *enclosing* scope's already-resolved `ResolvedFilterState` — a
 * row-scanning modifier (a direct inequality, or FILTER) reads row visibility
 * from it, so its result is automatically the intersection of "what was
 * already visible" and "what the new predicate matches" (docs/CALCULATE.md
 * "FILTER and the ambient context").
 */
export function applyFilterModifier(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  ctx: EffectiveContext,
  modifier: FilterModifier,
  ambientState: ResolvedFilterState,
): ModifierOutcome {
  switch (modifier.kind) {
    case 'ReplaceColumnFilter': {
      ctx.columnFilters.set(columnKey(modifier.column), { column: modifier.column, operator: modifier.operator, values: modifier.values })
      return { kind: modifier.kind, label: modifier.label }
    }

    case 'RemoveColumns': {
      const keys = new Set(modifier.columns.map(columnKey))
      const removedLabels: string[] = []
      for (const column of modifier.columns) {
        if (ctx.columnFilters.delete(columnKey(column))) removedLabels.push(columnLabel(model, datasets, column))
      }
      for (const [modelTableId, selection] of [...ctx.tableSelections.entries()]) {
        if (selection.scopeColumns && selection.scopeColumns.some((c) => keys.has(columnKey(c)))) {
          ctx.tableSelections.delete(modelTableId)
          removedLabels.push(selection.label)
        }
      }
      return { kind: modifier.kind, label: modifier.label, removedLabels }
    }

    case 'RemoveTables': {
      const tableIds = new Set(modifier.modelTableIds)
      const removedLabels: string[] = []
      for (const [key, filter] of [...ctx.columnFilters.entries()]) {
        const owner = modelTableFor(model, filter.column)
        if (owner && tableIds.has(owner.id)) {
          ctx.columnFilters.delete(key)
          removedLabels.push(columnLabel(model, datasets, filter.column))
        }
      }
      for (const modelTableId of tableIds) {
        const selection = ctx.tableSelections.get(modelTableId)
        if (selection) {
          ctx.tableSelections.delete(modelTableId)
          removedLabels.push(selection.label)
        }
      }
      return { kind: modifier.kind, label: modifier.label, removedLabels }
    }

    case 'ClearAllFilters': {
      const removedLabels = [
        ...[...ctx.columnFilters.values()].map((f) => columnLabel(model, datasets, f.column)),
        ...[...ctx.tableSelections.values()].map((s) => s.label),
      ]
      ctx.columnFilters.clear()
      ctx.tableSelections.clear()
      return { kind: modifier.kind, label: modifier.label, removedLabels }
    }

    case 'PredicateFilter': {
      const modelTable = model.tables.find((t) => t.id === modifier.modelTableId)
      const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
      if (!resolved) {
        return { kind: modifier.kind, label: modifier.label, tableName: 'Unknown table', inputRows: 0, rowsMatched: 0 }
      }

      const totalRows = resolved.table.rowCount
      // Reuses the exact same table-expression evaluator FILTER-as-an-iterator-source
      // relies on (sprint brief §6/§7 "do not maintain two FILTER implementations") —
      // `ambientState` seeds the FilterTable's BaseTable input's visibility, which is
      // what makes a FILTER argument automatically intersect with whatever the caller
      // already had filtered (docs/CALCULATE.md "FILTER and the ambient context").
      const filterTable: BoundFilterTable = {
        kind: 'FilterTable',
        input: { kind: 'BaseTable', modelTableId: modifier.modelTableId, tableName: resolved.table.name, span: { start: 0, end: 0 } },
        modelTableId: modifier.modelTableId,
        predicate: modifier.predicate,
        referencedColumns: modifier.referencedColumns,
        label: modifier.label,
        span: { start: 0, end: 0 },
      }
      const evaluated = evaluateTableExpression(filterTable, { model, datasets, filterState: ambientState })
      const matched = tableExpressionRowIndexSet(evaluated) ?? new Set<number>()
      const inputRows = selectionSize(ambientState.rowSelections.get(modifier.modelTableId) ?? 'all', totalRows)

      if (modifier.tableWide) {
        for (const [key, filter] of [...ctx.columnFilters.entries()]) {
          const owner = modelTableFor(model, filter.column)
          if (owner?.id === modifier.modelTableId) ctx.columnFilters.delete(key)
        }
        ctx.tableSelections.set(modifier.modelTableId, {
          modelTableId: modifier.modelTableId,
          includedRowIndexes: matched,
          totalRows,
          scopeColumns: null,
          label: modifier.label,
        })
      } else {
        for (const column of modifier.referencedColumns) ctx.columnFilters.delete(columnKey(column))
        ctx.tableSelections.set(modifier.modelTableId, {
          modelTableId: modifier.modelTableId,
          includedRowIndexes: matched,
          totalRows,
          scopeColumns: modifier.referencedColumns,
          label: modifier.label,
        })
      }

      return { kind: modifier.kind, label: modifier.label, tableName: resolved.table.name, inputRows, rowsMatched: matched.size }
    }

    case 'DateTableReplace': {
      const modelTableId = modifier.bound.modelTableId
      const modelTable = model.tables.find((t) => t.id === modelTableId)
      const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
      if (!resolved) {
        return { kind: modifier.kind, label: modifier.label, tableName: 'Unknown table', inputRows: 0, rowsMatched: 0 }
      }

      const totalRows = resolved.table.rowCount
      const inputRows = selectionSize(ambientState.rowSelections.get(modelTableId) ?? 'all', totalRows)
      const computed = computeTimeIntelligenceRowIndexes(modifier.bound, model, datasets, ambientState)

      if (computed.diagnostics.length > 0) {
        return {
          kind: modifier.kind,
          label: modifier.label,
          tableName: resolved.table.name,
          inputRows,
          rowsMatched: 0,
          diagnostics: computed.diagnostics,
          trace: computed.trace,
        }
      }

      // Replace — never intersect — every existing filter on the Date Table
      // (sprint brief §20-§22): a time-intelligence date set stands on its
      // own, it doesn't narrow whatever Year/Month filter was already there.
      for (const [key, filter] of [...ctx.columnFilters.entries()]) {
        const owner = modelTableFor(model, filter.column)
        if (owner?.id === modelTableId) ctx.columnFilters.delete(key)
      }
      ctx.tableSelections.set(modelTableId, {
        modelTableId,
        includedRowIndexes: computed.rowIndexes,
        totalRows,
        scopeColumns: null,
        label: modifier.label,
      })

      return {
        kind: modifier.kind,
        label: modifier.label,
        tableName: resolved.table.name,
        inputRows,
        rowsMatched: computed.rowIndexes.size,
        trace: computed.trace,
      }
    }
  }
}
