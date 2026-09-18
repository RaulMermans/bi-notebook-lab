import type { Dataset } from '../../../src/domain/data'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'

/**
 * A small star schema for Sprint 9 iterator/conditional tests:
 *   Customers 1 -CustomerID-> * Sales <-ProductID-* 1 Products
 * Sales carries Quantity/Revenue/Cost and Products carries UnitPrice, so the
 * fixture directly supports the sprint brief §55 acceptance shapes (Gross
 * Margin X, Calculated Revenue via RELATED, High Quantity Revenue via
 * FILTER+SUMX) at a size small enough to hand-verify expected values.
 */
export function buildIteratorFixture() {
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
          { id: 'product-unitprice', name: 'UnitPrice', dataType: 'decimal', nullable: false },
        ],
        rows: [
          { ProductID: 1, Category: 'Furniture', UnitPrice: 10 },
          { ProductID: 2, Category: 'Electronics', UnitPrice: 20 },
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
          { id: 'sales-quantity', name: 'Quantity', dataType: 'integer', nullable: false },
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
          { id: 'sales-cost', name: 'Cost', dataType: 'decimal', nullable: false },
        ],
        // Revenue = Quantity * Products[UnitPrice] for every row (verifies SUMX + RELATED == SUM(Revenue)).
        rows: [
          { OrderID: 1, CustomerID: 1, ProductID: 1, Quantity: 2, Revenue: 20, Cost: 12 }, // Spain, Furniture
          { OrderID: 2, CustomerID: 2, ProductID: 2, Quantity: 3, Revenue: 60, Cost: 30 }, // France, Electronics
          { OrderID: 3, CustomerID: 3, ProductID: 1, Quantity: 6, Revenue: 60, Cost: 36 }, // Spain, Furniture, Quantity >= 5
          { OrderID: 4, CustomerID: 1, ProductID: 2, Quantity: 1, Revenue: 20, Cost: 14 }, // Spain, Electronics
          { OrderID: 5, CustomerID: 2, ProductID: 1, Quantity: 8, Revenue: 80, Cost: 48 }, // France, Furniture, Quantity >= 5
        ],
        rowCount: 5,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = {
    [customersDs.id]: customersDs,
    [productsDs.id]: productsDs,
    [salesDs.id]: salesDs,
  }

  let model = createModel('Iterator fixture')
  model = addTable(model, { datasetId: customersDs.id, tableId: 'customers-table' })
  model = addTable(model, { datasetId: productsDs.id, tableId: 'products-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })

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

  const totalRevenue = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
  model = totalRevenue.model
  const totalCost = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Cost', expression: 'SUM(Sales[Cost])' })
  model = totalCost.model

  return {
    model,
    datasets,
    customersTableId,
    productsTableId,
    salesTableId,
    customerRelationshipId: customerRelationship.relationship!.id,
    productRelationshipId: productRelationship.relationship!.id,
    totalRevenueId: model.measures.find((m) => m.name === 'Total Revenue')!.id,
    totalCostId: model.measures.find((m) => m.name === 'Total Cost')!.id,
  }
}
