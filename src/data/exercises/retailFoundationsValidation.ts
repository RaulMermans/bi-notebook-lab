import { generateRetailDataset } from '../../lib/sample/generateRetailDataset'
import type { MeasureValidationCase, TableSelector, ValidationSpec } from '../../domain/validation'

/**
 * Frozen fixture values for the Retail Foundations checkpoint.
 *
 * These are derived **independently** of the model/measure/calculated-column
 * runtime: `generateRetailDataset()` is a seeded, deterministic generator
 * (see `lib/sample/generateRetailDataset.ts`), and the numbers below come
 * from plain array reduction over its raw rows — never from executing a
 * `SemanticModel`, a `Measure`, or a learner's expression. This keeps the
 * checkpoint from being circular: it can't "agree with itself" the way it
 * would if the expected values were computed by running the very runtime
 * being validated (docs/VALIDATION_ENGINE.md "Expected values are exercise
 * fixtures").
 */
const [customersDs, productsDs, salesDs, calendarDs] = generateRetailDataset()
const customerRows = customersDs.tables[0].rows
const productRows = productsDs.tables[0].rows
const salesRows = salesDs.tables[0].rows
const calendarRows = calendarDs.tables[0].rows

function sum(rows: Record<string, unknown>[], selector: (row: Record<string, unknown>) => number): number {
  return rows.reduce((total, row) => total + selector(row), 0)
}

const totalRevenue = sum(salesRows, (r) => r.Revenue as number)
const totalCost = sum(salesRows, (r) => r.Cost as number)
const grossMargin = totalRevenue - totalCost
const orders = new Set(salesRows.map((r) => r.OrderID)).size
const averageOrderValue = totalRevenue / orders

const spainCustomerIds = new Set(customerRows.filter((r) => r.Country === 'Spain').map((r) => r.CustomerID))
const furnitureProductIds = new Set(productRows.filter((r) => r.Category === 'Furniture').map((r) => r.ProductID))
const targetYear = calendarRows[0].Year as number
const datesInTargetYear = new Set(calendarRows.filter((r) => r.Year === targetYear).map((r) => r.Date))

const revenueSpain = sum(
  salesRows.filter((r) => spainCustomerIds.has(r.CustomerID)),
  (r) => r.Revenue as number,
)
const revenueFurniture = sum(
  salesRows.filter((r) => furnitureProductIds.has(r.ProductID)),
  (r) => r.Revenue as number,
)
const revenueSpainFurniture = sum(
  salesRows.filter((r) => spainCustomerIds.has(r.CustomerID) && furnitureProductIds.has(r.ProductID)),
  (r) => r.Revenue as number,
)
const revenueTargetYear = sum(
  salesRows.filter((r) => datesInTargetYear.has(r.Date)),
  (r) => r.Revenue as number,
)

const CUSTOMERS: TableSelector = { tableName: 'Customers', sourceKey: 'customers' }
const PRODUCTS: TableSelector = { tableName: 'Products', sourceKey: 'products' }
const SALES: TableSelector = { tableName: 'Sales', sourceKey: 'sales' }
const CALENDAR: TableSelector = { tableName: 'Calendar', sourceKey: 'calendar' }

// `Sales[OrderID]` is `index + 1` for every generated row (see
// generateRetailDataset.ts), so `salesRows[orderId - 1]` is a direct lookup —
// but the validation rule below still identifies each row by an explicit
// `OrderID` equality selector, never "row N", matching the runtime's own
// row-identity rule (docs/VALIDATION_ENGINE.md "Row identity").
const MARGIN_ORDER_IDS = [1, 375, 750, 1125, 1500]
const marginCases = MARGIN_ORDER_IDS.map((orderId) => {
  const row = salesRows[orderId - 1]
  return {
    id: `margin-order-${orderId}`,
    title: `OrderID ${orderId}`,
    row: { column: { table: SALES, columnName: 'OrderID' }, equals: orderId },
    expected: (row.Revenue as number) - (row.Cost as number),
  }
})

function singleCase(id: string, expected: number): MeasureValidationCase[] {
  return [{ id, title: 'All data', filters: [], expected }]
}

