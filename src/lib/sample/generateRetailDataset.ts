import type { Dataset } from '../../domain/data'
import { buildDataTable } from '../buildDataTable'
import { generateId } from '../ids'

const SEED = 42

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

const COUNTRIES = [
  'United States', 'Canada', 'United Kingdom', 'Germany', 'France',
  'Spain', 'Italy', 'Netherlands', 'Sweden', 'Australia',
] as const

const SEGMENTS = ['Consumer', 'Corporate', 'Small Business'] as const

const FIRST_NAMES = [
  'Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Lucas', 'Mia', 'Ethan',
  'Sofia', 'Mateo', 'Amara', 'Kenji', 'Priya', 'Diego', 'Freya', 'Omar',
] as const

const LAST_NAMES = [
  'Johnson', 'Smith', 'Garcia', 'Müller', 'Dubois', 'Rossi', 'Andersson',
  'Kowalski', 'Nguyen', 'Silva', 'Khan', 'Larsen', 'Costa', 'Novak',
] as const

const PRODUCT_CATALOG: Record<string, readonly string[]> = {
  Electronics: ['Wireless Headphones', 'Monitor 27"', 'Mechanical Keyboard', 'Wireless Mouse', 'Webcam HD', 'Bluetooth Speaker'],
  'Office Supplies': ['Notebook Pack', 'Stapler', 'Desk Organizer', 'Whiteboard', 'Sticky Notes Set'],
  Furniture: ['Office Chair', 'Standing Desk', 'Bookshelf', 'Filing Cabinet', 'Desk Lamp'],
  'Home Appliances': ['Coffee Maker', 'Blender', 'Toaster', 'Air Purifier'],
}

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

export interface GenerateRetailDatasetOptions {
  /**
   * Sprint 16 performance benchmark hook (docs/PERFORMANCE.md) — lets the
   * benchmark harness build the same deterministic Sales shape at 1k/10k/
   * 50k/100k rows instead of a separate fixture generator. Defaults to the
   * original fixed size so every existing caller (samples, lessons,
   * practice projects, tests) is unaffected.
   */
  salesCount?: number
}

/**
 * Generates the built-in Retail Foundations dataset: Customers, Products,
 * Sales and Calendar tables sized and linked so Sprint 2+ exercises
 * (relationships, revenue, margin, time intelligence) have coherent data to
 * work with. Uses a seeded PRNG so the dataset is identical across runs for
 * a given `salesCount`.
 */
export function generateRetailDataset(options: GenerateRetailDatasetOptions = {}): Dataset[] {
  const rng = mulberry32(SEED)

  const customerCount = 120
  const customerRows = Array.from({ length: customerCount }, (_, index) => [
    index + 1,
    `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`,
    pick(rng, COUNTRIES),
    pick(rng, SEGMENTS),
  ])
  const customersTable = buildDataTable('Customers', {
    headers: ['CustomerID', 'CustomerName', 'Country', 'Segment'],
    rows: customerRows,
  })

  const products: { id: number; name: string; category: string; cost: number; price: number }[] = []
  let productId = 1
  for (const [category, names] of Object.entries(PRODUCT_CATALOG)) {
    for (const name of names) {
      const cost = randFloat(rng, 5, 300)
      const price = Math.round(cost * randFloat(rng, 1.3, 2.2) * 100) / 100
      products.push({ id: productId, name, category, cost, price })
      productId += 1
    }
  }
  const productsTable = buildDataTable('Products', {
    headers: ['ProductID', 'ProductName', 'Category', 'UnitCost', 'UnitPrice'],
    rows: products.map((p) => [p.id, p.name, p.category, p.cost, p.price]),
  })

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

  const salesCount = options.salesCount ?? 1500
  const salesRows = Array.from({ length: salesCount }, (_, index) => {
    const date = pick(rng, calendarDates)
    const customerId = randInt(rng, 1, customerCount)
    const product = pick(rng, products)
    const quantity = randInt(rng, 1, 10)
    const revenue = Math.round(quantity * product.price * 100) / 100
    const cost = Math.round(quantity * product.cost * 100) / 100
    return [index + 1, date, customerId, product.id, quantity, revenue, cost]
  })
  const salesTable = buildDataTable('Sales', {
    headers: ['OrderID', 'Date', 'CustomerID', 'ProductID', 'Quantity', 'Revenue', 'Cost'],
    rows: salesRows,
  })

  return [
    buildDataset('customers', 'Customers', customersTable),
    buildDataset('products', 'Products', productsTable),
    buildDataset('sales', 'Sales', salesTable),
    buildDataset('calendar', 'Calendar', calendarTable),
  ]
}
