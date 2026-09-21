import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import { diagnostic, type ExpressionDiagnostic } from '../../expression/diagnostics'
import type { ExecutionTraceNode } from '../../expression/trace'
import {
  addYearsClassic,
  compareModelDates,
  formatModelDate,
  parseModelDate,
  shiftByInterval,
  startOfYear,
  type ModelDate,
} from '../dateTable/dateMath'
import { visibleRowIndices, type ResolvedFilterState } from '../measure/filterPropagation'
import { resolveTableRef } from '../model/modelRuntime'
import type { EvaluatedTableExpression, TableExpressionEvalContext } from '../tableExpression/tableExpressionEvaluator'
import type { BoundTimeIntelligenceTable } from '../tableExpression/tableExpressionTypes'

interface ResolvedDateTable {
  modelTableId: string
  tableName: string
  rows: Record<string, unknown>[]
  dateColumnName: string
  /** Full-table `YYYY-MM-DD` → row index, built once per evaluation — O(date-table size), never scanned per visible date (sprint brief §69-§70). */
  dateIndex: Map<string, number>
}

function resolveDateTable(
  bound: BoundTimeIntelligenceTable,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
): ResolvedDateTable | undefined {
  const modelTable = model.tables.find((t) => t.id === bound.modelTableId)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  if (!resolved) return undefined

  const dateIndex = new Map<string, number>()
  resolved.table.rows.forEach((row, rowIndex) => {
    const parsed = parseModelDate(row[bound.dateColumnName])
    if (!parsed) return
    const key = formatModelDate(parsed)
    if (!dateIndex.has(key)) dateIndex.set(key, rowIndex)
  })

  return { modelTableId: bound.modelTableId, tableName: bound.tableName, rows: resolved.table.rows, dateColumnName: bound.dateColumnName, dateIndex }
}

/** The distinct, sorted set of currently-visible dates on the date table, under `filterState` — the "current visible date set" every operation starts from (sprint brief §18-§34). */
function visibleDates(dateTable: ResolvedDateTable, filterState: ResolvedFilterState): ModelDate[] {
  const totalRows = dateTable.rows.length
  const visibleIndexes = visibleRowIndices(filterState, dateTable.modelTableId, totalRows)
  const seen = new Map<string, ModelDate>()
  for (const rowIndex of visibleIndexes) {
    const parsed = parseModelDate(dateTable.rows[rowIndex][dateTable.dateColumnName])
    if (!parsed) continue
    seen.set(formatModelDate(parsed), parsed)
  }
  return [...seen.values()].sort(compareModelDates)
}

function rowIndexesForDates(dateTable: ResolvedDateTable, dates: Iterable<ModelDate>): Set<number> {
  const result = new Set<number>()
  for (const date of dates) {
    const rowIndex = dateTable.dateIndex.get(formatModelDate(date))
    if (rowIndex !== undefined) result.add(rowIndex)
  }
  return result
}

/** Every date table row between `start` and `end` inclusive that actually exists in `dateIndex` — omits gaps rather than inventing rows (sprint brief §27 "Result only contains dates present in the marked Date column"). */
function rowIndexesInRange(dateTable: ResolvedDateTable, start: ModelDate, end: ModelDate): Set<number> {
  const result = new Set<number>()
  for (const [key, rowIndex] of dateTable.dateIndex) {
    const parsed = parseModelDate(key)
    if (!parsed) continue
    if (compareModelDates(parsed, start) >= 0 && compareModelDates(parsed, end) <= 0) result.add(rowIndex)
  }
  return result
}

function isContiguous(dates: ModelDate[]): boolean {
  for (let i = 1; i < dates.length; i += 1) {
    const expected = shiftByInterval(dates[i - 1], 1, 'DAY')
    if (compareModelDates(expected, dates[i]) !== 0) return false
  }
  return true
}

function periodLabel(dates: ModelDate[]): string {
  if (dates.length === 0) return 'No visible dates'
  const start = formatModelDate(dates[0])
  const end = formatModelDate(dates[dates.length - 1])
  return start === end ? `${start} (1 date)` : `${start} → ${end} (${dates.length} dates)`
}

