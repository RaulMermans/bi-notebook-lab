import { describe, expect, it } from 'vitest'
import { generatePowerQueryLabDataset } from '../../src/lib/sample/generatePowerQueryLabDataset'

describe('generatePowerQueryLabDataset', () => {
  it('is deterministic across runs', () => {
    const a = generatePowerQueryLabDataset()
    const b = generatePowerQueryLabDataset()
    const strip = (datasets: ReturnType<typeof generatePowerQueryLabDataset>) =>
      datasets.map((d) => ({ name: d.name, tables: d.tables.map((t) => ({ name: t.name, columns: t.columns.map((c) => ({ name: c.name, dataType: c.dataType })), rows: t.rows })) }))
    expect(strip(a)).toEqual(strip(b))
  })

  it('produces the four documented tables with the expected messiness', () => {
    const [salesJan, salesFeb, products, customersDirty] = generatePowerQueryLabDataset()

    expect(salesJan.tables[0].name).toBe('Sales_Jan')
    expect(salesFeb.tables[0].name).toBe('Sales_Feb')
    expect(products.tables[0].name).toBe('Products')
    expect(customersDirty.tables[0].name).toBe('Customers_Dirty')

    // Sales_Feb has an extra column Sales_Jan lacks (append-compatible, mismatched schema).
    const janNames = salesJan.tables[0].columns.map((c) => c.name)
    const febNames = salesFeb.tables[0].columns.map((c) => c.name)
    expect(febNames).toContain('Promotion')
    expect(janNames).not.toContain('Promotion')

    // customer_id is deliberately a string column full of numeric-looking text.
    const customerIdColumn = customersDirty.tables[0].columns.find((c) => c.name === 'customer_id')!
    expect(customerIdColumn.dataType).toBe('string')
    expect(customersDirty.tables[0].rows.some((r) => typeof r.customer_id === 'string' && r.customer_id !== '')).toBe(true)

    // Contains duplicate rows, blank ids, and dirty country codes.
    expect(customersDirty.tables[0].rows.some((r) => r.customer_id === null)).toBe(true)
    expect(customersDirty.tables[0].rows.some((r) => r.Country === 'ES ')).toBe(true)
    const ids = customersDirty.tables[0].rows.map((r) => r.customer_id)
    expect(new Set(ids).size).toBeLessThan(ids.length) // real duplicates exist

    // Products is a clean lookup table.
    expect(products.tables[0].columns.map((c) => c.name)).toEqual(['ProductID', 'ProductName', 'Category', 'UnitPrice'])
  })
})