/**
 * The first real scored checkpoint (Sprint 5). A complete, correct Retail
 * solution — three relationships, a valid star schema, `Margin`, `Total
 * Revenue`, `Orders`, `Average Order Value`, `Gross Margin` — scores
 * 100/100. See `tests/runtime/validation/retailFoundationsE2E.test.ts` for
 * the full worked solution this spec is built against.
 */
export const retailFoundationsValidationSpec: ValidationSpec = {
  id: 'retail-foundations-checkpoint',
  title: 'Retail Foundations',
  passingPercentage: 70,
  rules: [
    {
      id: 'rel-customers-sales',
      type: 'relationship',
      title: 'Customers → Sales relationship',
      category: 'Model',
      points: 10,
      one: { table: CUSTOMERS, columnName: 'CustomerID' },
      many: { table: SALES, columnName: 'CustomerID' },
    },
    {
      id: 'rel-products-sales',
      type: 'relationship',
      title: 'Products → Sales relationship',
      category: 'Model',
      points: 10,
      one: { table: PRODUCTS, columnName: 'ProductID' },
      many: { table: SALES, columnName: 'ProductID' },
    },
    {
      id: 'rel-calendar-sales',
      type: 'relationship',
      title: 'Calendar → Sales relationship',
      category: 'Model',
      points: 10,
      one: { table: CALENDAR, columnName: 'Date' },
      many: { table: SALES, columnName: 'Date' },
    },
    {
      id: 'model-health',
      type: 'model-health',
      title: 'Valid star schema',
      category: 'Model',
      points: 10,
      required: true,
      requireValidGraph: true,
      requireStarSchema: true,
    },
    {
      id: 'margin-column',
      type: 'calculated-column-result',
      title: 'Margin',
      category: 'Calculated column',
      points: 10,
      column: { table: SALES, name: 'Margin' },
      cases: marginCases,
    },
    {
      id: 'measure-total-revenue',
      type: 'measure-result',
      title: 'Total Revenue',
      category: 'Measures',
      points: 10,
      measure: { name: 'Total Revenue' },
      cases: singleCase('all', totalRevenue),
    },
    {
      id: 'measure-orders',
      type: 'measure-result',
      title: 'Orders',
      category: 'Measures',
      points: 10,
      measure: { name: 'Orders' },
      cases: singleCase('all', orders),
    },
    {
      id: 'measure-aov',
      type: 'measure-result',
      title: 'Average Order Value',
      category: 'Measures',
      points: 10,
      measure: { name: 'Average Order Value' },
      cases: singleCase('all', averageOrderValue),
    },
    {
      id: 'measure-gross-margin',
      type: 'measure-result',
      title: 'Gross Margin',
      category: 'Measures',
      points: 10,
      measure: { name: 'Gross Margin' },
      cases: singleCase('all', grossMargin),
    },
    {
      id: 'context-total-revenue',
      type: 'measure-result',
      title: 'Total Revenue responds to filter context',
      category: 'Filter behavior',
      points: 10,
      measure: { name: 'Total Revenue' },
      cases: [
        {
          id: 'spain',
          title: 'Country = Spain',
          filters: [{ column: { table: CUSTOMERS, columnName: 'Country' }, values: ['Spain'] }],
          expected: revenueSpain,
        },
        {
          id: 'furniture',
          title: 'Category = Furniture',
          filters: [{ column: { table: PRODUCTS, columnName: 'Category' }, values: ['Furniture'] }],
          expected: revenueFurniture,
        },
        {
          id: 'spain-furniture',
          title: 'Spain + Furniture',
          filters: [
            { column: { table: CUSTOMERS, columnName: 'Country' }, values: ['Spain'] },
            { column: { table: PRODUCTS, columnName: 'Category' }, values: ['Furniture'] },
          ],
          expected: revenueSpainFurniture,
        },
        {
          id: 'year',
          title: `Year = ${targetYear}`,
          filters: [{ column: { table: CALENDAR, columnName: 'Year' }, values: [targetYear] }],
          expected: revenueTargetYear,
        },
      ],
    },
  ],
}
