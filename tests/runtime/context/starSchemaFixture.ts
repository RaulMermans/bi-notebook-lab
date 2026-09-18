import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'

/**
 * A small star schema shared by the Sprint 6 context-analysis tests:
 *   Region 1 -RegionID-> * Customers 1 -CustomerID-> * Sales <-ProductID-* 1 Products
 * Mirrors the Sprint 4 `filterContext.test.ts` fixture shape so context
 * results can be sanity-checked against already-proven Sprint 4 numbers.
 */
export function buildStarSchemaFixture() {
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
        ],
        rows: [
          { OrderID: 1, CustomerID: 1, ProductID: 1, Revenue: 100 }, // Spain, Furniture
          { OrderID: 2, CustomerID: 2, ProductID: 2, Revenue: 200 }, // France, Electronics
          { OrderID: 3, CustomerID: 3, ProductID: 1, Revenue: 50 }, // Spain, Furniture
          { OrderID: 4, CustomerID: 1, ProductID: 2, Revenue: 80 }, // Spain, Electronics
          { OrderID: 5, CustomerID: 2, ProductID: 1, Revenue: 30 }, // France, Furniture
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

  const created = createMeasure(model, datasets, {
    homeModelTableId: salesTableId,
    name: 'Total Revenue',
    expression: 'SUM(Sales[Revenue])',
  })
  model = created.model

  return {
    model,
    datasets,
    regionTableId,
    customersTableId,
    productsTableId,
    salesTableId,
    customerRelationshipId: customerRelationship.relationship!.id,
    productRelationshipId: productRelationship.relationship!.id,
    regionRelationshipId: regionRelationship.relationship!.id,
    measureId: model.measures.find((m) => m.name === 'Total Revenue')!.id,
    countryColumn: customersDs.tables[0].columns.find((c) => c.name === 'Country')!,
    categoryColumn: productsDs.tables[0].columns.find((c) => c.name === 'Category')!,
    regionNameColumn: regionDs.tables[0].columns.find((c) => c.name === 'RegionName')!,
  }
}

export function withAverageOrderValue(model: SemanticModel, datasets: Record<string, Dataset>, salesTableId: string) {
  const withOrders = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Orders', expression: 'COUNTROWS(Sales)' })
  const withAov = createMeasure(withOrders.model, datasets, {
    homeModelTableId: salesTableId,
    name: 'Average Order Value',
    expression: 'DIVIDE([Total Revenue], [Orders])',
  })
  return { model: withAov.model, averageOrderValueId: withAov.measure!.id }
}
