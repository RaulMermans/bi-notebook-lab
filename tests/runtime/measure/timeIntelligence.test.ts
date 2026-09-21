import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { ColumnRef, SemanticModel } from '../../../src/domain/model'
import { markDateTable } from '../../../src/runtime/dateTable/dateTableRuntime'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'

/**
 * Sprint 10 (Classic Time Intelligence). A small, hand-computed Calendar +
 * Sales fixture spanning 2024-2025 (mirrors the bundled Retail sample's
 * date range, sprint brief §51) — every expected value below is derived by
 * hand from the raw `SALES_ROWS` below, never re-derived through the engine
 * under test (mirrors `calculate.test.ts`'s fixture style).
 */
function buildFixture() {
  const calendarRows: unknown[][] = []
  for (const year of [2024, 2025]) {
    const start = new Date(Date.UTC(year, 0, 1))
    const end = new Date(Date.UTC(year, 11, 31))
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      calendarRows.push([d.toISOString().slice(0, 10), d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()])
    }
  }

  const calendarDs: Dataset = {
    id: 'calendar-ds',
    name: 'Calendar',
    source: { type: 'sample', key: 'calendar' },
    tables: [
      {
        id: 'calendar-table',
        name: 'Calendar',
        columns: [
          { id: 'cal-date', name: 'Date', dataType: 'date', nullable: false },
          { id: 'cal-year', name: 'Year', dataType: 'integer', nullable: false },
          { id: 'cal-monthnumber', name: 'MonthNumber', dataType: 'integer', nullable: false },
          { id: 'cal-day', name: 'Day', dataType: 'integer', nullable: false },
        ],
        rows: calendarRows.map(([date, year, monthNumber, day]) => ({ Date: date, Year: year, MonthNumber: monthNumber, Day: day })),
        rowCount: calendarRows.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  // OrderID, Date, Country, Category, Revenue — hand-picked so every scenario below can be verified by inspection.
  const SALES_ROWS: [number, string, string, string, number][] = [
    [1, '2024-03-05', 'Spain', 'Furniture', 100], // March 2024, Spain
    [2, '2024-03-20', 'France', 'Electronics', 200], // March 2024, France
    [3, '2025-03-05', 'Spain', 'Furniture', 150], // March 2025, Spain
    [4, '2025-03-20', 'France', 'Electronics', 250], // March 2025, France
    [5, '2025-02-10', 'Spain', 'Furniture', 80], // Feb 2025, Spain
    [6, '2025-02-15', 'France', 'Electronics', 90], // Feb 2025, France
    [7, '2025-01-05', 'Spain', 'Furniture', 60], // Jan 2025, Spain
    [8, '2025-04-01', 'France', 'Electronics', 70], // Apr 2025, France
    [9, '2024-01-10', 'Spain', 'Furniture', 40], // Jan 2024, Spain
    [10, '2025-12-31', 'France', 'Electronics', 500], // Dec 2025, France
  ]

  const salesDs: Dataset = {
    id: 'sales-ds',
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
          { id: 'sales-category', name: 'Category', dataType: 'string', nullable: false },
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
        ],
        rows: SALES_ROWS.map(([OrderID, Date, Country, Category, Revenue]) => ({ OrderID, Date, Country, Category, Revenue })),
        rowCount: SALES_ROWS.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = { [calendarDs.id]: calendarDs, [salesDs.id]: salesDs }

  let model = createModel('Time Intelligence Fixture')
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
  expect(relResult.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  model = relResult.model
  const relationshipId = relResult.relationship!.id

  const dateColumn: ColumnRef = { datasetId: calendarDs.id, tableId: 'calendar-table', columnId: 'cal-date' }
  const marked = markDateTable(model, datasets, calendarTableId, dateColumn)
  expect(marked.diagnostics).toEqual([])
  model = marked.model

  const totalRevenue = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
  expect(totalRevenue.diagnostics).toEqual([])
  model = totalRevenue.model

  return { model, datasets, calendarDs, salesDs, calendarTableId, salesTableId, relationshipId }
}

function withMeasure(model: SemanticModel, datasets: Record<string, Dataset>, homeModelTableId: string, name: string, expression: string) {
  const result = createMeasure(model, datasets, { homeModelTableId, name, expression })
  return result
}

function measureId(model: SemanticModel, name: string): string {
  return model.measures.find((m) => m.name === name)!.id
}

function columnFilter(datasetId: string, tableId: string, columnId: string, values: unknown[]) {
  return { column: { datasetId, tableId, columnId }, operator: (values.length > 1 ? 'in' : 'equals') as 'equals' | 'in', values }
}

describe('Sprint 10 — Classic Time Intelligence', () => {
  it('SAMEPERIODLASTYEAR under Year=2025 matches the independently computed 2024 total', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue LY', 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))')
    expect(withM.diagnostics).toEqual([])

    const yearFilter = { filters: [columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2025])] }
    const result = evaluateMeasure(withM.model, datasets, measureId(withM.model, 'Revenue LY'), yearFilter)
    expect(result.value).toBeCloseTo(340, 6) // 100 + 200 + 40 (all of 2024)
  })

  it('critical filter-replacement regression: Year=2025 + Month=March gives March 2024, never blank (sprint brief §20/§63)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue LY', 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))')
    expect(withM.diagnostics).toEqual([])

    const context = {
      filters: [
        columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2025]),
        columnFilter(calendarDs.id, 'calendar-table', 'cal-monthnumber', [3]),
      ],
    }
    const result = evaluateMeasure(withM.model, datasets, measureId(withM.model, 'Revenue LY'), context)
    expect(result.value).toBeCloseTo(300, 6) // March 2024: 100 + 200
    expect(result.value).not.toBe(0)
    expect(result.value).not.toBeNull()
  })

  it('an unrelated Country filter on Sales survives Date Table filter replacement (sprint brief §40-§41)', () => {
    const { model, datasets, calendarDs, salesDs, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue LY', 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))')
    expect(withM.diagnostics).toEqual([])

    const context = {
      filters: [
        columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2025]),
        columnFilter(calendarDs.id, 'calendar-table', 'cal-monthnumber', [3]),
        columnFilter(salesDs.id, 'sales-table', 'sales-country', ['Spain']),
      ],
    }
    const result = evaluateMeasure(withM.model, datasets, measureId(withM.model, 'Revenue LY'), context)
    expect(result.value).toBeCloseTo(100, 6) // Spain, March 2024 only
  })

  it('DATEADD(Calendar[Date], -1, MONTH) under March 2025 matches the February 2025 total', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const withM = withMeasure(
      model,
      datasets,
      salesTableId,
      'Revenue Previous Month Shift',
      'CALCULATE([Total Revenue], DATEADD(Calendar[Date], -1, MONTH))',
    )
    expect(withM.diagnostics).toEqual([])

    const context = {
      filters: [
        columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2025]),
        columnFilter(calendarDs.id, 'calendar-table', 'cal-monthnumber', [3]),
      ],
    }
    const result = evaluateMeasure(withM.model, datasets, measureId(withM.model, 'Revenue Previous Month Shift'), context)
    expect(result.value).toBeCloseTo(170, 6) // Feb 2025: 80 + 90
  })

  it('PREVIOUSMONTH matches DATEADD(-1, MONTH) for a full-month current context', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue PM', 'CALCULATE([Total Revenue], PREVIOUSMONTH(Calendar[Date]))')
    expect(withM.diagnostics).toEqual([])

    const context = {
      filters: [
        columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2025]),
        columnFilter(calendarDs.id, 'calendar-table', 'cal-monthnumber', [3]),
      ],
    }
    const result = evaluateMeasure(withM.model, datasets, measureId(withM.model, 'Revenue PM'), context)
    expect(result.value).toBeCloseTo(170, 6)
  })

  it('PREVIOUSMONTH returns the *whole* previous month even from a single mid-month day (sprint brief §30)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue PM', 'CALCULATE([Total Revenue], PREVIOUSMONTH(Calendar[Date]))')
    expect(withM.diagnostics).toEqual([])

    // A single day deep in March 2025 — PREVIOUSMONTH must still return all of Feb 2025, not just Feb 20.
    const context = { filters: [columnFilter(calendarDs.id, 'calendar-table', 'cal-date', ['2025-03-20'])] }
    const result = evaluateMeasure(withM.model, datasets, measureId(withM.model, 'Revenue PM'), context)
    expect(result.value).toBeCloseTo(170, 6)
  })

  it('PREVIOUSYEAR returns the full previous year, distinct from SAMEPERIODLASTYEAR (sprint brief §31/§59)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    let m = withMeasure(model, datasets, salesTableId, 'Revenue PY', 'CALCULATE([Total Revenue], PREVIOUSYEAR(Calendar[Date]))')
    expect(m.diagnostics).toEqual([])
    m = withMeasure(m.model, datasets, salesTableId, 'Revenue LY', 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))')
    expect(m.diagnostics).toEqual([])

    const context = {
      filters: [
        columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2025]),
        columnFilter(calendarDs.id, 'calendar-table', 'cal-monthnumber', [3]),
      ],
    }
    const previousYear = evaluateMeasure(m.model, datasets, measureId(m.model, 'Revenue PY'), context)
    const sameLastYear = evaluateMeasure(m.model, datasets, measureId(m.model, 'Revenue LY'), context)

    expect(previousYear.value).toBeCloseTo(340, 6) // all of 2024
    expect(sameLastYear.value).toBeCloseTo(300, 6) // just March 2024
    expect(previousYear.value).not.toBe(sameLastYear.value)
  })

  it('PREVIOUSYEAR is BLANK when the prior year does not exist in the Date Table (sprint brief §51)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue PY', 'CALCULATE([Total Revenue], PREVIOUSYEAR(Calendar[Date]))')
    expect(withM.diagnostics).toEqual([])

    const context = { filters: [columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2024])] }
    const result = evaluateMeasure(withM.model, datasets, measureId(withM.model, 'Revenue PY'), context)
    expect(result.value).toBeNull()
  })

  it('DATESYTD accumulates from Jan 1 through the last visible date', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue YTD Explicit', 'CALCULATE([Total Revenue], DATESYTD(Calendar[Date]))')
    expect(withM.diagnostics).toEqual([])

    const context = { filters: [columnFilter(calendarDs.id, 'calendar-table', 'cal-date', ['2025-04-01'])] }
    const result = evaluateMeasure(withM.model, datasets, measureId(withM.model, 'Revenue YTD Explicit'), context)
    expect(result.value).toBeCloseTo(700, 6) // Jan(60) + Feb(80+90) + Mar(150+250) + Apr1(70)
  })

  it('TOTALYTD equals CALCULATE + DATESYTD under no filter, a Country filter and a combined filter (sprint brief §61)', () => {
    const { model, datasets, calendarDs, salesDs, salesTableId } = buildFixture()
    let m = withMeasure(model, datasets, salesTableId, 'Revenue YTD', 'TOTALYTD([Total Revenue], Calendar[Date])')
    expect(m.diagnostics).toEqual([])
    m = withMeasure(m.model, datasets, salesTableId, 'Revenue YTD Explicit', 'CALCULATE([Total Revenue], DATESYTD(Calendar[Date]))')
    expect(m.diagnostics).toEqual([])

    const dateContext = columnFilter(calendarDs.id, 'calendar-table', 'cal-date', ['2025-04-01'])
    const spainContext = columnFilter(salesDs.id, 'sales-table', 'sales-country', ['Spain'])

    for (const filters of [[dateContext], [dateContext, spainContext]]) {
      const ytd = evaluateMeasure(m.model, datasets, measureId(m.model, 'Revenue YTD'), { filters })
      const ytdExplicit = evaluateMeasure(m.model, datasets, measureId(m.model, 'Revenue YTD Explicit'), { filters })
      expect(ytd.value).toBeCloseTo(ytdExplicit.value as number, 6)
    }

    const spainOnly = evaluateMeasure(m.model, datasets, measureId(m.model, 'Revenue YTD'), { filters: [dateContext, spainContext] })
    expect(spainOnly.value).toBeCloseTo(290, 6) // Spain Jan(60) + Feb(80) + Mar(150)
  })

  it('DATESYTD is an empty table (not an error) when no dates are visible (sprint brief §33)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Rows YTD', 'COUNTROWS(DATESYTD(Calendar[Date]))')
    expect(withM.diagnostics).toEqual([])

    const context = { filters: [columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2099])] }
    const result = evaluateMeasure(withM.model, datasets, measureId(withM.model, 'Rows YTD'), context)
    expect(result.diagnostics).toEqual([])
    expect(result.value).toBe(0)
  })

  it('COUNTROWS(SAMEPERIODLASTYEAR(...)) works as a bare table expression, not only inside CALCULATE (sprint brief §37)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'LY Day Count', 'COUNTROWS(SAMEPERIODLASTYEAR(Calendar[Date]))')
    expect(withM.diagnostics).toEqual([])

    const context = {
      filters: [
        columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2025]),
        columnFilter(calendarDs.id, 'calendar-table', 'cal-monthnumber', [3]),
      ],
    }
    const result = evaluateMeasure(withM.model, datasets, measureId(withM.model, 'LY Day Count'), context)
    expect(result.value).toBe(31) // March has 31 days both years — no leap-day loss
  })

  it('Revenue YoY / YoY% compose from Total Revenue and Revenue LY without leaking cached values across CALCULATE scopes (sprint brief §43/§65)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    let m = withMeasure(model, datasets, salesTableId, 'Revenue LY', 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))')
    expect(m.diagnostics).toEqual([])
    m = withMeasure(m.model, datasets, salesTableId, 'Revenue YoY', '[Total Revenue] - [Revenue LY]')
    expect(m.diagnostics).toEqual([])
    m = withMeasure(m.model, datasets, salesTableId, 'Revenue YoY %', 'DIVIDE([Revenue YoY], [Revenue LY])')
    expect(m.diagnostics).toEqual([])

    const context = {
      filters: [
        columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2025]),
        columnFilter(calendarDs.id, 'calendar-table', 'cal-monthnumber', [3]),
      ],
    }
    const totalRevenue = evaluateMeasure(m.model, datasets, measureId(m.model, 'Total Revenue'), context).value as number
    const yoy = evaluateMeasure(m.model, datasets, measureId(m.model, 'Revenue YoY'), context).value as number
    const yoyPct = evaluateMeasure(m.model, datasets, measureId(m.model, 'Revenue YoY %'), context).value as number

    expect(totalRevenue).toBeCloseTo(400, 6) // March 2025, unaffected by the LY calculation inside a sibling measure
    expect(yoy).toBeCloseTo(100, 6) // 400 - 300
    expect(yoyPct).toBeCloseTo(100 / 300, 6)
  })

  it('IF can branch on a time-intelligence measure reference with no special handling (sprint brief §66)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    let m = withMeasure(model, datasets, salesTableId, 'Revenue LY', 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))')
    expect(m.diagnostics).toEqual([])
    m = withMeasure(m.model, datasets, salesTableId, 'Revenue LY Status', 'IF([Revenue LY] > 200, "High", "Low")')
    expect(m.diagnostics).toEqual([])

    const context = {
      filters: [
        columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2025]),
        columnFilter(calendarDs.id, 'calendar-table', 'cal-monthnumber', [3]),
      ],
    }
    const result = evaluateMeasure(m.model, datasets, measureId(m.model, 'Revenue LY Status'), context)
    expect(result.value).toBe('High')
  })

  it('DATEADD rejects a non-contiguous current date context (sprint brief §26)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue PM Shift', 'CALCULATE([Total Revenue], DATEADD(Calendar[Date], -1, MONTH))')
    expect(withM.diagnostics).toEqual([])

    const context = {
      filters: [
        columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2025]),
        columnFilter(calendarDs.id, 'calendar-table', 'cal-monthnumber', [1]),
        columnFilter(calendarDs.id, 'calendar-table', 'cal-day', [1, 2, 4]), // skips Jan 3rd — non-contiguous
      ],
    }
    const result = evaluateMeasure(withM.model, datasets, measureId(withM.model, 'Revenue PM Shift'), context)
    expect(result.diagnostics.map((d) => d.code)).toContain('DATEADD_NON_CONTIGUOUS_CONTEXT')
  })

  it('DATEADD rejects a non-integer interval count at bind time (sprint brief §25)', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Bad DATEADD', 'CALCULATE([Total Revenue], DATEADD(Calendar[Date], 1.5, MONTH))')
    expect(withM.diagnostics.map((d) => d.code)).toContain('DATEADD_INTERVAL_COUNT_INVALID')
  })

  it('DATEADD rejects an unsupported/quoted interval unit at bind time (sprint brief §23-§24)', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const quoted = withMeasure(model, datasets, salesTableId, 'Bad DATEADD 2', 'CALCULATE([Total Revenue], DATEADD(Calendar[Date], -1, "MONTH"))')
    expect(quoted.diagnostics.map((d) => d.code)).toContain('DATEADD_INVALID_INTERVAL')

    const unsupported = withMeasure(model, datasets, salesTableId, 'Bad DATEADD 3', 'CALCULATE([Total Revenue], DATEADD(Calendar[Date], -1, WEEK))')
    expect(unsupported.diagnostics.map((d) => d.code)).toContain('DATEADD_INVALID_INTERVAL')
  })

  it('rejects a time-intelligence function on a column that is not the canonical column of a marked Date Table (sprint brief §16)', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Bad LY', 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Sales[Date]))')
    expect(withM.diagnostics.map((d) => d.code)).toContain('DATE_TABLE_REQUIRED')
  })

  it('an inactive Calendar → Sales relationship stops the time-intelligence date filter from reaching Sales, and re-activating recovers the result (sprint brief §39/§64)', () => {
    const { model, datasets, calendarDs, salesTableId, relationshipId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue LY', 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))')
    expect(withM.diagnostics).toEqual([])

    const context = {
      filters: [
        columnFilter(calendarDs.id, 'calendar-table', 'cal-year', [2025]),
        columnFilter(calendarDs.id, 'calendar-table', 'cal-monthnumber', [3]),
      ],
    }

    const { model: inactiveModel } = setRelationshipActive(withM.model, relationshipId, false)
    const totalUnderInactive = evaluateMeasure(inactiveModel, datasets, measureId(inactiveModel, 'Total Revenue'), context).value
    const lyUnderInactive = evaluateMeasure(inactiveModel, datasets, measureId(inactiveModel, 'Revenue LY'), context).value
    expect(lyUnderInactive).toBe(totalUnderInactive) // Calendar filtering (original or time-shifted) no longer reaches Sales at all
    expect(lyUnderInactive).toBeCloseTo(1540, 6) // grand total, fully unfiltered

    const { model: reactivatedModel } = setRelationshipActive(inactiveModel, relationshipId, true)
    const lyAfterReactivation = evaluateMeasure(reactivatedModel, datasets, measureId(reactivatedModel, 'Revenue LY'), context).value
    expect(lyAfterReactivation).toBeCloseTo(300, 6) // recovers exactly the §63 result
  })
})
