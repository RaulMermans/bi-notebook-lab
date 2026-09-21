import type { DataColumn, DataTable, DataType, Dataset } from '../../domain/data'
import { generateId } from '../ids'

const SEED = 12345

function mulberry32(seed: number) {
  let state = seed
  return function random() {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Rng = () => number

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]
}

function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min
}

function randFloat(rng: Rng, min: number, max: number, decimals = 2): number {
  const value = rng() * (max - min) + min
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

const FIRST_NAMES = ['Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Lucas', 'Mia', 'Ethan', 'Sofia', 'Mateo', 'Amara', 'Priya'] as const
const LAST_NAMES = ['Johnson', 'Smith', 'Garcia', 'Muller', 'Dubois', 'Rossi', 'Andersson', 'Kowalski', 'Nguyen', 'Silva'] as const

/** Deliberately dirty country codes — some clean, some with the trailing-space typo the "Clean Customers" acceptance query (docs/APPLIED_STEPS.md) fixes with Replace Values. */
const COUNTRY_VARIANTS = ['ES', 'ES ', 'US', 'UK', 'FR', 'DE'] as const

const PRODUCTS = [
  { name: 'Wireless Headphones', category: 'Electronics', price: 89.99 },
  { name: 'Monitor 27"', category: 'Electronics', price: 249.0 },
  { name: 'Mechanical Keyboard', category: 'Electronics', price: 64.5 },
  { name: 'Webcam HD', category: 'Electronics', price: 39.99 },
  { name: 'Notebook Pack', category: 'Office Supplies', price: 6.5 },
  { name: 'Stapler', category: 'Office Supplies', price: 8.25 },
  { name: 'Desk Organizer', category: 'Office Supplies', price: 14.0 },
  { name: 'Office Chair', category: 'Furniture', price: 189.0 },
  { name: 'Standing Desk', category: 'Furniture', price: 349.0 },
  { name: 'Bookshelf', category: 'Furniture', price: 129.0 },
  { name: 'Coffee Maker', category: 'Home Appliances', price: 54.0 },
  { name: 'Air Purifier', category: 'Home Appliances', price: 119.0 },
] as const

const PROMOTIONS = ['Winter Sale', 'Clearance', 'Loyalty Discount'] as const

function column(name: string, dataType: DataType, nullable = false): DataColumn {
  return { id: generateId('col'), name, dataType, nullable }
}

function table(name: string, columns: DataColumn[], rows: Record<string, unknown>[]): DataTable {
  return { id: generateId('table'), name, columns, rows, rowCount: rows.length }
}

function dataset(key: string, name: string, sourceTable: DataTable): Dataset {
  return { id: generateId('dataset'), name, source: { type: 'sample', key }, tables: [sourceTable], createdAt: new Date().toISOString() }
}

/**
 * Sprint 12's Power Query Lab: deliberately messy source tables for practicing
 * Applied Steps — see docs/APPLIED_STEPS.md "Power Query Lab" for the
 * acceptance workflows this fixture supports. Seeded, so it's identical
 * across runs. Unlike `generateRetailDataset.ts`, tables are built directly
 * rather than through `buildDataTable`'s type inference: the whole point is
 * that `Customers_Dirty.customer_id` stays a `string` column full of
 * numeric-looking text, the way a real "formatted as Text" spreadsheet
 * column would import — inference would otherwise "fix" it before the
 * learner ever gets to practice Change Type.
 */
export function generatePowerQueryLabDataset(): Dataset[] {
  const rng = mulberry32(SEED)

  // --- Products (lookup table for Merge) ------------------------------
  const productIdCol = column('ProductID', 'integer')
  const productNameCol = column('ProductName', 'string')
  const categoryCol = column('Category', 'string')
  const unitPriceCol = column('UnitPrice', 'decimal')
  const productRows = PRODUCTS.map((p, index) => ({
    [productIdCol.name]: index + 1,
    [productNameCol.name]: p.name,
    [categoryCol.name]: p.category,
    [unitPriceCol.name]: p.price,
  }))
  const productsTable = table('Products', [productIdCol, productNameCol, categoryCol, unitPriceCol], productRows)

  // --- Customers_Dirty --------------------------------------------------
  const customerIdCol = column('customer_id', 'string', true)
  const customerNameCol = column('CustomerName', 'string')
  const countryCol = column('Country', 'string')
  const legacyNotesCol = column('LegacyNotes', 'string', true)
  const customerColumns = [customerIdCol, customerNameCol, countryCol, legacyNotesCol]

  const cleanCustomerCount = 100
  const customerRows: Record<string, unknown>[] = []
  for (let i = 1; i <= cleanCustomerCount; i += 1) {
    customerRows.push({
      [customerIdCol.name]: String(i),
      [customerNameCol.name]: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
      [countryCol.name]: pick(rng, COUNTRY_VARIANTS),
      [legacyNotesCol.name]: rng() > 0.7 ? 'Imported from legacy CRM' : null,
    })
  }
  // A handful of exact-duplicate rows (Remove Duplicates practice).
  for (const id of [3, 17, 42, 58, 91]) {
    customerRows.push({ ...customerRows[id - 1] })
  }
  // A handful of blank customer_id rows (Filter Rows practice). `null` is the app's canonical
  // blank (brief §28) — Change Type must pass these through untouched rather than fail on them.
  for (let i = 0; i < 3; i += 1) {
    customerRows.push({
      [customerIdCol.name]: null,
      [customerNameCol.name]: `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
      [countryCol.name]: pick(rng, COUNTRY_VARIANTS),
      [legacyNotesCol.name]: null,
    })
  }
  const customersDirtyTable = table('Customers_Dirty', customerColumns, customerRows)

  // --- Sales_Jan / Sales_Feb (append-compatible, Feb has an extra column) --
  function buildSalesRows(monthIndex: number, count: number, orderIdStart: number, withPromotion: boolean) {
    const daysInMonth = new Date(Date.UTC(2025, monthIndex + 1, 0)).getUTCDate()
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < count; i += 1) {
      const day = randInt(rng, 1, daysInMonth)
      const date = `2025-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      const customerId = randInt(rng, 1, cleanCustomerCount)
      const productIndex = randInt(rng, 0, PRODUCTS.length - 1)
      const quantity = randInt(rng, 1, 8)
      const revenue = Math.round(quantity * PRODUCTS[productIndex].price * 100) / 100
      const row: Record<string, unknown> = {
        OrderID: orderIdStart + i,
        Date: date,
        CustomerID: customerId,
        ProductID: productIndex + 1,
        Quantity: quantity,
        Revenue: revenue,
      }
      if (withPromotion) row.Promotion = rng() > 0.6 ? pick(rng, PROMOTIONS) : null
      rows.push(row)
    }
    return rows
  }

  const salesBaseColumns = [
    column('OrderID', 'integer'),
    column('Date', 'date'),
    column('CustomerID', 'integer'),
    column('ProductID', 'integer'),
    column('Quantity', 'integer'),
    column('Revenue', 'decimal'),
  ]

  const salesJanTable = table('Sales_Jan', salesBaseColumns.map((c) => ({ ...c, id: generateId('col') })), buildSalesRows(0, 150, 1, false))
  const salesFebColumns = [...salesBaseColumns.map((c) => ({ ...c, id: generateId('col') })), column('Promotion', 'string', true)]
  const salesFebTable = table('Sales_Feb', salesFebColumns, buildSalesRows(1, 150, 1000, true))

  return [
    dataset('power-query-lab-sales-jan', 'Sales_Jan', salesJanTable),
    dataset('power-query-lab-sales-feb', 'Sales_Feb', salesFebTable),
    dataset('power-query-lab-products', 'Products', productsTable),
    dataset('power-query-lab-customers-dirty', 'Customers_Dirty', customersDirtyTable),
  ]
}
