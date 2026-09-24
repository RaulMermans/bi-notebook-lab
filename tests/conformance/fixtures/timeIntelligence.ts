import type { Dataset } from '../../../src/domain/data'
import type { ColumnRef } from '../../../src/domain/model'
import type { ConformanceModelFixture, DaxConformanceCase } from '../../../src/conformance/types'
import { markDateTable } from '../../../src/runtime/dateTable/dateTableRuntime'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'

/**
 * A dedicated Calendar (marked Date Table, 2024-2025) + Sales fixture —
 * adapted from `tests/runtime/measure/timeIntelligence.test.ts`'s fixture
 * shape (brief instructions point there for a working pattern). Every
 * expected value below is hand-derived from `SALES_ROWS`, never from
 * calling the engine under test.
 *
 *   OrderID  Date         Country  Revenue
 *     1      2024-03-05   Spain     100
 *     2      2024-03-20   France    200
 *     3      2025-03-05   Spain     150
 *     4      2025-03-20   France    250
 *     5      2025-02-10   Spain      80
 *     6      2025-02-15   France     90
 *     7      2025-01-05   Spain      60
 *     8      2025-04-01   France     70
 *     9      2024-01-10   Spain      40
 *
 *   All of 2024:        100 + 200 + 40 = 340
 *   March 2024:         100 + 200 = 300
 *   Feb 2025:            80 + 90 = 170
 *   YTD through 2025-04-01: Jan(60) + Feb(80+90) + Mar(150+250) + Apr1(70) = 700
 */
