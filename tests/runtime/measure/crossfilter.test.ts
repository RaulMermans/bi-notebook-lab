import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationshipConfig } from '../../../src/runtime/model/modelRuntime'

/**
 * Customers (1) -single-> Sales (*) by default — CROSSFILTER lets one
 * calculation temporarily change that direction. Expected values hand-derived
 * from `SALES_ROWS`.
 */
function buildFixture() {
  const customersDs: Dataset = {
    id: 'customers-ds',
    name: 'Customers',
    source: { type: 'sample', key: 'customers' },
    tables: [
      {
        id: 'customers-table',
        name: 'Customers',
        columns: [
          { id: 'customers-id', name: 'CustomerID', dataType: 'integer', nullable: false },
          { id: 'customers-country', name: 'Country', dataType: 'string', nullable: false },
        ],
        rows: [
          { CustomerID: 1, Country: 'Spain' },
          { CustomerID: 2, Country: 'France' },
          { CustomerID: 3, Country: 'Spain' },
        ],
        rowCount: 3,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const SALES_ROWS: [number, number, number][] = [
    [1, 1, 100], // Customer 1 (Spain)
    [2, 2, 200], // Customer 2 (France)
    [3, 1, 50], // Customer 1 (Spain)
    // Customer 3 (Spain) has no sales rows at all.
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
          { id: 'sales-customerid', name: 'CustomerID', dataType: 'integer', nullable: false },
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
        ],
        rows: SALES_ROWS.map(([OrderID, CustomerID, Revenue]) => ({ OrderID, CustomerID, Revenue })),
        rowCount: SALES_ROWS.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = { [customersDs.id]: customersDs, [salesDs.id]: salesDs }

  let model = createModel('CROSSFILTER Fixture')
  model = addTable(model, { datasetId: customersDs.id, tableId: 'customers-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })
  const customersTableId = model.tables.find((t) => t.datasetId === customersDs.id)!.id
  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

  const customerRef = { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customers-id' }
  const salesCustomerRef = { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-customerid' }

  const rel = createRelationshipConfig(
    model,
    { left: customerRef, right: salesCustomerRef, cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: true },
    datasets,
  )
  expect(rel.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  model = rel.model

  const revenue = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
  expect(revenue.diagnostics).toEqual([])
  model = revenue.model

  const customerCount = createMeasure(model, datasets, { homeModelTableId: customersTableId, name: 'Customer Count', expression: 'COUNTROWS(Customers)' })
  expect(customerCount.diagnostics).toEqual([])
  model = customerCount.model

  return { model, datasets, customersDs, salesDs, customersTableId, salesTableId }
}

function measureId(model: SemanticModel, name: string): string {
  return model.measures.find((m) => m.name === name)!.id
}

function addExpression(model: SemanticModel, datasets: Record<string, Dataset>, homeModelTableId: string, name: string, expression: string) {
  const result = createMeasure(model, datasets, { homeModelTableId, name, expression })
  expect(result.diagnostics).toEqual([])
  return result.model
}

describe('CROSSFILTER (sprint 11 §32-34, §73)', () => {
  it('CROSSFILTER(..., BOTH) makes a Sales-side filter reach Customers for one calculation only', () => {
    let { model, datasets, customersDs, salesDs, customersTableId, salesTableId } = buildFixture()
    model = addExpression(
      model,
      datasets,
      customersTableId,
      'Customers Seeing Order 2',
      'CALCULATE([Customer Count], CROSSFILTER(Customers[CustomerID], Sales[CustomerID], BOTH))',
    )

    const orderFilter = {
      filters: [{ column: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-orderid' }, operator: 'equals' as const, values: [2] }],
    }

    // Without CROSSFILTER, Customers is unaffected by a Sales-side filter (single direction).
    const plain = evaluateMeasure(model, datasets, measureId(model, 'Customer Count'), orderFilter)
    expect(plain.value).toBe(3)

    // With CROSSFILTER BOTH, Order 2 (Customer 2) narrows Customers down to just Customer 2.
    const both = evaluateMeasure(model, datasets, measureId(model, 'Customers Seeing Order 2'), orderFilter)
    expect(both.diagnostics).toEqual([])
    expect(both.value).toBe(1)

    void customersDs
  })

  it('CROSSFILTER(..., NONE) disables an otherwise-active relationship for one calculation', () => {
    let { model, datasets, customersDs, salesTableId } = buildFixture()
    model = addExpression(
      model,
      datasets,
      salesTableId,
      'Revenue Ignoring Customer Filter',
      'CALCULATE([Total Revenue], CROSSFILTER(Customers[CustomerID], Sales[CustomerID], NONE))',
    )

    const spainFilter = {
      filters: [{ column: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customers-country' }, operator: 'equals' as const, values: ['Spain'] }],
    }

    const plain = evaluateMeasure(model, datasets, measureId(model, 'Total Revenue'), spainFilter)
    expect(plain.value).toBe(150) // orders 1 and 3 (Spain: customers 1 and 3)

    const ignoring = evaluateMeasure(model, datasets, measureId(model, 'Revenue Ignoring Customer Filter'), spainFilter)
    expect(ignoring.diagnostics).toEqual([])
    expect(ignoring.value).toBe(350) // all rows: 100 + 200 + 50
  })

  it('ONEWAY is rejected for a one-to-one relationship; NONE/BOTH remain valid', () => {
    const profilesDs: Dataset = {
      id: 'profiles-ds',
      name: 'CustomerProfile',
      source: { type: 'sample', key: 'profiles' },
      tables: [
        {
          id: 'profiles-table',
          name: 'CustomerProfile',
          columns: [{ id: 'profiles-id', name: 'CustomerID', dataType: 'integer', nullable: false }],
          rows: [{ CustomerID: 1 }],
          rowCount: 1,
        },
      ],
      createdAt: new Date().toISOString(),
    }
    const customersDs: Dataset = {
      id: 'customers-ds-2',
      name: 'Customers',
      source: { type: 'sample', key: 'customers2' },
      tables: [
        {
          id: 'customers-table-2',
          name: 'Customers',
          columns: [{ id: 'customers-id-2', name: 'CustomerID', dataType: 'integer', nullable: false }],
          rows: [{ CustomerID: 1 }],
          rowCount: 1,
        },
      ],
      createdAt: new Date().toISOString(),
    }
    let model = addTable(createModel(), { datasetId: customersDs.id, tableId: 'customers-table-2' })
    model = addTable(model, { datasetId: profilesDs.id, tableId: 'profiles-table' })
    const datasets = { [customersDs.id]: customersDs, [profilesDs.id]: profilesDs }
    const customersTableId = model.tables.find((t) => t.datasetId === customersDs.id)!.id

    const rel = createRelationshipConfig(
      model,
      {
        left: { datasetId: customersDs.id, tableId: 'customers-table-2', columnId: 'customers-id-2' },
        right: { datasetId: profilesDs.id, tableId: 'profiles-table', columnId: 'profiles-id' },
        cardinality: 'one-to-one',
        crossFilterDirection: 'both',
        active: true,
      },
      datasets,
    )
    expect(rel.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    model = rel.model

    const count = createMeasure(model, datasets, { homeModelTableId: customersTableId, name: 'Count', expression: 'COUNTROWS(Customers)' })
    model = count.model

    const oneway = createMeasure(model, datasets, {
      homeModelTableId: customersTableId,
      name: 'Bad',
      expression: 'CALCULATE([Count], CROSSFILTER(Customers[CustomerID], CustomerProfile[CustomerID], ONEWAY))',
    })
    expect(oneway.diagnostics).toContainEqual(expect.objectContaining({ code: 'CROSSFILTER_DIRECTION_INVALID_FOR_CARDINALITY' }))
  })

  it('ONEWAY_LEFTFILTERSRIGHT/ONEWAY_RIGHTFILTERSLEFT are only valid for many-to-many', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const bad = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Bad',
      expression: 'CALCULATE([Total Revenue], CROSSFILTER(Customers[CustomerID], Sales[CustomerID], ONEWAY_LEFTFILTERSRIGHT))',
    })
    expect(bad.diagnostics).toEqual([expect.objectContaining({ code: 'CROSSFILTER_DIRECTION_INVALID_FOR_CARDINALITY' })])
  })
})
