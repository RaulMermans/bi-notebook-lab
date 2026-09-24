import type { Dataset } from '../../../src/domain/data'
import type { ConformanceModelFixture, DaxConformanceCase } from '../../../src/conformance/types'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationshipConfig } from '../../../src/runtime/model/modelRuntime'

function dataset(id: string, name: string, tableId: string, columns: Dataset['tables'][0]['columns'], rows: Record<string, unknown>[]): Dataset {
  return {
    id,
    name,
    source: { type: 'sample', key: id },
    tables: [{ id: tableId, name, columns, rows, rowCount: rows.length }],
    createdAt: new Date().toISOString(),
  }
}

/**
 * 1:1 — Employees <-> Badges, cardinality `one-to-one` (which the runtime
 * requires `crossFilterDirection: 'both'` for — see `crossfilter.test.ts`'s
 * ONEWAY-rejection case and modelRuntime.ts `createRelationshipConfig`).
 *   Employees: EmployeeID 1, 2.  Badges: EmployeeID 1 (AccessCount 10), 2 (AccessCount 20).
 */
function buildOneToOneFixture(): ConformanceModelFixture {
  const employeesDs = dataset(
    'adv-employees-ds',
    'Employees',
    'employees-table',
    [{ id: 'employees-id', name: 'EmployeeID', dataType: 'integer', nullable: false }],
    [{ EmployeeID: 1 }, { EmployeeID: 2 }],
  )
  const badgesDs = dataset(
    'adv-badges-ds',
    'Badges',
    'badges-table',
    [
      { id: 'badges-employeeid', name: 'EmployeeID', dataType: 'integer', nullable: false },
      { id: 'badges-accesscount', name: 'AccessCount', dataType: 'integer', nullable: false },
    ],
    [
      { EmployeeID: 1, AccessCount: 10 },
      { EmployeeID: 2, AccessCount: 20 },
    ],
  )
  const datasets: Record<string, Dataset> = { [employeesDs.id]: employeesDs, [badgesDs.id]: badgesDs }
  let model = addTable(createModel(), { datasetId: employeesDs.id, tableId: 'employees-table' })
  model = addTable(model, { datasetId: badgesDs.id, tableId: 'badges-table' })
  const badgesTableId = model.tables.find((t) => t.datasetId === badgesDs.id)!.id

  const rel = createRelationshipConfig(
    model,
    {
      left: { datasetId: employeesDs.id, tableId: 'employees-table', columnId: 'employees-id' },
      right: { datasetId: badgesDs.id, tableId: 'badges-table', columnId: 'badges-employeeid' },
      cardinality: 'one-to-one',
      crossFilterDirection: 'both',
      active: true,
    },
    datasets,
  )
  model = rel.model

  return { model, datasets, homeModelTableId: badgesTableId }
}

/**
 * *:* — Products <-> Targets via Category, adapted from
 * `manyToManyPropagation.test.ts`'s fixture (with a numeric TargetAmount
 * column added so a measure can be graded).
 *   Products: 1/Electronics, 2/Electronics, 3/Furniture.
 *   Targets: North/Electronics/500, South/Electronics/300, North/Furniture/200, East/Office/999 (no match).
 */
function buildManyToManyFixture(): ConformanceModelFixture {
  const productsDs = dataset(
    'adv-products-ds',
    'Products',
    'products-table',
    [
      { id: 'products-id', name: 'ProductID', dataType: 'integer', nullable: false },
      { id: 'products-category', name: 'Category', dataType: 'string', nullable: false },
    ],
    [
      { ProductID: 1, Category: 'Electronics' },
      { ProductID: 2, Category: 'Electronics' },
      { ProductID: 3, Category: 'Furniture' },
    ],
  )
  const targetsDs = dataset(
    'adv-targets-ds',
    'Targets',
    'targets-table',
    [
      { id: 'targets-region', name: 'Region', dataType: 'string', nullable: false },
      { id: 'targets-category', name: 'Category', dataType: 'string', nullable: false },
      { id: 'targets-amount', name: 'TargetAmount', dataType: 'decimal', nullable: false },
    ],
    [
      { Region: 'North', Category: 'Electronics', TargetAmount: 500 },
      { Region: 'South', Category: 'Electronics', TargetAmount: 300 },
      { Region: 'North', Category: 'Furniture', TargetAmount: 200 },
      { Region: 'East', Category: 'Office', TargetAmount: 999 },
    ],
  )
  const datasets: Record<string, Dataset> = { [productsDs.id]: productsDs, [targetsDs.id]: targetsDs }
  let model = addTable(createModel(), { datasetId: productsDs.id, tableId: 'products-table' })
  model = addTable(model, { datasetId: targetsDs.id, tableId: 'targets-table' })
  const targetsTableId = model.tables.find((t) => t.datasetId === targetsDs.id)!.id

  const rel = createRelationshipConfig(
    model,
    {
      left: { datasetId: productsDs.id, tableId: 'products-table', columnId: 'products-category' },
      right: { datasetId: targetsDs.id, tableId: 'targets-table', columnId: 'targets-category' },
      cardinality: 'many-to-many',
      crossFilterDirection: 'left-to-right',
      active: true,
    },
    datasets,
  )
  model = rel.model

  return { model, datasets, homeModelTableId: targetsTableId }
}

