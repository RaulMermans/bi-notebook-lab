import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { Relationship, SemanticModel } from '../../../src/domain/model'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'

/**
 * Star-ish schema for filter-context tests:
 *   Region 1 -RegionID-> * Customers 1 -CustomerID-> * Sales <-ProductID-* 1 Products
 * Sales rows are deliberately unbalanced across country/category so
 * intersections differ from either single filter (see inline row comments).
 */
function buildFixture() {
  const regionDs: Dataset = {
    id: 'region-ds',
    name: 'Region',
    source: { type: 'sample', key: 'region' },
    tables: [
      {
        id: 'region-table',
        name: 'Region',
        columns: [
          { id: 'region-id', name: 'RegionID', dataType: 'integer', nullable: false },
          { id: 'region-name', name: 'RegionName', dataType: 'string', nullable: false },
        ],
        rows: [
          { RegionID: 10, RegionName: 'South' },
          { RegionID: 20, RegionName: 'North' },
        ],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const customersDs: Dataset = {
    id: 'customers-ds',
    name: 'Customers',
    source: { type: 'sample', key: 'customers' },
    tables: [
      {
        id: 'customers-table',
        name: 'Customers',
        columns: [
          { id: 'customer-id', name: 'CustomerID', dataType: 'integer', nullable: false },
          { id: 'customer-country', name: 'Country', dataType: 'string', nullable: false },
          { id: 'customer-region', name: 'RegionID', dataType: 'integer', nullable: false },
        ],
        rows: [
          { CustomerID: 1, Country: 'Spain', RegionID: 10 },
          { CustomerID: 2, Country: 'France', RegionID: 20 },
          { CustomerID: 3, Country: 'Spain', RegionID: 10 },
        ],
        rowCount: 3,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const productsDs: Dataset = {
    id: 'products-ds',
    name: 'Products',
    source: { type: 'sample', key: 'products' },
    tables: [
      {
        id: 'products-table',
        name: 'Products',
        columns: [
          { id: 'product-id', name: 'ProductID', dataType: 'integer', nullable: false },
          { id: 'product-category', name: 'Category', dataType: 'string', nullable: false },
        ],
        rows: [
          { ProductID: 1, Category: 'Furniture' },
          { ProductID: 2, Category: 'Electronics' },
        ],
        rowCount: 2,
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
          { id: 'sales-productid', name: 'ProductID', dataType: 'integer', nullable: false },
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
          { id: 'sales-cost', name: 'Cost', dataType: 'decimal', nullable: false },
          { id: 'sales-quantity', name: 'Quantity', dataType: 'integer', nullable: false },
        ],
        rows: [
          { OrderID: 1, CustomerID: 1, ProductID: 1, Revenue: 100, Cost: 60, Quantity: 2 }, // Spain, Furniture
          { OrderID: 2, CustomerID: 2, ProductID: 2, Revenue: 200, Cost: 150, Quantity: 1 }, // France, Electronics
          { OrderID: 3, CustomerID: 3, ProductID: 1, Revenue: 50, Cost: 20, Quantity: 1 }, // Spain, Furniture
          { OrderID: 4, CustomerID: 1, ProductID: 2, Revenue: 80, Cost: 40, Quantity: 3 }, // Spain, Electronics
          { OrderID: 5, CustomerID: 2, ProductID: 1, Revenue: 30, Cost: 10, Quantity: 2 }, // France, Furniture
        ],
        rowCount: 5,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = {
    [regionDs.id]: regionDs,
    [customersDs.id]: customersDs,
    [productsDs.id]: productsDs,
    [salesDs.id]: salesDs,
  }

  let model = createModel('Retail-like')
  model = addTable(model, { datasetId: regionDs.id, tableId: 'region-table' })
  model = addTable(model, { datasetId: customersDs.id, tableId: 'customers-table' })
  model = addTable(model, { datasetId: productsDs.id, tableId: 'products-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })

  const regionTableId = model.tables.find((t) => t.datasetId === regionDs.id)!.id
  const customersTableId = model.tables.find((t) => t.datasetId === customersDs.id)!.id
  const productsTableId = model.tables.find((t) => t.datasetId === productsDs.id)!.id
  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

  const customerRelationship = createRelationship(
    model,
    {
      one: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customer-id' },
      many: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-customerid' },
    },
    datasets,
  )
  model = customerRelationship.model

  const productRelationship = createRelationship(
    model,
    {
      one: { datasetId: productsDs.id, tableId: 'products-table', columnId: 'product-id' },
      many: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-productid' },
    },
    datasets,
  )
  model = productRelationship.model

  const regionRelationship = createRelationship(
    model,
    {
      one: { datasetId: regionDs.id, tableId: 'region-table', columnId: 'region-id' },
      many: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customer-region' },
    },
    datasets,
  )
  model = regionRelationship.model

  return {
    model,
    datasets,
    regionTableId,
    customersTableId,
    productsTableId,
    salesTableId,
    customerRelationshipId: customerRelationship.relationship!.id,
    productRelationshipId: productRelationship.relationship!.id,
  }
}

function withMeasures(model: SemanticModel, datasets: Record<string, Dataset>, salesTableId: string, customersTableId: string) {
  let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
  m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'Total Cost', expression: 'SUM(Sales[Cost])' })
  m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'Sales Rows', expression: 'COUNTROWS(Sales)' })
  m = createMeasure(m.model, datasets, {
    homeModelTableId: customersTableId,
    name: 'Customer Rows',
    expression: 'COUNTROWS(Customers)',
  })
  return m.model
}

function findMeasureId(model: SemanticModel, name: string): string {
  return model.measures.find((measure) => measure.name === name)!.id
}

describe('filter context and relationship propagation', () => {
  it('computes unfiltered totals across all Sales rows', () => {
    const { model, datasets, salesTableId, customersTableId } = buildFixture()
    const withM = withMeasures(model, datasets, salesTableId, customersTableId)

    const revenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'))
    expect(revenue.value).toBe(460) // 100+200+50+80+30
  })

  it('applies a direct dimension filter (Customers[Country] = Spain)', () => {
    const { model, datasets, salesTableId, customersTableId } = buildFixture()
    const withM = withMeasures(model, datasets, salesTableId, customersTableId)
    const customerColumn = datasets['customers-ds'].tables[0].columns.find((c) => c.name === 'Country')!

    const filterContext = {
      filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: customerColumn.id }, operator: 'equals' as const, values: ['Spain'] }],
    }

    const revenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), filterContext)
    expect(revenue.value).toBe(230) // orders 1, 3, 4
  })

  it('applies a direct fact filter (Sales[Quantity] = 2) without reverse-propagating to Customers', () => {
    const { model, datasets, salesTableId, customersTableId } = buildFixture()
    const withM = withMeasures(model, datasets, salesTableId, customersTableId)
    const quantityColumn = datasets['sales-ds'].tables[0].columns.find((c) => c.name === 'Quantity')!

    const filterContext = {
      filters: [{ column: { datasetId: 'sales-ds', tableId: 'sales-table', columnId: quantityColumn.id }, operator: 'equals' as const, values: [2] }],
    }

    const salesRows = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Sales Rows'), filterContext)
    const customerRows = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Customer Rows'), filterContext)

    expect(salesRows.value).toBe(2) // orders 1 and 5
    expect(customerRows.value).toBe(3) // Customers is on the "1" side — never filtered by a many-side filter
  })

  it('intersects two direct filters on different tables (Country = Spain AND Category = Furniture)', () => {
    const { model, datasets, salesTableId, customersTableId } = buildFixture()
    const withM = withMeasures(model, datasets, salesTableId, customersTableId)
    const countryColumn = datasets['customers-ds'].tables[0].columns.find((c) => c.name === 'Country')!
    const categoryColumn = datasets['products-ds'].tables[0].columns.find((c) => c.name === 'Category')!

    const filterContext = {
      filters: [
        { column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }, operator: 'equals' as const, values: ['Spain'] },
        { column: { datasetId: 'products-ds', tableId: 'products-table', columnId: categoryColumn.id }, operator: 'equals' as const, values: ['Furniture'] },
      ],
    }

    const revenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), filterContext)
    // Spain-only: orders 1,3,4 (230). Furniture-only: orders 1,3,5 (180). Both: orders 1,3 (150).
    expect(revenue.value).toBe(150)
  })

  it('propagates transitively through Region -> Customers -> Sales', () => {
    const { model, datasets, salesTableId, customersTableId } = buildFixture()
    const withM = withMeasures(model, datasets, salesTableId, customersTableId)
    const regionNameColumn = datasets['region-ds'].tables[0].columns.find((c) => c.name === 'RegionName')!

    const filterContext = {
      filters: [{ column: { datasetId: 'region-ds', tableId: 'region-table', columnId: regionNameColumn.id }, operator: 'equals' as const, values: ['South'] }],
    }

    const revenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), filterContext)
    expect(revenue.value).toBe(230) // South = customers 1 & 3, same as the direct Spain filter
  })

  it('ignores an inactive relationship when propagating a filter', () => {
    const { model, datasets, salesTableId, customersTableId, productRelationshipId } = buildFixture()
    const { model: disabled } = setRelationshipActive(model, productRelationshipId, false)
    const withM = withMeasures(disabled, datasets, salesTableId, customersTableId)
    const categoryColumn = datasets['products-ds'].tables[0].columns.find((c) => c.name === 'Category')!

    const filterContext = {
      filters: [{ column: { datasetId: 'products-ds', tableId: 'products-table', columnId: categoryColumn.id }, operator: 'equals' as const, values: ['Furniture'] }],
    }

    const revenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), filterContext)
    expect(revenue.value).toBe(460) // unaffected — the Products -> Sales relationship is inactive
  })

  it('recovers propagation once the relationship is re-enabled', () => {
    const { model, datasets, salesTableId, customersTableId, productRelationshipId } = buildFixture()
    const { model: disabled } = setRelationshipActive(model, productRelationshipId, false)
    const { model: reEnabled } = setRelationshipActive(disabled, productRelationshipId, true)
    const withM = withMeasures(reEnabled, datasets, salesTableId, customersTableId)
    const categoryColumn = datasets['products-ds'].tables[0].columns.find((c) => c.name === 'Category')!

    const filterContext = {
      filters: [{ column: { datasetId: 'products-ds', tableId: 'products-table', columnId: categoryColumn.id }, operator: 'equals' as const, values: ['Furniture'] }],
    }

    const revenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), filterContext)
    expect(revenue.value).toBe(180) // orders 1, 3, 5
  })

  it('removing all filters returns the original unfiltered result', () => {
    const { model, datasets, salesTableId, customersTableId } = buildFixture()
    const withM = withMeasures(model, datasets, salesTableId, customersTableId)

    const filtered = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), {
      filters: [
        {
          column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: datasets['customers-ds'].tables[0].columns[1].id },
          operator: 'equals',
          values: ['Spain'],
        },
      ],
    })
    const unfiltered = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'))

    expect(filtered.value).toBe(230)
    expect(unfiltered.value).toBe(460)
  })

  it('a directed cycle among active relationships is legal and does not fail closed (ACTIVE_CYCLE is retired, sprint brief §15)', () => {
    const { model, datasets } = buildFixture()
    // Sales(1) -> Region(*) closes a directed cycle Customers -> Sales -> Region -> Customers with the
    // existing edges, but every ordered pair still has exactly one propagation path — not ambiguous.
    const forcedCycle: SemanticModel = {
      ...model,
      relationships: [
        ...model.relationships,
        {
          id: 'forced-cycle',
          left: { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'sales-orderid' },
          right: { datasetId: 'region-ds', tableId: 'region-table', columnId: 'region-id' },
          cardinality: 'one-to-many',
          oneSide: 'left',
          crossFilterDirection: 'left-to-right',
          active: true,
          createdAt: new Date().toISOString(),
        },
      ],
    }

    const execution = evaluateMeasure(forcedCycle, datasets, 'any-measure-id')
    expect(execution.diagnostics.some((d) => d.code === 'FILTER_GRAPH_INVALID')).toBe(false)
  })

  it('fails closed with FILTER_GRAPH_INVALID when the active relationship graph is ambiguous', () => {
    const { model, datasets } = buildFixture()
    // Region already reaches Sales via Customers; add a second, direct Region -> Sales path (a diamond).
    const withDiamond: SemanticModel = {
      ...model,
      relationships: [
        ...model.relationships,
        {
          id: 'region-to-sales-direct',
          left: { datasetId: 'region-ds', tableId: 'region-table', columnId: 'region-id' },
          right: { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'sales-orderid' },
          cardinality: 'one-to-many',
          oneSide: 'left',
          crossFilterDirection: 'left-to-right',
          active: true,
          createdAt: new Date().toISOString(),
        },
      ],
    }

    const execution = evaluateMeasure(withDiamond, datasets, 'any-measure-id')
    expect(execution.diagnostics).toEqual([expect.objectContaining({ code: 'FILTER_GRAPH_INVALID' })])
  })
})