export interface TimeIntelligenceComputation {
  rowIndexes: Set<number>
  diagnostics: ExpressionDiagnostic[]
  trace: ExecutionTraceNode
}

/**
 * Computes the target Date Table row set for a bound time-intelligence
 * operation, reading "currently visible dates" from `filterState` — the
 * ambient/outer context when called from CALCULATE's `DateTableReplace`
 * modifier (docs/TIME_INTELLIGENCE.md "CALCULATE integration"), or the
 * current context directly when the operation is used as a bare table
 * expression (`COUNTROWS(DATESYTD(...))`, sprint brief §37). Complexity is
 * O(visible dates + date table size) — never scans the fact table (sprint
 * brief §69).
 */
export function computeTimeIntelligenceRowIndexes(
  bound: BoundTimeIntelligenceTable,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  filterState: ResolvedFilterState,
): TimeIntelligenceComputation {
  const dateTable = resolveDateTable(bound, model, datasets)
  if (!dateTable) {
    return {
      rowIndexes: new Set(),
      diagnostics: [diagnostic('error', 'TIME_INTELLIGENCE_INVALID_ARGUMENT', 'The Date Table could not be resolved.')],
      trace: { kind: 'time-intelligence', label: bound.label, metadata: { error: true } },
    }
  }

  const current = visibleDates(dateTable, filterState)
  const dateTableTrace: ExecutionTraceNode = { kind: 'date-table', label: dateTable.tableName }
  const currentTrace: ExecutionTraceNode = { kind: 'date-period', label: `Current visible dates: ${periodLabel(current)}` }

  switch (bound.operation) {
    case 'same-period-last-year': {
      const shifted = current.map((d) => addYearsClassic(d, -1))
      const rowIndexes = rowIndexesForDates(dateTable, shifted)
      const resultDates = [...shifted].sort(compareModelDates)
      return {
        rowIndexes,
        diagnostics: [],
        trace: {
          kind: 'time-intelligence',
          label: bound.label,
          metadata: { operation: 'SAMEPERIODLASTYEAR', currentCount: current.length, resultCount: rowIndexes.size },
          children: [
            dateTableTrace,
            currentTrace,
            { kind: 'date-shift', label: 'Shift: -1 YEAR (classic)' },
            { kind: 'date-period', label: `Result: ${periodLabel(resultDates)}` },
          ],
        },
      }
    }

    case 'date-add': {
      if (current.length > 1 && !isContiguous(current)) {
        return {
          rowIndexes: new Set(),
          diagnostics: [
            diagnostic(
              'error',
              'DATEADD_NON_CONTIGUOUS_CONTEXT',
              'DATEADD requires the current date context to be a contiguous range of days — the visible dates on the Date Table have gaps.',
            ),
          ],
          trace: { kind: 'time-intelligence', label: bound.label, metadata: { error: true, currentCount: current.length } },
        }
      }
      const unit = bound.intervalUnit ?? 'DAY'
      const count = bound.intervalCount ?? 0
      const shifted = current.map((d) => shiftByInterval(d, count, unit))
      const rowIndexes = rowIndexesForDates(dateTable, shifted)
      const resultDates = [...shifted].sort(compareModelDates)
      return {
        rowIndexes,
        diagnostics: [],
        trace: {
          kind: 'time-intelligence',
          label: bound.label,
          metadata: { operation: 'DATEADD', currentCount: current.length, resultCount: rowIndexes.size },
          children: [
            dateTableTrace,
            currentTrace,
            { kind: 'date-shift', label: `Shift: ${count >= 0 ? '+' : ''}${count} ${unit}` },
            { kind: 'date-period', label: `Result: ${periodLabel(resultDates)}` },
          ],
        },
      }
    }

    case 'previous-month': {
      if (current.length === 0) {
        return { rowIndexes: new Set(), diagnostics: [], trace: { kind: 'time-intelligence', label: bound.label, metadata: { currentCount: 0, resultCount: 0 } } }
      }
      const first = current[0]
      const previousMonthAnchor = shiftByInterval({ year: first.year, month: first.month, day: 1 }, -1, 'MONTH')
      const start = { year: previousMonthAnchor.year, month: previousMonthAnchor.month, day: 1 }
      const end = shiftByInterval(shiftByInterval(start, 1, 'MONTH'), -1, 'DAY')
      const rowIndexes = rowIndexesInRange(dateTable, start, end)
      return {
        rowIndexes,
        diagnostics: [],
        trace: {
          kind: 'time-intelligence',
          label: bound.label,
          metadata: { operation: 'PREVIOUSMONTH', currentCount: current.length, resultCount: rowIndexes.size },
          children: [
            dateTableTrace,
            currentTrace,
            { kind: 'date-shift', label: 'Previous calendar month of the first visible date' },
            { kind: 'date-period', label: `Result: ${formatModelDate(start)} → ${formatModelDate(end)} (${rowIndexes.size} dates)` },
          ],
        },
      }
    }

    case 'previous-year': {
      if (current.length === 0) {
        return { rowIndexes: new Set(), diagnostics: [], trace: { kind: 'time-intelligence', label: bound.label, metadata: { currentCount: 0, resultCount: 0 } } }
      }
      const first = current[0]
      const year = first.year - 1
      const start: ModelDate = { year, month: 1, day: 1 }
      const end: ModelDate = { year, month: 12, day: 31 }
      const rowIndexes = rowIndexesInRange(dateTable, start, end)
      return {
        rowIndexes,
        diagnostics: [],
        trace: {
          kind: 'time-intelligence',
          label: bound.label,
          metadata: { operation: 'PREVIOUSYEAR', currentCount: current.length, resultCount: rowIndexes.size },
          children: [
            dateTableTrace,
            currentTrace,
            { kind: 'date-shift', label: 'Previous calendar year of the first visible date' },
            { kind: 'date-period', label: `Result: ${formatModelDate(start)} → ${formatModelDate(end)} (${rowIndexes.size} dates)` },
          ],
        },
      }
    }

    case 'dates-ytd': {
      if (current.length === 0) {
        return { rowIndexes: new Set(), diagnostics: [], trace: { kind: 'time-intelligence', label: bound.label, metadata: { currentCount: 0, resultCount: 0 } } }
      }
      const last = current[current.length - 1]
      const start = startOfYear(last)
      const rowIndexes = rowIndexesInRange(dateTable, start, last)
      return {
        rowIndexes,
        diagnostics: [],
        trace: {
          kind: 'time-intelligence',
          label: bound.label,
          metadata: { operation: 'DATESYTD', currentCount: current.length, resultCount: rowIndexes.size },
          children: [
            dateTableTrace,
            currentTrace,
            { kind: 'date-shift', label: 'Start of year through the last visible date' },
            { kind: 'date-period', label: `Result: ${formatModelDate(start)} → ${formatModelDate(last)} (${rowIndexes.size} dates)` },
          ],
        },
      }
    }
  }
}

/** Evaluates a `BoundTimeIntelligenceTable` as a standalone table expression (`COUNTROWS(DATESYTD(...))`, sprint brief §37) — the identical computation `applyFilterModifier`'s `DateTableReplace` case uses for CALCULATE, just against `ctx.filterState` directly instead of an ambient outer state. */
export function evaluateTimeIntelligenceTable(
  bound: BoundTimeIntelligenceTable,
  ctx: TableExpressionEvalContext,
): EvaluatedTableExpression {
  const computed = computeTimeIntelligenceRowIndexes(bound, ctx.model, ctx.datasets, ctx.filterState)
  const modelTable = ctx.model.tables.find((t) => t.id === bound.modelTableId)
  const resolved = modelTable ? resolveTableRef(ctx.datasets, modelTable) : undefined
  const rows = resolved
    ? [...computed.rowIndexes]
        .sort((a, b) => a - b)
        .map((rowIndex) => ({ kind: 'model-row' as const, modelTableId: bound.modelTableId, rowIndex, row: resolved.table.rows[rowIndex] }))
    : []

  return {
    rows,
    modelTableId: bound.modelTableId,
    trace: computed.trace,
    diagnostics: computed.diagnostics.length > 0 ? computed.diagnostics : undefined,
  }
}