function buildFixture(): ConformanceModelFixture & { calendarDs: Dataset } {
  const calendarRows: unknown[][] = []
  for (const year of [2024, 2025]) {
    const start = new Date(Date.UTC(year, 0, 1))
    const end = new Date(Date.UTC(year, 11, 31))
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      calendarRows.push([d.toISOString().slice(0, 10), d.getUTCFullYear(), d.getUTCMonth() + 1])
    }
  }

  const calendarDs: Dataset = {
    id: 'ti-calendar-ds',
    name: 'Calendar',
    source: { type: 'sample', key: 'calendar' },
    tables: [
      {
        id: 'calendar-table',
        name: 'Calendar',
        columns: [
          { id: 'cal-date', name: 'Date', dataType: 'date', nullable: false },
          { id: 'cal-year', name: 'Year', dataType: 'integer', nullable: false },
          { id: 'cal-month', name: 'MonthNumber', dataType: 'integer', nullable: false },
        ],
        rows: calendarRows.map(([date, year, month]) => ({ Date: date, Year: year, MonthNumber: month })),
        rowCount: calendarRows.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const SALES_ROWS: [number, string, string, number][] = [
    [1, '2024-03-05', 'Spain', 100],
    [2, '2024-03-20', 'France', 200],
    [3, '2025-03-05', 'Spain', 150],
    [4, '2025-03-20', 'France', 250],
    [5, '2025-02-10', 'Spain', 80],
    [6, '2025-02-15', 'France', 90],
    [7, '2025-01-05', 'Spain', 60],
    [8, '2025-04-01', 'France', 70],
    [9, '2024-01-10', 'Spain', 40],
  ]

  const salesDs: Dataset = {
    id: 'ti-sales-ds',
    name: 'Sales',
    source: { type: 'sample', key: 'sales' },
    tables: [
      {
        id: 'sales-table',
        name: 'Sales',
        columns: [
          { id: 'sales-orderid', name: 'OrderID', dataType: 'integer', nullable: false },
          { id: 'sales-date', name: 'Date', dataType: 'date', nullable: false },
          { id: 'sales-country', name: 'Country', dataType: 'string', nullable: false },
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
        ],
        rows: SALES_ROWS.map(([OrderID, Date, Country, Revenue]) => ({ OrderID, Date, Country, Revenue })),
        rowCount: SALES_ROWS.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = { [calendarDs.id]: calendarDs, [salesDs.id]: salesDs }
  let model = createModel('Conformance Time Intelligence Fixture')
  model = addTable(model, { datasetId: calendarDs.id, tableId: 'calendar-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })

  const calendarTableId = model.tables.find((t) => t.datasetId === calendarDs.id)!.id
  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

  const relResult = createRelationship(
    model,
    {
      one: { datasetId: calendarDs.id, tableId: 'calendar-table', columnId: 'cal-date' },
      many: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-date' },
    },
    datasets,
  )
  model = relResult.model

  const dateColumn: ColumnRef = { datasetId: calendarDs.id, tableId: 'calendar-table', columnId: 'cal-date' }
  const marked = markDateTable(model, datasets, calendarTableId, dateColumn)
  model = marked.model

  return { model, datasets, homeModelTableId: salesTableId, calendarDs }
}

const fixture = buildFixture()

function yearMonthFilter(year: number, month?: number) {
  const filters: { column: { datasetId: string; tableId: string; columnId: string }; operator: 'equals'; values: unknown[] }[] = [
    { column: { datasetId: fixture.calendarDs.id, tableId: 'calendar-table', columnId: 'cal-year' }, operator: 'equals', values: [year] },
  ]
  if (month !== undefined) {
    filters.push({ column: { datasetId: fixture.calendarDs.id, tableId: 'calendar-table', columnId: 'cal-month' }, operator: 'equals', values: [month] })
  }
  return { filters }
}

function dateFilter(date: string) {
  return { filters: [{ column: { datasetId: fixture.calendarDs.id, tableId: 'calendar-table', columnId: 'cal-date' }, operator: 'equals' as const, values: [date] }] }
}

/** Classic time intelligence (SAMEPERIODLASTYEAR, PREVIOUSYEAR, PREVIOUSMONTH, DATESYTD/TOTALYTD) — see docs/TIME_INTELLIGENCE.md. */
export const TIME_INTELLIGENCE_CASES: DaxConformanceCase[] = [
  {
    id: 'timeIntelligence-001',
    category: 'Time intelligence',
    description: 'SAMEPERIODLASTYEAR under a Year=2025 filter matches the whole-of-2024 total',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), SAMEPERIODLASTYEAR(Calendar[Date]))',
    evaluationMode: 'measure',
    filterContext: yearMonthFilter(2025),
    expected: 340, // 100 + 200 + 40
    provenance: 'hand-calculated',
  },
  {
    id: 'timeIntelligence-002',
    category: 'Time intelligence',
    description: 'SAMEPERIODLASTYEAR narrows to just the shifted month when the current context is Year=2025, Month=3',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), SAMEPERIODLASTYEAR(Calendar[Date]))',
    evaluationMode: 'measure',
    filterContext: yearMonthFilter(2025, 3),
    expected: 300, // March 2024: 100 + 200
    provenance: 'hand-calculated',
  },
  {
    id: 'timeIntelligence-003',
    category: 'Time intelligence',
    description: 'PREVIOUSYEAR returns the *whole* previous year, unlike SAMEPERIODLASTYEAR which mirrors just the current month',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), PREVIOUSYEAR(Calendar[Date]))',
    evaluationMode: 'measure',
    filterContext: yearMonthFilter(2025, 3),
    expected: 340, // all of 2024, not just March 2024 (contrast with timeIntelligence-002's 300)
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'timeIntelligence-004',
    category: 'Time intelligence',
    description: 'PREVIOUSMONTH shifts a Year=2025, Month=3 context back to the full month of February 2025',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), PREVIOUSMONTH(Calendar[Date]))',
    evaluationMode: 'measure',
    filterContext: yearMonthFilter(2025, 3),
    expected: 170, // Feb 2025: 80 + 90
    provenance: 'hand-calculated',
  },
  {
    id: 'timeIntelligence-005',
    category: 'Time intelligence',
    description: 'DATESYTD accumulates from January 1st through the last visible date in the year',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), DATESYTD(Calendar[Date]))',
    evaluationMode: 'measure',
    filterContext: dateFilter('2025-04-01'),
    expected: 700, // Jan(60) + Feb(80+90) + Mar(150+250) + Apr1(70)
    provenance: 'hand-calculated',
  },
  {
    id: 'timeIntelligence-006',
    category: 'Time intelligence',
    description: 'TOTALYTD(measure-expr, dateColumn) is a documented shorthand equivalent to CALCULATE(measure-expr, DATESYTD(dateColumn))',
    fixture,
    expression: 'TOTALYTD(SUM(Sales[Revenue]), Calendar[Date])',
    evaluationMode: 'measure',
    filterContext: dateFilter('2025-04-01'),
    expected: 700,
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'timeIntelligence-007',
    category: 'Time intelligence',
    description: 'PREVIOUSYEAR is BLANK, not zero or an error, when the prior year does not exist in the Date Table',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), PREVIOUSYEAR(Calendar[Date]))',
    evaluationMode: 'measure',
    filterContext: yearMonthFilter(2024),
    expected: null, // 2023 isn't in the Calendar table at all
    provenance: 'documented-dax-semantics',
  },
]
