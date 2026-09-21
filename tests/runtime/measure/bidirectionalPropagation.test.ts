import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationshipConfig } from '../../../src/runtime/model/modelRuntime'
import { resolveFilterContext } from '../../../src/runtime/measure/filterPropagation'
import type { FilterContext } from '../../../src/runtime/measure/filterContext'

/** Customers (1) <-> Sales (*), bidirectional. Sprint 11 §40, §65. */
function buildBidirectionalFixture() {
  const customersDs: Dataset = {
    id: 'customers-ds',
    name: 'Customers',
    source: { type: 'sample', key: 'customers' },
    tables: [
      {
        id: 'customers-table',
        name: 'Customers',
        columns: [{ id: 'customers-id', name: 'CustomerID', dataType: 'integer', nullable: false }],
        rows: [{ CustomerID: 1 }, { CustomerID: 2 }, { CustomerID: 3 }, { CustomerID: 4 }],
        rowCount: 4,
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
          { id: 'sales-customerid', name: 'CustomerID', dataType: 'integer', nullable: false },
        ],
        rows: [
          { OrderID: 1, CustomerID: 1 },
          { OrderID: 2, CustomerID: 4 },
        ],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = { [customersDs.id]: customersDs, [salesDs.id]: salesDs }
  let model = addTable(createModel(), { datasetId: customersDs.id, tableId: 'customers-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })
  const customersTableId = model.tables.find((t) => t.datasetId === customersDs.id)!.id
  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

  const rel = createRelationshipConfig(
    model,
    {
      left: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customers-id' },
      right: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-customerid' },
      cardinality: 'one-to-many',
      oneSide: 'left',
      crossFilterDirection: 'both',
      active: true,
    },
    datasets,
  )
  expect(rel.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  model = rel.model

  return { model, datasets, customersTableId, salesTableId, customersDs, salesDs }
}

describe('bidirectional 1:* propagation (sprint 11 §40, §65)', () => {
  it('a filter on the "1" side (Customers) still narrows the "*" side (Sales) — the classic direction', () => {
    const { model, datasets, customersTableId, salesTableId, customersDs } = buildBidirectionalFixture()
    const filterContext: FilterContext = {
      filters: [{ column: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customers-id' }, operator: 'equals', values: [1] }],
    }
    const state = resolveFilterContext(model, datasets, filterContext)
    expect(state.valid).toBe(true)
    expect([...(state.rowSelections.get(salesTableId) ?? [])]).toEqual([0]) // only OrderID 1
    void customersTableId
  })

  it('a filter on the "*" side (Sales) now also narrows the "1" side (Customers) — the new bidirectional direction', () => {
    const { model, datasets, salesTableId, customersTableId, salesDs } = buildBidirectionalFixture()
    const filterContext: FilterContext = {
      filters: [{ column: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-orderid' }, operator: 'in', values: [1, 2] }],
    }
    const state = resolveFilterContext(model, datasets, filterContext)
    expect(state.valid).toBe(true)
    // Sales rows reference customers 1 and 4 — Customers 2 and 3 must be filtered out.
    const visibleCustomerIndexes = [...(state.rowSelections.get(customersTableId) ?? [])].sort()
    expect(visibleCustomerIndexes).toEqual([0, 3]) // rows for CustomerID 1 and 4
    void salesTableId
  })

  it('COUNTROWS(Customers) reflects the reverse-propagated filter end-to-end', () => {
    const { model, datasets, customersTableId, salesDs } = buildBidirectionalFixture()
    const withMeasure = createMeasure(model, datasets, { homeModelTableId: customersTableId, name: 'Customer Count', expression: 'COUNTROWS(Customers)' })
    expect(withMeasure.diagnostics).toEqual([])

    const filterContext: FilterContext = {
      filters: [{ column: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-orderid' }, operator: 'equals', values: [1] }],
    }
    const result = evaluateMeasure(withMeasure.model, datasets, withMeasure.model.measures[0].id, filterContext)
    expect(result.value).toBe(1) // only Customer 1
  })

  it('switching direction back to single removes the reverse propagation', () => {
    const { model, datasets, customersTableId, salesDs } = buildBidirectionalFixture()
    const single = {
      ...model,
      relationships: model.relationships.map((r) => ({ ...r, crossFilterDirection: 'left-to-right' as const })),
    }
    const filterContext: FilterContext = {
      filters: [{ column: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-orderid' }, operator: 'equals', values: [1] }],
    }
    const state = resolveFilterContext(single, datasets, filterContext)
    expect(state.rowSelections.get(customersTableId) ?? 'all').toBe('all')
  })
})

/** Products <-> Sales <-> Customers: transitive bidirectional propagation. Sprint 11 §41. */
function buildTransitiveFixture() {
  const productsDs: Dataset = {
    id: 'products-ds',
    name: 'Products',
    source: { type: 'sample', key: 'products' },
    tables: [
      {
        id: 'products-table',
        name: 'Products',
        columns: [{ id: 'products-id', name: 'ProductID', dataType: 'integer', nullable: false }],
        rows: [{ ProductID: 1 }, { ProductID: 2 }],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }
  const salesDs: Dataset = {
    id: 'sales-ds-2',
    name: 'Sales',
    source: { type: 'sample', key: 'sales2' },
    tables: [
      {
        id: 'sales-table-2',
        name: 'Sales',
        columns: [
          { id: 'sales-orderid-2', name: 'OrderID', dataType: 'integer', nullable: false },
          { id: 'sales-productid-2', name: 'ProductID', dataType: 'integer', nullable: false },
          { id: 'sales-customerid-2', name: 'CustomerID', dataType: 'integer', nullable: false },
        ],
        rows: [{ OrderID: 1, ProductID: 1, CustomerID: 10 }],
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
        rows: [{ CustomerID: 10 }, { CustomerID: 20 }],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = { [productsDs.id]: productsDs, [salesDs.id]: salesDs, [customersDs.id]: customersDs }
  let model = addTable(createModel(), { datasetId: productsDs.id, tableId: 'products-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table-2' })
  model = addTable(model, { datasetId: customersDs.id, tableId: 'customers-table-2' })
  const productsTableId = model.tables.find((t) => t.datasetId === productsDs.id)!.id
  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id
  const customersTableId = model.tables.find((t) => t.datasetId === customersDs.id)!.id

  const productRel = createRelationshipConfig(
    model,
    {
      left: { datasetId: productsDs.id, tableId: 'products-table', columnId: 'products-id' },
      right: { datasetId: salesDs.id, tableId: 'sales-table-2', columnId: 'sales-productid-2' },
      cardinality: 'one-to-many',
      oneSide: 'left',
      crossFilterDirection: 'both',
      active: true,
    },
    datasets,
  )
  expect(productRel.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  model = productRel.model

  const customerRel = createRelationshipConfig(
    model,
    {
      left: { datasetId: customersDs.id, tableId: 'customers-table-2', columnId: 'customers-id-2' },
      right: { datasetId: salesDs.id, tableId: 'sales-table-2', columnId: 'sales-customerid-2' },
      cardinality: 'one-to-many',
      oneSide: 'left',
      crossFilterDirection: 'both',
      active: true,
    },
    datasets,
  )
  expect(customerRel.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  model = customerRel.model

  return { model, datasets, productsTableId, salesTableId, customersTableId, productsDs }
}

describe('transitive bidirectional propagation (sprint 11 §41)', () => {
  it('filtering Products transitively narrows Sales and then Customers (Products <-> Sales <-> Customers)', () => {
    const { model, datasets, customersTableId, productsDs } = buildTransitiveFixture()
    const filterContext: FilterContext = {
      filters: [{ column: { datasetId: productsDs.id, tableId: 'products-table', columnId: 'products-id' }, operator: 'equals', values: [1] }],
    }
    const state = resolveFilterContext(model, datasets, filterContext)
    expect(state.valid).toBe(true)
    const visibleCustomers = [...(state.rowSelections.get(customersTableId) ?? [])]
    expect(visibleCustomers).toEqual([0]) // CustomerID 10 only
  })
})
