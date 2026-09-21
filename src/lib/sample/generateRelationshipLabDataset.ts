import type { Dataset } from '../../domain/data'
import { buildDataTable } from '../buildDataTable'
import { generateId } from '../ids'

/**
 * Sprint 11's "Relationship Lab" sample dataset — separate from
 * `generateRetailDataset.ts` (deliberately untouched — sprint brief §35
 * "do not destabilize the existing Retail dataset"). Exercises every
 * advanced-relationship scenario the sprint requires:
 *
 * - `Calendar.Date -> Sales.OrderDate` / `Calendar.Date -> Sales.ShipDate`:
 *   the canonical role-playing (Order Date / Ship Date) fixture.
 * - `Customers.CustomerID <-> CustomerProfile.CustomerID`: a 1:1 fixture
 *   (exactly one profile row per customer, disjoint attribute columns).
 * - `Products.Category <-> Targets.Category`: a *:* fixture (duplicates on
 *   both sides — many products per category, many target rows per category
 *   across regions).
 *
 * Seeded (mulberry32) so the dataset — and every aggregate a test derives
 * from it — is identical across runs.
 */
const SEED = 1101

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

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

const COUNTRIES = ['United States', 'Canada', 'United Kingdom', 'Germany', 'Spain'] as const
const LOYALTY_TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum'] as const
const CATEGORIES = ['Electronics', 'Furniture', 'Office Supplies', 'Appliances'] as const
const REGIONS = ['North', 'South', 'East'] as const
const FIRST_NAMES = ['Ana', 'Ben', 'Chloe', 'Dev', 'Elin', 'Farid', 'Grace', 'Hiro', 'Ines', 'Jonas'] as const
const LAST_NAMES = ['Ortiz', 'Weber', 'Nguyen', 'Patel', 'Larsen', 'Dubois', 'Rossi', 'Kim', 'Novak', 'Silva'] as const
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

function buildDataset(key: string, name: string, table: ReturnType<typeof buildDataTable>): Dataset {
  return {
    id: generateId('dataset'),
    name,
    source: { type: 'sample', key },
    tables: [table],
    createdAt: new Date().toISOString(),
  }
}

/**
 * Generates the Relationship Lab sample: `Calendar`, `Customers`,
 * `CustomerProfile`, `Sales` (with both `OrderDate` and `ShipDate`),
 * `Products` and `Targets`.
 */
export function generateRelationshipLabDataset(): Dataset[] {
  const rng = mulberry32(SEED)

  const calendarStart = new Date(Date.UTC(2024, 0, 1))
  const calendarEnd = new Date(Date.UTC(2025, 11, 31))
  const calendarDates: string[] = []
  const calendarRows: unknown[][] = []
  for (let day = new Date(calendarStart); day <= calendarEnd; day.setUTCDate(day.getUTCDate() + 1)) {
    const iso = day.toISOString().slice(0, 10)
    const monthNumber = day.getUTCMonth() + 1
    calendarDates.push(iso)
    calendarRows.push([iso, day.getUTCFullYear(), MONTH_NAMES[monthNumber - 1], monthNumber, `Q${Math.ceil(monthNumber / 3)}`])
  }
  const calendarTable = buildDataTable('Calendar', {
    headers: ['Date', 'Year', 'Month', 'MonthNumber', 'Quarter'],
    rows: calendarRows,
  })

  const customerCount = 30
  const customerRows = Array.from({ length: customerCount }, (_, index) => [
    index + 1,
    `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
    pick(rng, COUNTRIES),
  ])
  const customersTable = buildDataTable('Customers', {
    headers: ['CustomerID', 'CustomerName', 'Country'],
    rows: customerRows,
  })

  // 1:1 fixture: exactly one profile row per CustomerID, disjoint attribute columns from Customers.
  const customerProfileRows = Array.from({ length: customerCount }, (_, index) => [
    index + 1,
    pick(rng, LOYALTY_TIERS),
    addDays(calendarDates[0], randInt(rng, 0, 200)),
  ])
  const customerProfileTable = buildDataTable('CustomerProfile', {
    headers: ['CustomerID', 'LoyaltyTier', 'SignupDate'],
    rows: customerProfileRows,
  })

  const productsPerCategory = 5
  const products: { id: number; category: string; unitPrice: number }[] = []
  let productId = 1
  for (const category of CATEGORIES) {
    for (let i = 0; i < productsPerCategory; i += 1) {
      products.push({ id: productId, category, unitPrice: randFloat(rng, 10, 500) })
      productId += 1
    }
  }
  const productsTable = buildDataTable('Products', {
    headers: ['ProductID', 'Category', 'UnitPrice'],
    rows: products.map((p) => [p.id, p.category, p.unitPrice]),
  })

  // *:* fixture: every category appears once per region (duplicates on both the Products and Targets sides).
  const targetRows: unknown[][] = []
  for (const category of CATEGORIES) {
    for (const region of REGIONS) {
      targetRows.push([category, region, randFloat(rng, 5000, 20000, 0)])
    }
  }
  const targetsTable = buildDataTable('Targets', {
    headers: ['Category', 'Region', 'TargetAmount'],
    rows: targetRows,
  })

  // Order dates stay in the first ~700 days of the Calendar range so `OrderDate + shipDelay`
  // (1-7 days) always lands on a real Calendar date, never past the end of 2025.
  const orderableStart = 0
  const orderableEnd = calendarDates.length - 8
  const salesCount = 500
  const salesRows = Array.from({ length: salesCount }, (_, index) => {
    const orderDate = calendarDates[randInt(rng, orderableStart, orderableEnd)]
    const shipDelay = randInt(rng, 1, 7)
    const shipDate = addDays(orderDate, shipDelay)
    const customerId = randInt(rng, 1, customerCount)
    const product = pick(rng, products)
    const quantity = randInt(rng, 1, 5)
    const revenue = Math.round(quantity * product.unitPrice * 100) / 100
    return [index + 1, orderDate, shipDate, customerId, revenue]
  })
  const salesTable = buildDataTable('Sales', {
    headers: ['OrderID', 'OrderDate', 'ShipDate', 'CustomerID', 'Revenue'],
    rows: salesRows,
  })

  return [
    buildDataset('relationship-lab-calendar', 'Calendar', calendarTable),
    buildDataset('relationship-lab-customers', 'Customers', customersTable),
    buildDataset('relationship-lab-customer-profile', 'CustomerProfile', customerProfileTable),
    buildDataset('relationship-lab-products', 'Products', productsTable),
    buildDataset('relationship-lab-targets', 'Targets', targetsTable),
    buildDataset('relationship-lab-sales', 'Sales', salesTable),
  ]
}
