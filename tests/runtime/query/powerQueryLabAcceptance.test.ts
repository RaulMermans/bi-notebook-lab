import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { generatePowerQueryLabDataset } from '../../../src/lib/sample/generatePowerQueryLabDataset'
import { addQueryStep, createQueryDefinition, evaluateAllQueries } from '../../../src/runtime/query/queryRuntime'

function colId(dataset: Dataset, name: string): string {
  const id = dataset.tables[0].columns.find((c) => c.name === name)?.id
  if (!id) throw new Error(`Column "${name}" not found in ${dataset.name}`)
  return id
}

describe('Power Query Foundations acceptance workflows (brief §64-68)', () => {
  const [salesJanDs, salesFebDs, productsDs, customersDirtyDs] = generatePowerQueryLabDataset()
  const datasets: Record<string, Dataset> = {
    [salesJanDs.id]: salesJanDs,
    [salesFebDs.id]: salesFebDs,
    [productsDs.id]: productsDs,
    [customersDirtyDs.id]: customersDirtyDs,
  }

  it('Acceptance Query 1 — Clean Customers', () => {
    let query = createQueryDefinition('Customers Clean', { kind: 'dataset-table', datasetId: customersDirtyDs.id, tableId: customersDirtyDs.tables[0].id })
    query = addQueryStep(query, { kind: 'rename-columns', renames: [{ columnId: colId(customersDirtyDs, 'customer_id'), newName: 'CustomerID' }] })
    query = addQueryStep(query, { kind: 'change-type', changes: [{ columnId: colId(customersDirtyDs, 'customer_id'), dataType: 'integer' }] })
    query = addQueryStep(query, { kind: 'replace-values', replacements: [{ columnId: colId(customersDirtyDs, 'Country'), find: 'ES ', replace: 'ES' }] })
    query = addQueryStep(query, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: colId(customersDirtyDs, 'customer_id'), operator: 'is-not-blank' }] })
    query = addQueryStep(query, { kind: 'remove-duplicates', columnIds: [colId(customersDirtyDs, 'customer_id')] })
    query = addQueryStep(query, { kind: 'remove-columns', columnIds: [colId(customersDirtyDs, 'LegacyNotes')] })

    const result = evaluateAllQueries({ [query.id]: query }, datasets)[query.id]
    expect(result.status).toBe('success')

    const rawRows = customersDirtyDs.tables[0].rows
    const nonBlank = rawRows.filter((r) => r.customer_id !== null)
    const expectedUniqueCount = new Set(nonBlank.map((r) => r.customer_id)).size

    expect(result.output?.tables[0].rowCount).toBe(expectedUniqueCount)
    expect(result.output?.tables[0].columns.map((c) => c.name)).toEqual(['CustomerID', 'CustomerName', 'Country'])
    expect(result.output?.tables[0].rows.every((r) => typeof r.CustomerID === 'number')).toBe(true)
    expect(result.output?.tables[0].rows.every((r) => r.Country !== 'ES ')).toBe(true)
  })

  it('Acceptance Query 2 — Append Sales', () => {
    let jan = createQueryDefinition('Sales Jan Q', { kind: 'dataset-table', datasetId: salesJanDs.id, tableId: salesJanDs.tables[0].id })
    let feb = createQueryDefinition('Sales Feb Q', { kind: 'dataset-table', datasetId: salesFebDs.id, tableId: salesFebDs.tables[0].id })

    const queries = { [jan.id]: jan, [feb.id]: feb }
    let combined = createQueryDefinition('Sales Combined', { kind: 'query', queryId: jan.id })
    const columnNames = [...new Set([...salesJanDs.tables[0].columns.map((c) => c.name), ...salesFebDs.tables[0].columns.map((c) => c.name)])]
    combined = addQueryStep(combined, { kind: 'append-queries', sources: [{ kind: 'query', queryId: feb.id }], columnNames })

    const allQueries = { ...queries, [combined.id]: combined }
    const results = evaluateAllQueries(allQueries, datasets)
    const output = results[combined.id]

    expect(output.status).toBe('success')
    expect(output.output?.tables[0].rowCount).toBe(salesJanDs.tables[0].rowCount + salesFebDs.tables[0].rowCount)
    expect(output.output?.tables[0].columns.map((c) => c.name).sort()).toEqual(['CustomerID', 'Date', 'OrderID', 'Promotion', 'ProductID', 'Quantity', 'Revenue'].sort())

    // January rows get a null Promotion; February rows keep their real value.
    const janRowCount = salesJanDs.tables[0].rowCount
    const rows = output.output!.tables[0].rows
    expect(rows.slice(0, janRowCount).every((r) => r.Promotion === null)).toBe(true)
    expect(rows.slice(janRowCount).some((r) => r.Promotion !== null)).toBe(true)
  })

  it('Acceptance Query 3 — Merge Products', () => {
    let sales = createQueryDefinition('Sales Q', { kind: 'dataset-table', datasetId: salesJanDs.id, tableId: salesJanDs.tables[0].id })
    let products = createQueryDefinition('Products Q', { kind: 'dataset-table', datasetId: productsDs.id, tableId: productsDs.tables[0].id })
    sales = addQueryStep(sales, {
      kind: 'merge-queries',
      right: { kind: 'query', queryId: products.id },
      joinKind: 'left-outer',
      leftKeys: [colId(salesJanDs, 'ProductID')],
      rightKeys: [colId(productsDs, 'ProductID')],
      expand: [
        { rightColumnId: colId(productsDs, 'ProductName'), outputName: 'ProductName' },
        { rightColumnId: colId(productsDs, 'Category'), outputName: 'Category' },
        { rightColumnId: colId(productsDs, 'UnitPrice'), outputName: 'UnitPrice' },
      ],
    })

    const results = evaluateAllQueries({ [sales.id]: sales, [products.id]: products }, datasets)
    const output = results[sales.id]

    expect(output.status).toBe('success')
    expect(output.output?.tables[0].rowCount).toBe(salesJanDs.tables[0].rowCount)

    // Independently verify a joined value against the raw Products table.
    const productsByID = new Map(productsDs.tables[0].rows.map((r) => [r.ProductID, r]))
    for (const row of output.output!.tables[0].rows.slice(0, 20)) {
      const expected = productsByID.get(row.ProductID)
      expect(row.ProductName).toBe(expected?.ProductName)
      expect(row.Category).toBe(expected?.Category)
    }
  })

  it('Acceptance Query 4 — Group By Category', () => {
    let sales = createQueryDefinition('Sales Q', { kind: 'dataset-table', datasetId: salesJanDs.id, tableId: salesJanDs.tables[0].id })
    let products = createQueryDefinition('Products Q', { kind: 'dataset-table', datasetId: productsDs.id, tableId: productsDs.tables[0].id })
    sales = addQueryStep(sales, {
      kind: 'merge-queries',
      right: { kind: 'query', queryId: products.id },
      joinKind: 'left-outer',
      leftKeys: [colId(salesJanDs, 'ProductID')],
      rightKeys: [colId(productsDs, 'ProductID')],
      expand: [{ rightColumnId: colId(productsDs, 'Category'), outputName: 'Category' }],
    })

    const merged = evaluateAllQueries({ [sales.id]: sales, [products.id]: products }, datasets)[sales.id]
    const categoryColumnId = merged.output!.tables[0].columns.find((c) => c.name === 'Category')!.id
    const revenueColumnId = merged.output!.tables[0].columns.find((c) => c.name === 'Revenue')!.id

    let groupedQuery = createQueryDefinition('Sales By Category', { kind: 'query', queryId: sales.id })
    groupedQuery = addQueryStep(groupedQuery, {
      kind: 'group-by',
      groupColumnIds: [categoryColumnId],
      aggregations: [
        { outputName: 'Orders', function: 'count-rows' },
        { outputName: 'TotalRevenue', function: 'sum', sourceColumnId: revenueColumnId },
        { outputName: 'AverageRevenue', function: 'average', sourceColumnId: revenueColumnId },
      ],
    })

    const allQueries = { [sales.id]: sales, [products.id]: products, [groupedQuery.id]: groupedQuery }
    const results = evaluateAllQueries(allQueries, datasets)
    const grouped = results[groupedQuery.id]
    expect(grouped.status).toBe('success')

    // Independently compute expected totals straight from the raw source, bypassing the Query Runtime entirely.
    const productsByID = new Map(productsDs.tables[0].rows.map((r) => [r.ProductID, r]))
    const byCategory = new Map<string, { count: number; total: number }>()
    for (const row of salesJanDs.tables[0].rows) {
      const category = productsByID.get(row.ProductID)?.Category as string
      const entry = byCategory.get(category) ?? { count: 0, total: 0 }
      entry.count += 1
      entry.total += row.Revenue as number
      byCategory.set(category, entry)
    }

    for (const row of grouped.output!.tables[0].rows) {
      const expected = byCategory.get(row.Category as string)!
      expect(row.Orders).toBe(expected.count)
      expect(row.TotalRevenue).toBeCloseTo(expected.total, 5)
    }
  })
})
