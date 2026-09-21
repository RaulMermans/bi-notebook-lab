import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { ColumnRef, SemanticModel } from '../../../src/domain/model'
import { markDateTable } from '../../../src/runtime/dateTable/dateTableRuntime'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationshipConfig } from '../../../src/runtime/model/modelRuntime'

/**
 * Sprint 11's canonical role-playing (Order Date / Ship Date) fixture:
 * `Calendar.Date -> Sales.OrderDate` ACTIVE, `Calendar.Date -> Sales.ShipDate`
 * INACTIVE. Every expected value is derived by hand from `SALES_ROWS` below
 * (mirrors `timeIntelligence.test.ts`'s fixture style) — never re-derived
 * through the engine under test.
 */
function buildFixture() {
  const calendarRows: unknown[][] = []
  for (const year of [2024, 2025]) {
    const start = new Date(Date.UTC(year, 0, 1))
    const end = new Date(Date.UTC(year, 11, 31))
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      calendarRows.push([d.toISOString().slice(0, 10), d.getUTCFullYear(), d.getUTCMonth() + 1])
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
          { id: 'cal-month', name: 'MonthNumber', dataType: 'integer', nullable: false },
        ],
        rows: calendarRows.map(([date, year, month]) => ({ Date: date, Year: year, MonthNumber: month })),
        rowCount: calendarRows.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  // OrderID, OrderDate, ShipDate, Country, Revenue.
  const SALES_ROWS: [number, string, string, string, number][] = [
    [1, '2024-03-29', '2024-04-02', 'Spain', 100], // ships across the month boundary into April 2024
    [2, '2024-03-15', '2024-03-18', 'France', 200], // ships within the same month
    [3, '2025-03-29', '2025-04-02', 'Spain', 150], // this year's counterpart of order 1
    [4, '2025-03-15', '2025-03-18', 'France', 250],
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
          { id: 'sales-orderdate', name: 'OrderDate', dataType: 'date', nullable: false },
          { id: 'sales-shipdate', name: 'ShipDate', dataType: 'date', nullable: false },
          { id: 'sales-country', name: 'Country', dataType: 'string', nullable: false },
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
        ],
        rows: SALES_ROWS.map(([OrderID, OrderDate, ShipDate, Country, Revenue]) => ({ OrderID, OrderDate, ShipDate, Country, Revenue })),
        rowCount: SALES_ROWS.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = { [calendarDs.id]: calendarDs, [salesDs.id]: salesDs }

  let model = createModel('Relationship Lab Fixture')
  model = addTable(model, { datasetId: calendarDs.id, tableId: 'calendar-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })

  const calendarTableId = model.tables.find((t) => t.datasetId === calendarDs.id)!.id
  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

  const calendarDateRef: ColumnRef = { datasetId: calendarDs.id, tableId: 'calendar-table', columnId: 'cal-date' }
  const orderDateRef: ColumnRef = { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-orderdate' }
  const shipDateRef: ColumnRef = { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-shipdate' }

  const orderDateRel = createRelationshipConfig(
    model,
    { left: calendarDateRef, right: orderDateRef, cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: true },
    datasets,
  )
  expect(orderDateRel.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  model = orderDateRel.model
  const orderDateRelationshipId = orderDateRel.relationship!.id

  const shipDateRel = createRelationshipConfig(
    model,
    { left: calendarDateRef, right: shipDateRef, cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: false },
    datasets,
  )
  expect(shipDateRel.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  model = shipDateRel.model
  const shipDateRelationshipId = shipDateRel.relationship!.id

  const marked = markDateTable(model, datasets, calendarTableId, calendarDateRef)
  expect(marked.diagnostics).toEqual([])
  model = marked.model

  const revenue = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
  expect(revenue.diagnostics).toEqual([])
  model = revenue.model

  const shippedRevenue = createMeasure(model, datasets, {
    homeModelTableId: salesTableId,
    name: 'Shipped Revenue',
    expression: 'CALCULATE([Total Revenue], USERELATIONSHIP(Sales[ShipDate], Calendar[Date]))',
  })
  expect(shippedRevenue.diagnostics).toEqual([])
  model = shippedRevenue.model

  const shippedRevenueLY = createMeasure(model, datasets, {
    homeModelTableId: salesTableId,
    name: 'Shipped Revenue LY',
    expression: 'CALCULATE([Total Revenue], USERELATIONSHIP(Sales[ShipDate], Calendar[Date]), SAMEPERIODLASTYEAR(Calendar[Date]))',
  })
  expect(shippedRevenueLY.diagnostics).toEqual([])
  model = shippedRevenueLY.model

  return { model, datasets, calendarDs, salesDs, calendarTableId, salesTableId, orderDateRelationshipId, shipDateRelationshipId }
}

function measureId(model: SemanticModel, name: string): string {
  return model.measures.find((m) => m.name === name)!.id
}

function monthFilter(calendarDs: Dataset, year: number, month: number) {
  return {
    filters: [
      { column: { datasetId: calendarDs.id, tableId: 'calendar-table', columnId: 'cal-year' }, operator: 'equals' as const, values: [year] },
      { column: { datasetId: calendarDs.id, tableId: 'calendar-table', columnId: 'cal-month' }, operator: 'equals' as const, values: [month] },
    ],
  }
}

describe('USERELATIONSHIP (sprint 11 §22-31, §68-72)', () => {
  it('a plain measure uses the active OrderDate relationship; USERELATIONSHIP switches to ShipDate for one calculation', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()

    // Under April 2024: OrderDate has no rows in April, ShipDate has order 1 (revenue 100).
    const aprilFilter = monthFilter(calendarDs, 2024, 4)
    const revenue = evaluateMeasure(model, datasets, measureId(model, 'Total Revenue'), aprilFilter)
    const shippedRevenue = evaluateMeasure(model, datasets, measureId(model, 'Shipped Revenue'), aprilFilter)

    expect(revenue.diagnostics).toEqual([])
    expect(revenue.value).toBeNull()
    expect(shippedRevenue.diagnostics).toEqual([])
    expect(shippedRevenue.value).toBe(100)

    // Under March 2024: OrderDate has both order 1 and 2 (100+200=300); ShipDate has only order 2 (200).
    const marchFilter = monthFilter(calendarDs, 2024, 3)
    const revenueMarch = evaluateMeasure(model, datasets, measureId(model, 'Total Revenue'), marchFilter)
    const shippedRevenueMarch = evaluateMeasure(model, datasets, measureId(model, 'Shipped Revenue'), marchFilter)
    expect(revenueMarch.value).toBe(300)
    expect(shippedRevenueMarch.value).toBe(200)

    void salesTableId
  })

  it('USERELATIONSHIP does not also intersect through the still-persisted-active OrderDate relationship (sprint brief §69)', () => {
    const { model, datasets, calendarDs } = buildFixture()
    // Order 3 ships in April 2025 but was placed in March 2025 — if OrderDate stayed active
    // alongside ShipDate, this order would incorrectly disappear from the April-2025 result.
    const aprilFilter = monthFilter(calendarDs, 2025, 4)
    const shippedRevenue = evaluateMeasure(model, datasets, measureId(model, 'Shipped Revenue'), aprilFilter)
    expect(shippedRevenue.value).toBe(150)
  })

  it('reverse argument order finds the same relationship as USERELATIONSHIP(ShipDate, Date)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const reversed = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Shipped Revenue Reversed',
      expression: 'CALCULATE([Total Revenue], USERELATIONSHIP(Calendar[Date], Sales[ShipDate]))',
    })
    expect(reversed.diagnostics).toEqual([])

    const aprilFilter = monthFilter(calendarDs, 2024, 4)
    const result = evaluateMeasure(reversed.model, datasets, measureId(reversed.model, 'Shipped Revenue Reversed'), aprilFilter)
    expect(result.diagnostics).toEqual([])
    expect(result.value).toBe(100)
  })

  it('USERELATIONSHIP on an already-active relationship matches ordinary behavior (sprint brief §28)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const explicit = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Revenue Via Explicit OrderDate',
      expression: 'CALCULATE([Total Revenue], USERELATIONSHIP(Sales[OrderDate], Calendar[Date]))',
    })
    expect(explicit.diagnostics).toEqual([])

    const marchFilter = monthFilter(calendarDs, 2024, 3)
    const result = evaluateMeasure(explicit.model, datasets, measureId(explicit.model, 'Revenue Via Explicit OrderDate'), marchFilter)
    expect(result.value).toBe(300)
  })

  it('nested CALCULATE: the innermost USERELATIONSHIP wins, and never leaks into an unrelated evaluateMeasure call (sprint brief §29)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    const nested = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Nested',
      expression:
        'CALCULATE(CALCULATE([Total Revenue], USERELATIONSHIP(Sales[ShipDate], Calendar[Date])), USERELATIONSHIP(Sales[OrderDate], Calendar[Date]))',
    })
    expect(nested.diagnostics).toEqual([])

    const aprilFilter = monthFilter(calendarDs, 2024, 4)
    const nestedResult = evaluateMeasure(nested.model, datasets, measureId(nested.model, 'Nested'), aprilFilter)
    // Inner ShipDate override wins for its own scope: April 2024 ShipDate revenue = 100.
    expect(nestedResult.value).toBe(100)

    // A completely separate evaluateMeasure call for the plain Revenue measure, same filter,
    // still uses OrderDate — proving the nested override never leaked into global/model state.
    const plainResult = evaluateMeasure(model, datasets, measureId(model, 'Total Revenue'), aprilFilter)
    expect(plainResult.value).toBeNull()
  })

  it('USERELATIONSHIP composes with SAMEPERIODLASTYEAR: date shift then ShipDate propagation (sprint brief §30/§72 — end-to-end acceptance test)', () => {
    const { model, datasets, calendarDs, salesTableId } = buildFixture()
    void salesTableId

    // Under April 2025, SAMEPERIODLASTYEAR shifts the Calendar context to April 2024, which then
    // must propagate through ShipDate (not OrderDate) to Sales: only order 1 ships in April 2024 (100).
    const aprilFilter = monthFilter(calendarDs, 2025, 4)
    const shippedRevenueLY = evaluateMeasure(model, datasets, measureId(model, 'Shipped Revenue LY'), aprilFilter)
    expect(shippedRevenueLY.diagnostics).toEqual([])
    expect(shippedRevenueLY.value).toBe(100)

    // Sanity: the classic (OrderDate) Revenue LY equivalent, evaluated inline, differs — it must
    // shift dates and then use OrderDate, landing on order 1's OrderDate month (March 2024, 100),
    // not April 2024 at all, since order 1 was placed in March.
    const revenueLY = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Revenue LY',
      expression: 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))',
    })
    expect(revenueLY.diagnostics).toEqual([])
    const revenueLYResult = evaluateMeasure(revenueLY.model, datasets, measureId(revenueLY.model, 'Revenue LY'), aprilFilter)
    expect(revenueLYResult.value).toBeNull() // no OrderDate in April 2024 either
  })
})
