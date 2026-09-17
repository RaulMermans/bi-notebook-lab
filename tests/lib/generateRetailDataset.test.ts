import { describe, expect, it } from 'vitest'
import { primaryTable } from '../../src/domain/data'
import { generateRetailDataset } from '../../src/lib/sample/generateRetailDataset'

describe('generateRetailDataset', () => {
  it('creates Customers, Products, Sales and Calendar tables within target sizes', () => {
    const datasets = generateRetailDataset()
    const tablesByName = Object.fromEntries(datasets.map((d) => [d.name, primaryTable(d)]))

    expect(Object.keys(tablesByName).sort()).toEqual(['Calendar', 'Customers', 'Products', 'Sales'])
    expect(tablesByName.Customers.rowCount).toBeGreaterThanOrEqual(50)
    expect(tablesByName.Customers.rowCount).toBeLessThanOrEqual(200)
    expect(tablesByName.Products.rowCount).toBeGreaterThanOrEqual(20)
    expect(tablesByName.Products.rowCount).toBeLessThanOrEqual(100)
    expect(tablesByName.Sales.rowCount).toBeGreaterThanOrEqual(500)
    expect(tablesByName.Sales.rowCount).toBeLessThanOrEqual(2000)
  })

  it('keeps Sales.Revenue and Sales.Cost consistent with Quantity × unit price/cost', () => {
    const datasets = generateRetailDataset()
    const sales = primaryTable(datasets.find((d) => d.name === 'Sales')!)
    const products = primaryTable(datasets.find((d) => d.name === 'Products')!)
    const productById = new Map(products.rows.map((row) => [row.ProductID, row]))

    for (const row of sales.rows.slice(0, 25)) {
      const product = productById.get(row.ProductID)!
      const expectedRevenue = Math.round(Number(row.Quantity) * Number(product.UnitPrice) * 100) / 100
      const expectedCost = Math.round(Number(row.Quantity) * Number(product.UnitCost) * 100) / 100
      expect(Number(row.Revenue)).toBeCloseTo(expectedRevenue, 2)
      expect(Number(row.Cost)).toBeCloseTo(expectedCost, 2)
    }
  })

  it('is deterministic across calls', () => {
    const first = generateRetailDataset().map((d) => primaryTable(d).rows)
    const second = generateRetailDataset().map((d) => primaryTable(d).rows)

    expect(first).toEqual(second)
  })
})
