import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'
import type { ConformanceModelFixture } from '../../../src/conformance/types'

/**
 * The shared retail-style fixture most conformance families build on —
 * small enough to hand-calculate every expected value, rich enough to
 * exercise relationship propagation, blanks and grouping.
 *
 *   Customers 1 -CustomerID-> * Sales <-ProductID-* 1 Products
 *
 *   Customers: CustomerID, Country,  Segment
 *     1         Spain      Premium
 *     2         France     Standard
 *     3         Spain      Standard
 *
 *   Products: ProductID, Category,     UnitPrice
 *     1         Furniture    100
 *     2         Electronics  50
 *
 *   Sales: OrderID, CustomerID, ProductID, Revenue, Cost, Quantity
 *     1       1          1        100      60        1
 *     2       2          2        200     150        2
 *     3       3          1         50      40        1
 *     4       1          2        null    null      null   (blank row)
 *
 *   Totals (all rows): Revenue 350, Cost 250, Margin 100.
 *   Spain-only (Customers 1 & 3): Revenue 150, Cost 100.
 */
export function buildSharedFixture(): ConformanceModelFixture {
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
          { id: 'customer-segment', name: 'Segment', dataType: 'string', nullable: false },
        ],
        rows: [
          { CustomerID: 1, Country: 'Spain', Segment: 'Premium' },
          { CustomerID: 2, Country: 'France', Segment: 'Standard' },
          { CustomerID: 3, Country: 'Spain', Segment: 'Standard' },
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
          { id: 'product-price', name: 'UnitPrice', dataType: 'decimal', nullable: false },
        ],
        rows: [
          { ProductID: 1, Category: 'Furniture', UnitPrice: 100 },
          { ProductID: 2, Category: 'Electronics', UnitPrice: 50 },
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
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: true },
          { id: 'sales-cost', name: 'Cost', dataType: 'decimal', nullable: true },
          { id: 'sales-quantity', name: 'Quantity', dataType: 'integer', nullable: true },
        ],
        rows: [
          { OrderID: 1, CustomerID: 1, ProductID: 1, Revenue: 100, Cost: 60, Quantity: 1 },
          { OrderID: 2, CustomerID: 2, ProductID: 2, Revenue: 200, Cost: 150, Quantity: 2 },
          { OrderID: 3, CustomerID: 3, ProductID: 1, Revenue: 50, Cost: 40, Quantity: 1 },
          { OrderID: 4, CustomerID: 1, ProductID: 2, Revenue: null, Cost: null, Quantity: null },
        ],
        rowCount: 4,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = { [customersDs.id]: customersDs, [productsDs.id]: productsDs, [salesDs.id]: salesDs }
  let model: SemanticModel = createModel()
  model = addTable(model, { datasetId: customersDs.id, tableId: 'customers-table' })
  model = addTable(model, { datasetId: productsDs.id, tableId: 'products-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })

  const customerRel = createRelationship(
    model,
    {
      one: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customer-id' },
      many: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-customerid' },
    },
    datasets,
  )
  model = customerRel.model

  const productRel = createRelationship(
    model,
    {
      one: { datasetId: productsDs.id, tableId: 'products-table', columnId: 'product-id' },
      many: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-productid' },
    },
    datasets,
  )
  model = productRel.model

  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id
  const customersTableId = model.tables.find((t) => t.datasetId === customersDs.id)!.id
  const productsTableId = model.tables.find((t) => t.datasetId === productsDs.id)!.id

  return { model, datasets, homeModelTableId: salesTableId }
}

export function resolveSharedTableIds(fixture: ConformanceModelFixture) {
  return {
    salesTableId: fixture.model.tables.find((t) => t.datasetId === 'sales-ds')!.id,
    customersTableId: fixture.model.tables.find((t) => t.datasetId === 'customers-ds')!.id,
    productsTableId: fixture.model.tables.find((t) => t.datasetId === 'products-ds')!.id,
  }
}

function countryFilterValues(values: string[]) {
  return {
    filters: [
      {
        column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' },
        operator: (values.length === 1 ? 'equals' : 'in') as 'equals' | 'in',
        values,
      },
    ],
  }
}

export const SPAIN_FILTER = countryFilterValues(['Spain'])
export const FRANCE_FILTER = countryFilterValues(['France'])
