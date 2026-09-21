import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { ColumnRef } from '../../../src/domain/model'
import { markDateTable } from '../../../src/runtime/dateTable/dateTableRuntime'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationshipConfig } from '../../../src/runtime/model/modelRuntime'

/**
 * Sprint 11 §74-75: relationship overrides must be part of a measure's
 * cache/context identity — a value computed for `[Total Revenue]` under
 * ShipDate must never be reused for the same measure reference under
 * OrderDate within the same evaluation. If it were, `Combined` below would
 * incorrectly evaluate to 0 no matter the data.
 */
function buildFixture() {
  const calendarRows = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'].map((date) => ({ Date: date }))
  const calendarDs: Dataset = {
    id: 'calendar-ds',
    name: 'Calendar',
    source: { type: 'sample', key: 'calendar' },
    tables: [
      {
        id: 'calendar-table',
        name: 'Calendar',
        columns: [{ id: 'cal-date', name: 'Date', dataType: 'date', nullable: false }],
        rows: calendarRows,
        rowCount: calendarRows.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }

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
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
        ],
        rows: [
          { OrderID: 1, OrderDate: '2024-01-01', ShipDate: '2024-01-02', Revenue: 100 },
          { OrderID: 2, OrderDate: '2024-01-02', ShipDate: '2024-01-01', Revenue: 30 },
        ],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = { [calendarDs.id]: calendarDs, [salesDs.id]: salesDs }
  let model = addTable(createModel(), { datasetId: calendarDs.id, tableId: 'calendar-table' })
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

  const shipDateRel = createRelationshipConfig(
    model,
    { left: calendarDateRef, right: shipDateRef, cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: false },
    datasets,
  )
  expect(shipDateRel.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  model = shipDateRel.model

  void markDateTable // (not needed here — no time-intelligence functions in this fixture)

  const revenue = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
  expect(revenue.diagnostics).toEqual([])
  model = revenue.model

  const combined = createMeasure(model, datasets, {
    homeModelTableId: salesTableId,
    name: 'Combined',
    expression:
      'CALCULATE([Total Revenue], USERELATIONSHIP(Sales[ShipDate], Calendar[Date])) - CALCULATE([Total Revenue], USERELATIONSHIP(Sales[OrderDate], Calendar[Date]))',
  })
  expect(combined.diagnostics).toEqual([])
  model = combined.model

  return { model, datasets, calendarTableId, calendarDateRef }
}

describe('relationship override cache/context-identity safety (sprint 11 §74-75)', () => {
  it('two CALCULATE scopes referencing the same measure under different relationship overrides do not share a cached value', () => {
    const { model, datasets, calendarDateRef } = buildFixture()
    const jan1Filter = { filters: [{ column: calendarDateRef, operator: 'equals' as const, values: ['2024-01-01'] }] }

    // Under 2024-01-01: OrderDate matches order 1 (Revenue 100). ShipDate matches order 2 (Revenue 30).
    const combinedResult = evaluateMeasure(model, datasets, model.measures.find((m) => m.name === 'Combined')!.id, jan1Filter)
    expect(combinedResult.diagnostics).toEqual([])
    // ShippedRevenue(30) - Revenue(100) = -70. A cache bug that reused one CALCULATE's cached
    // [Total Revenue] for the other would instead produce 0 regardless of the data.
    expect(combinedResult.value).toBe(-70)
  })

  it('the same measure reference resolves differently across three date filters spanning both relationships', () => {
    const { model, datasets, calendarDateRef } = buildFixture()
    const combinedId = model.measures.find((m) => m.name === 'Combined')!.id

    const jan2 = evaluateMeasure(model, datasets, combinedId, { filters: [{ column: calendarDateRef, operator: 'equals', values: ['2024-01-02'] }] })
    // 2024-01-02: OrderDate matches order 2 (30). ShipDate matches order 1 (100). Combined = 100 - 30 = 70.
    expect(jan2.value).toBe(70)

    const jan1 = evaluateMeasure(model, datasets, combinedId, { filters: [{ column: calendarDateRef, operator: 'equals', values: ['2024-01-01'] }] })
    // Re-evaluated fresh from a brand new evaluateMeasure call — must independently recompute -70, not reuse jan2's cached 70.
    expect(jan1.value).toBe(-70)

    const jan3 = evaluateMeasure(model, datasets, combinedId, { filters: [{ column: calendarDateRef, operator: 'equals', values: ['2024-01-03'] }] })
    // 2024-01-03: neither relationship matches anything. Combined = null - null = BLANK.
    expect(jan3.value).toBeNull()
  })
})
