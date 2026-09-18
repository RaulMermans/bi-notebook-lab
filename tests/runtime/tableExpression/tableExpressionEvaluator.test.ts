import { describe, expect, it } from 'vitest'
import { parseExpression } from '../../../src/expression/parser'
import { resolveFilterContext } from '../../../src/runtime/measure/filterPropagation'
import { bindTableExpression } from '../../../src/runtime/tableExpression/tableExpressionBinder'
import { evaluateTableExpression } from '../../../src/runtime/tableExpression/tableExpressionEvaluator'
import { buildIteratorFixture } from '../measure/iteratorFixture'

function bindAndEvaluate(
  fixture: ReturnType<typeof buildIteratorFixture>,
  source: string,
  filters: { column: { datasetId: string; tableId: string; columnId: string }; operator: 'equals' | 'in'; values: unknown[] }[] = [],
) {
  const parsed = parseExpression(source)
  if (!parsed.expression) throw new Error(`failed to parse: ${source}`)
  const bound = bindTableExpression(parsed.expression, { model: fixture.model, datasets: fixture.datasets })
  if (!bound.bound) throw new Error(`failed to bind: ${source}: ${JSON.stringify(bound.diagnostics)}`)
  const filterState = resolveFilterContext(fixture.model, fixture.datasets, { filters })
  return evaluateTableExpression(bound.bound, { model: fixture.model, datasets: fixture.datasets, filterState })
}

describe('tableExpressionEvaluator', () => {
  it('a base table returns every row when unfiltered', () => {
    const fixture = buildIteratorFixture()
    const result = bindAndEvaluate(fixture, 'Sales')
    expect(result.rows).toHaveLength(5)
    expect(result.rows.every((r) => r.kind === 'model-row')).toBe(true)
  })

  it('a base table respects the current FilterContext', () => {
    const fixture = buildIteratorFixture()
    const countryColumn = { datasetId: fixture.datasets['customers-ds'].id, tableId: 'customers-table', columnId: 'customer-country' }
    const result = bindAndEvaluate(fixture, 'Sales', [{ column: countryColumn, operator: 'equals', values: ['Spain'] }])
    // Spain customers are 1 and 3 -> Sales rows OrderID 1, 3, 4 (sprint brief §5: never the full unfiltered table).
    expect(result.rows).toHaveLength(3)
  })

  it('FILTER reduces rows by its predicate', () => {
    const fixture = buildIteratorFixture()
    const result = bindAndEvaluate(fixture, 'FILTER(Sales, Sales[Quantity] >= 5)')
    expect(result.rows).toHaveLength(2)
  })

  it('FILTER intersects with the incoming ambient FilterContext', () => {
    const fixture = buildIteratorFixture()
    const countryColumn = { datasetId: fixture.datasets['customers-ds'].id, tableId: 'customers-table', columnId: 'customer-country' }
    const result = bindAndEvaluate(fixture, 'FILTER(Sales, Sales[Quantity] >= 5)', [{ column: countryColumn, operator: 'equals', values: ['Spain'] }])
    // Only OrderID 3 (Spain, Quantity 6) qualifies once ambient Spain filter intersects with Quantity >= 5.
    expect(result.rows).toHaveLength(1)
  })

  it('nested FILTER composes', () => {
    const fixture = buildIteratorFixture()
    const result = bindAndEvaluate(fixture, 'FILTER(FILTER(Sales, Sales[Quantity] >= 5), Sales[Revenue] > 60)')
    expect(result.rows).toHaveLength(1) // only OrderID 5 (Quantity 8, Revenue 80)
  })

  it('VALUES deduplicates and respects the current context', () => {
    const fixture = buildIteratorFixture()
    const unfiltered = bindAndEvaluate(fixture, 'VALUES(Customers[Country])')
    expect(unfiltered.rows).toHaveLength(2) // Spain, France

    const countryColumn = { datasetId: fixture.datasets['customers-ds'].id, tableId: 'customers-table', columnId: 'customer-country' }
    const filtered = bindAndEvaluate(fixture, 'VALUES(Customers[Country])', [{ column: countryColumn, operator: 'equals', values: ['Spain'] }])
    expect(filtered.rows).toHaveLength(1)
    expect(filtered.rows[0]).toEqual(expect.objectContaining({ kind: 'value-row', value: 'Spain' }))
  })

  it('DISTINCT deduplicates', () => {
    const fixture = buildIteratorFixture()
    const result = bindAndEvaluate(fixture, 'DISTINCT(Products[Category])')
    expect(result.rows).toHaveLength(2)
  })

  it('retains a real blank value as its own distinct member', () => {
    const fixture = buildIteratorFixture()
    fixture.datasets['customers-ds'].tables[0].rows.push({ CustomerID: 4, Country: null })
    fixture.datasets['customers-ds'].tables[0].rowCount = 4
    const result = bindAndEvaluate(fixture, 'VALUES(Customers[Country])')
    expect(result.rows).toHaveLength(3)
    expect(result.rows.some((r) => r.kind === 'value-row' && r.value === null)).toBe(true)
  })
})
