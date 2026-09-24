import type { Dataset } from '../../../src/domain/data'
import type { ConformanceModelFixture, DaxConformanceCase } from '../../../src/conformance/types'
import { addTable, createModel, createRelationshipConfig } from '../../../src/runtime/model/modelRuntime'
import { buildSharedFixture, SPAIN_FILTER } from './sharedFixture'

const fixture = buildSharedFixture()

/**
 * A small dedicated Customers(1) -> Sales(*) fixture whose relationship can
 * be built active or inactive, for the "inactive relationship blocks
 * propagation" / "re-activating recovers it" pair below.
 *
 *   Customers: CustomerID, Country       Sales: OrderID, CustomerID, Revenue
 *     1         Spain                      1       1          100
 *     2         France                     2       2          200
 *                                           3       1           50
 *
 *   Totals: all rows 350; Spain-only (customer 1): 150.
 */
function buildInactiveRelationshipFixture(active: boolean): ConformanceModelFixture {
  const customersDs: Dataset = {
    id: 'inactive-customers-ds',
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
        ],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const salesDs: Dataset = {
    id: 'inactive-sales-ds',
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
        rows: [
          { OrderID: 1, CustomerID: 1, Revenue: 100 },
          { OrderID: 2, CustomerID: 2, Revenue: 200 },
          { OrderID: 3, CustomerID: 1, Revenue: 50 },
        ],
        rowCount: 3,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = { [customersDs.id]: customersDs, [salesDs.id]: salesDs }
  let model = createModel()
  model = addTable(model, { datasetId: customersDs.id, tableId: 'customers-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })

  const rel = createRelationshipConfig(
    model,
    {
      left: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customer-id' },
      right: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-customerid' },
      cardinality: 'one-to-many',
      oneSide: 'left',
      crossFilterDirection: 'left-to-right',
      active,
    },
    datasets,
  )
  model = rel.model

  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id
  return { model, datasets, homeModelTableId: salesTableId }
}

function inactiveCountryFilter() {
  return {
    filters: [
      { column: { datasetId: 'inactive-customers-ds', tableId: 'customers-table', columnId: 'customer-country' }, operator: 'equals' as const, values: ['Spain'] },
    ],
  }
}

/** Basic one-to-many propagation, inactive relationships, RELATED — see docs/MODEL_RUNTIME.md. */
export const RELATIONSHIP_CASES: DaxConformanceCase[] = [
  {
    id: 'relationships-001',
    category: 'Relationships',
    description: 'An explicit one-to-many relationship propagates a Customers-side filter into Sales',
    fixture,
    expression: 'SUM(Sales[Revenue])',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 150,
    provenance: 'hand-calculated',
  },
  {
    id: 'relationships-002',
    category: 'Relationships',
    description: 'A COUNTROWS aggregation also reflects one-to-many propagation, not just SUM',
    fixture,
    expression: 'COUNTROWS(Sales)',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 3, // orders 1, 3 and 4 all belong to Spain customers (1 and 3)
    provenance: 'hand-calculated',
  },
  {
    id: 'relationships-003',
    category: 'Relationships',
    description: 'An INACTIVE relationship does not propagate a Customers-side filter into Sales by default',
    fixture: buildInactiveRelationshipFixture(false),
    expression: 'SUM(Sales[Revenue])',
    evaluationMode: 'measure',
    filterContext: inactiveCountryFilter(),
    expected: 350, // unaffected — the Country filter never reaches Sales while the relationship is inactive
    provenance: 'hand-calculated',
  },
  {
    id: 'relationships-004',
    category: 'Relationships',
    description: 'Re-activating the same relationship recovers ordinary propagation',
    fixture: buildInactiveRelationshipFixture(true),
    expression: 'SUM(Sales[Revenue])',
    evaluationMode: 'measure',
    filterContext: inactiveCountryFilter(),
    expected: 150, // orders 1 (100) and 3 (50), same customer/order rows as relationships-001
    provenance: 'hand-calculated',
  },
  {
    id: 'relationships-005',
    category: 'Relationships',
    description: 'RELATED reads a "one"-side text column from the "many"-side row in a calculated column',
    fixture,
    expression: 'RELATED(Products[Category])',
    evaluationMode: 'calculated-column',
    expected: 'Furniture', // Sales row 0: OrderID 1, ProductID 1 -> Products row ProductID 1 = Furniture
    provenance: 'hand-calculated',
  },
  {
    id: 'relationships-006',
    category: 'Relationships',
    description: 'RELATED reads a "one"-side numeric column from the "many"-side row in a calculated column',
    fixture,
    expression: 'RELATED(Products[UnitPrice])',
    evaluationMode: 'calculated-column',
    expected: 100, // Sales row 0's ProductID 1 -> Products row UnitPrice 100
    provenance: 'hand-calculated',
  },
]