/**
 * Bidirectional 1:* — Customers <-> Sales, adapted from
 * `bidirectionalPropagation.test.ts`. Customers 1,2,3,4; Sales O1->Cust1, O2->Cust4.
 */
function buildBidirectionalFixture(): ConformanceModelFixture {
  const customersDs = dataset(
    'adv-bidi-customers-ds',
    'Customers',
    'customers-table',
    [{ id: 'customers-id', name: 'CustomerID', dataType: 'integer', nullable: false }],
    [{ CustomerID: 1 }, { CustomerID: 2 }, { CustomerID: 3 }, { CustomerID: 4 }],
  )
  const salesDs = dataset(
    'adv-bidi-sales-ds',
    'Sales',
    'sales-table',
    [
      { id: 'sales-orderid', name: 'OrderID', dataType: 'integer', nullable: false },
      { id: 'sales-customerid', name: 'CustomerID', dataType: 'integer', nullable: false },
    ],
    [
      { OrderID: 1, CustomerID: 1 },
      { OrderID: 2, CustomerID: 4 },
    ],
  )
  const datasets: Record<string, Dataset> = { [customersDs.id]: customersDs, [salesDs.id]: salesDs }
  let model = addTable(createModel(), { datasetId: customersDs.id, tableId: 'customers-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })
  const customersTableId = model.tables.find((t) => t.datasetId === customersDs.id)!.id

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
  model = rel.model

  const withMeasure = createMeasure(model, datasets, { homeModelTableId: customersTableId, name: 'Customer Count', expression: 'COUNTROWS(Customers)' })
  return { model: withMeasure.model, datasets, homeModelTableId: customersTableId }
}

/**
 * CROSSFILTER(..., NONE) — Customers(1) -single-direction-> Sales(*), adapted
 * from `crossfilter.test.ts`'s "Revenue Ignoring Customer Filter" case.
 * Customers 1..4 (no revenue-relevant columns); Sales O1->Cust1 Revenue100, O2->Cust4 Revenue200.
 */
function buildCrossfilterNoneFixture(): ConformanceModelFixture {
  const customersDs = dataset(
    'adv-none-customers-ds',
    'Customers',
    'customers-table',
    [{ id: 'customers-id', name: 'CustomerID', dataType: 'integer', nullable: false }],
    [{ CustomerID: 1 }, { CustomerID: 2 }, { CustomerID: 3 }, { CustomerID: 4 }],
  )
  const salesDs = dataset(
    'adv-none-sales-ds',
    'Sales',
    'sales-table',
    [
      { id: 'sales-orderid', name: 'OrderID', dataType: 'integer', nullable: false },
      { id: 'sales-customerid', name: 'CustomerID', dataType: 'integer', nullable: false },
      { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
    ],
    [
      { OrderID: 1, CustomerID: 1, Revenue: 100 },
      { OrderID: 2, CustomerID: 4, Revenue: 200 },
    ],
  )
  const datasets: Record<string, Dataset> = { [customersDs.id]: customersDs, [salesDs.id]: salesDs }
  let model = addTable(createModel(), { datasetId: customersDs.id, tableId: 'customers-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })
  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

  const rel = createRelationshipConfig(
    model,
    {
      left: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customers-id' },
      right: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-customerid' },
      cardinality: 'one-to-many',
      oneSide: 'left',
      crossFilterDirection: 'left-to-right',
      active: true,
    },
    datasets,
  )
  model = rel.model

  let withMeasures = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
  withMeasures = createMeasure(withMeasures.model, datasets, {
    homeModelTableId: salesTableId,
    name: 'Revenue Ignoring Customer Filter',
    expression: 'CALCULATE([Total Revenue], CROSSFILTER(Customers[CustomerID], Sales[CustomerID], NONE))',
  })

  return { model: withMeasures.model, datasets, homeModelTableId: salesTableId }
}

/**
 * CROSSFILTER(..., BOTH) — Products(1) -single-direction-> Sales(*), adapted
 * from `crossfilter.test.ts`'s "Customers Seeing Order 2" case.
 * Products 1,2,3; Sales O1->Product1, O2->Product2.
 */
function buildCrossfilterBothFixture(): ConformanceModelFixture {
  const productsDs = dataset(
    'adv-both-products-ds',
    'Products',
    'products-table',
    [{ id: 'products-id', name: 'ProductID', dataType: 'integer', nullable: false }],
    [{ ProductID: 1 }, { ProductID: 2 }, { ProductID: 3 }],
  )
  const salesDs = dataset(
    'adv-both-sales-ds',
    'Sales',
    'sales-table',
    [
      { id: 'sales-orderid', name: 'OrderID', dataType: 'integer', nullable: false },
      { id: 'sales-productid', name: 'ProductID', dataType: 'integer', nullable: false },
    ],
    [
      { OrderID: 1, ProductID: 1 },
      { OrderID: 2, ProductID: 2 },
    ],
  )
  const datasets: Record<string, Dataset> = { [productsDs.id]: productsDs, [salesDs.id]: salesDs }
  let model = addTable(createModel(), { datasetId: productsDs.id, tableId: 'products-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })
  const productsTableId = model.tables.find((t) => t.datasetId === productsDs.id)!.id

  const rel = createRelationshipConfig(
    model,
    {
      left: { datasetId: productsDs.id, tableId: 'products-table', columnId: 'products-id' },
      right: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-productid' },
      cardinality: 'one-to-many',
      oneSide: 'left',
      crossFilterDirection: 'left-to-right',
      active: true,
    },
    datasets,
  )
  model = rel.model

  let withMeasures = createMeasure(model, datasets, { homeModelTableId: productsTableId, name: 'Product Count', expression: 'COUNTROWS(Products)' })
  withMeasures = createMeasure(withMeasures.model, datasets, {
    homeModelTableId: productsTableId,
    name: 'Products Seeing Order 1',
    expression: 'CALCULATE([Product Count], CROSSFILTER(Products[ProductID], Sales[ProductID], BOTH))',
  })

  return { model: withMeasures.model, datasets, homeModelTableId: productsTableId }
}

/**
 * USERELATIONSHIP — Customers(RegionID) with two relationships to Sales:
 * BillRegionID (active) and ShipRegionID (inactive), adapted from
 * `userelationship.test.ts`. O1: Bill 1, Ship 2, Revenue 100. O2: Bill 2, Ship 1, Revenue 200.
 */
function buildUserelationshipFixture(): ConformanceModelFixture {
  const customersDs = dataset(
    'adv-ur-customers-ds',
    'Customers',
    'customers-table',
    [{ id: 'customers-regionid', name: 'RegionID', dataType: 'integer', nullable: false }],
    [{ RegionID: 1 }, { RegionID: 2 }],
  )
  const salesDs = dataset(
    'adv-ur-sales-ds',
    'Sales',
    'sales-table',
    [
      { id: 'sales-orderid', name: 'OrderID', dataType: 'integer', nullable: false },
      { id: 'sales-billregionid', name: 'BillRegionID', dataType: 'integer', nullable: false },
      { id: 'sales-shipregionid', name: 'ShipRegionID', dataType: 'integer', nullable: false },
      { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
    ],
    [
      { OrderID: 1, BillRegionID: 1, ShipRegionID: 2, Revenue: 100 },
      { OrderID: 2, BillRegionID: 2, ShipRegionID: 1, Revenue: 200 },
    ],
  )
  const datasets: Record<string, Dataset> = { [customersDs.id]: customersDs, [salesDs.id]: salesDs }
  let model = addTable(createModel(), { datasetId: customersDs.id, tableId: 'customers-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })
  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

  const billRel = createRelationshipConfig(
    model,
    {
      left: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customers-regionid' },
      right: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-billregionid' },
      cardinality: 'one-to-many',
      oneSide: 'left',
      crossFilterDirection: 'left-to-right',
      active: true,
    },
    datasets,
  )
  model = billRel.model

  const shipRel = createRelationshipConfig(
    model,
    {
      left: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customers-regionid' },
      right: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-shipregionid' },
      cardinality: 'one-to-many',
      oneSide: 'left',
      crossFilterDirection: 'left-to-right',
      active: false,
    },
    datasets,
  )
  model = shipRel.model

  let withMeasures = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
  withMeasures = createMeasure(withMeasures.model, datasets, {
    homeModelTableId: salesTableId,
    name: 'Shipped Revenue',
    expression: 'CALCULATE([Total Revenue], USERELATIONSHIP(Sales[ShipRegionID], Customers[RegionID]))',
  })

  return { model: withMeasures.model, datasets, homeModelTableId: salesTableId }
}

const oneToOneFixture = buildOneToOneFixture()
const manyToManyFixture = buildManyToManyFixture()
const bidirectionalFixture = buildBidirectionalFixture()
const crossfilterNoneFixture = buildCrossfilterNoneFixture()
const crossfilterBothFixture = buildCrossfilterBothFixture()
const userelationshipFixture = buildUserelationshipFixture()

/** 1:1, *:*, bidirectional cardinalities, USERELATIONSHIP, CROSSFILTER — see docs/ADVANCED_RELATIONSHIPS.md and docs/USERELATIONSHIP.md. */
export const ADVANCED_RELATIONSHIP_CASES: DaxConformanceCase[] = [
  {
    id: 'advancedRelationships-001',
    category: 'Advanced relationships',
    description: 'A one-to-one relationship propagates a filter from Employees into Badges',
    fixture: oneToOneFixture,
    expression: 'SUM(Badges[AccessCount])',
    evaluationMode: 'measure',
    filterContext: { filters: [{ column: { datasetId: 'adv-employees-ds', tableId: 'employees-table', columnId: 'employees-id' }, operator: 'equals', values: [1] }] },
    expected: 10,
    provenance: 'hand-calculated',
  },
  {
    id: 'advancedRelationships-002',
    category: 'Advanced relationships',
    description: 'A many-to-many relationship propagates a Products[Category] filter into every matching Targets row, duplicates included',
    fixture: manyToManyFixture,
    expression: 'SUM(Targets[TargetAmount])',
    evaluationMode: 'measure',
    filterContext: { filters: [{ column: { datasetId: 'adv-products-ds', tableId: 'products-table', columnId: 'products-category' }, operator: 'equals', values: ['Electronics'] }] },
    expected: 800, // North/Electronics (500) + South/Electronics (300)
    provenance: 'hand-calculated',
  },
  {
    id: 'advancedRelationships-003',
    category: 'Advanced relationships',
    description: 'A bidirectional one-to-many relationship lets a "*"-side (Sales) filter reach back to the "1" side (Customers)',
    fixture: bidirectionalFixture,
    expression: '[Customer Count]',
    evaluationMode: 'measure',
    filterContext: { filters: [{ column: { datasetId: 'adv-bidi-sales-ds', tableId: 'sales-table', columnId: 'sales-orderid' }, operator: 'equals', values: [1] }] },
    expected: 1, // Order 1 belongs to Customer 1 only
    provenance: 'hand-calculated',
  },
  {
    id: 'advancedRelationships-004',
    category: 'Advanced relationships',
    description: 'CROSSFILTER(..., NONE) disables an otherwise-active single-direction relationship for one calculation',
    fixture: crossfilterNoneFixture,
    expression: '[Revenue Ignoring Customer Filter]',
    evaluationMode: 'measure',
    filterContext: { filters: [{ column: { datasetId: 'adv-none-customers-ds', tableId: 'customers-table', columnId: 'customers-id' }, operator: 'equals', values: [1] }] },
    expected: 300, // both orders (100 + 200) visible once the Customers -> Sales relationship is disabled
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'advancedRelationships-005',
    category: 'Advanced relationships',
    description: 'CROSSFILTER(..., BOTH) adds reverse propagation to a relationship that is normally single-direction',
    fixture: crossfilterBothFixture,
    expression: '[Products Seeing Order 1]',
    evaluationMode: 'measure',
    filterContext: { filters: [{ column: { datasetId: 'adv-both-sales-ds', tableId: 'sales-table', columnId: 'sales-orderid' }, operator: 'equals', values: [1] }] },
    expected: 1, // Order 1 is Product 1 only, reverse-propagated back onto Products
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'advancedRelationships-006',
    category: 'Advanced relationships',
    description: 'A plain measure uses the active relationship (BillRegionID) when USERELATIONSHIP is not specified',
    fixture: userelationshipFixture,
    expression: '[Total Revenue]',
    evaluationMode: 'measure',
    filterContext: { filters: [{ column: { datasetId: 'adv-ur-customers-ds', tableId: 'customers-table', columnId: 'customers-regionid' }, operator: 'equals', values: [1] }] },
    expected: 100, // Order 1: BillRegionID 1
    provenance: 'hand-calculated',
  },
  {
    id: 'advancedRelationships-007',
    category: 'Advanced relationships',
    description: 'USERELATIONSHIP switches CALCULATE to the otherwise-inactive ShipRegionID relationship for one calculation',
    fixture: userelationshipFixture,
    expression: '[Shipped Revenue]',
    evaluationMode: 'measure',
    filterContext: { filters: [{ column: { datasetId: 'adv-ur-customers-ds', tableId: 'customers-table', columnId: 'customers-regionid' }, operator: 'equals', values: [1] }] },
    expected: 200, // Order 2: ShipRegionID 1
    provenance: 'hand-calculated',
  },
]
