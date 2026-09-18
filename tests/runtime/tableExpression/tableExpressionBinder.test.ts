import { describe, expect, it } from 'vitest'
import { parseExpression } from '../../../src/expression/parser'
import { bindTableExpression } from '../../../src/runtime/tableExpression/tableExpressionBinder'
import { buildIteratorFixture } from '../measure/iteratorFixture'

function bindTable(model: ReturnType<typeof buildIteratorFixture>['model'], datasets: ReturnType<typeof buildIteratorFixture>['datasets'], source: string) {
  const parsed = parseExpression(source)
  if (!parsed.expression) throw new Error(`failed to parse: ${source}`)
  return bindTableExpression(parsed.expression, { model, datasets })
}

describe('tableExpressionBinder', () => {
  it('binds a bare model table to BaseTable', () => {
    const { model, datasets, salesTableId } = buildIteratorFixture()
    const result = bindTable(model, datasets, 'Sales')
    expect(result.diagnostics).toEqual([])
    expect(result.bound).toEqual(expect.objectContaining({ kind: 'BaseTable', modelTableId: salesTableId, tableName: 'Sales' }))
  })

  it('binds FILTER(Table, predicate) to FilterTable', () => {
    const { model, datasets, salesTableId } = buildIteratorFixture()
    const result = bindTable(model, datasets, 'FILTER(Sales, Sales[Quantity] >= 5)')
    expect(result.diagnostics).toEqual([])
    expect(result.bound).toEqual(expect.objectContaining({ kind: 'FilterTable', modelTableId: salesTableId }))
  })

  it('binds nested FILTER(FILTER(Table, p1), p2)', () => {
    const { model, datasets } = buildIteratorFixture()
    const result = bindTable(model, datasets, 'FILTER(FILTER(Sales, Sales[Quantity] >= 5), Sales[Revenue] > 50)')
    expect(result.diagnostics).toEqual([])
    expect(result.bound?.kind).toBe('FilterTable')
    expect((result.bound as { input?: { kind?: string } })?.input?.kind).toBe('FilterTable')
  })

  it('binds VALUES(Table[Column]) to ValuesTable', () => {
    const { model, datasets, customersTableId } = buildIteratorFixture()
    const result = bindTable(model, datasets, 'VALUES(Customers[Country])')
    expect(result.diagnostics).toEqual([])
    expect(result.bound).toEqual(expect.objectContaining({ kind: 'ValuesTable', modelTableId: customersTableId, columnName: 'Country' }))
  })

  it('binds DISTINCT(Table[Column]) to DistinctTable', () => {
    const { model, datasets, productsTableId } = buildIteratorFixture()
    const result = bindTable(model, datasets, 'DISTINCT(Products[Category])')
    expect(result.diagnostics).toEqual([])
    expect(result.bound).toEqual(expect.objectContaining({ kind: 'DistinctTable', modelTableId: productsTableId, columnName: 'Category' }))
  })

  it('rejects an unknown table', () => {
    const { model, datasets } = buildIteratorFixture()
    const result = bindTable(model, datasets, 'Nope')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_TABLE' })])
  })

  it('rejects an unknown column in VALUES', () => {
    const { model, datasets } = buildIteratorFixture()
    const result = bindTable(model, datasets, 'VALUES(Customers[Nope])')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_COLUMN' })])
  })

  it('rejects VALUES(Table) — column-only in Sprint 9 scope', () => {
    const { model, datasets } = buildIteratorFixture()
    const result = bindTable(model, datasets, 'VALUES(Customers)')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_VALUES_ARGUMENT' })])
  })

  it('rejects DISTINCT(Table) — column-only in Sprint 9 scope', () => {
    const { model, datasets } = buildIteratorFixture()
    const result = bindTable(model, datasets, 'DISTINCT(Customers)')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_DISTINCT_ARGUMENT' })])
  })

  it('rejects FILTER(VALUES(...), predicate) as an unsupported table expression', () => {
    const { model, datasets } = buildIteratorFixture()
    const result = bindTable(model, datasets, 'FILTER(VALUES(Customers[Country]), Customers[Country] = "Spain")')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'ITERATOR_UNSUPPORTED_TABLE_EXPRESSION' })])
  })

  it('rejects a non-table expression', () => {
    const { model, datasets } = buildIteratorFixture()
    const result = bindTable(model, datasets, '1 + 2')
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_TABLE_EXPRESSION_ARGUMENT' })])
  })
})
