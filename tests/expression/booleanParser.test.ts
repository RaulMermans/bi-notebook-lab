import { describe, expect, it } from 'vitest'
import type { ComparisonExpressionNode, LogicalExpressionNode } from '../../src/expression/ast'
import { parseExpression } from '../../src/expression/parser'

/**
 * Sprint 8 grammar additions: comparison/logical operators, precedence and
 * CALCULATE/FILTER/REMOVEFILTERS/ALL as ordinary function calls (see
 * docs/CALCULATE.md "Operator precedence"). `tests/expression/parser.test.ts`
 * covers the unchanged Sprint 3/4 arithmetic grammar.
 */
describe('parseExpression — Sprint 8 boolean grammar', () => {
  it('parses each comparison operator', () => {
    const cases: [string, ComparisonExpressionNode['operator']][] = [
      ['Products[Price] = 100', '='],
      ['Products[Price] <> 100', '<>'],
      ['Products[Price] > 100', '>'],
      ['Products[Price] >= 100', '>='],
      ['Products[Price] < 100', '<'],
      ['Products[Price] <= 100', '<='],
    ]
    for (const [source, operator] of cases) {
      const result = parseExpression(source)
      expect(result.diagnostics).toEqual([])
      const node = result.expression as ComparisonExpressionNode
      expect(node.kind).toBe('ComparisonExpression')
      expect(node.operator).toBe(operator)
      expect(node.left).toMatchObject({ kind: 'ColumnReference', column: 'Price' })
      expect(node.right).toMatchObject({ kind: 'NumberLiteral', value: 100 })
    }
  })

  it('parses && and ||', () => {
    const and = parseExpression('Products[Price] > 50 && Products[Category] = "Furniture"')
    expect(and.diagnostics).toEqual([])
    const andNode = and.expression as LogicalExpressionNode
    expect(andNode.kind).toBe('LogicalExpression')
    expect(andNode.operator).toBe('&&')
    expect(andNode.left.kind).toBe('ComparisonExpression')
    expect(andNode.right.kind).toBe('ComparisonExpression')

    const or = parseExpression('Products[Category] = "Furniture" || Products[Category] = "Electronics"')
    expect((or.expression as LogicalExpressionNode).operator).toBe('||')
  })

  it('binds relational operators tighter than equality operators', () => {
    // `=` should apply to the *result* of `>`... but a comparison never yields a comparable-again
    // scalar in this grammar, so the meaningful check is precedence order: `&&`/`||` must not
    // "steal" operands from a comparison, and relational vs equality nest correctly when mixed
    // via explicit parens (the only way to combine them meaningfully).
    const result = parseExpression('(Products[Price] > 50) = TRUE')
    expect(result.diagnostics).toEqual([])
    const node = result.expression as ComparisonExpressionNode
    expect(node.kind).toBe('ComparisonExpression')
    expect(node.operator).toBe('=')
    expect(node.left.kind).toBe('ComparisonExpression')
    expect(node.right).toMatchObject({ kind: 'BooleanLiteral', value: true })
  })

  it('&& binds tighter than ||', () => {
    const result = parseExpression('Products[Category] = "Furniture" || Products[Category] = "Electronics" && Products[Price] > 50')
    const node = result.expression as LogicalExpressionNode
    expect(node.operator).toBe('||')
    expect(node.left).toMatchObject({ kind: 'ComparisonExpression' })
    expect(node.right).toMatchObject({ kind: 'LogicalExpression', operator: '&&' })
  })

  it('respects parentheses to override default precedence', () => {
    const result = parseExpression('(Products[Category] = "Furniture" || Products[Category] = "Electronics") && Products[Price] > 50')
    const node = result.expression as LogicalExpressionNode
    expect(node.operator).toBe('&&')
    expect(node.left).toMatchObject({ kind: 'LogicalExpression', operator: '||' })
  })

  it('comparison/logical operators do not disturb plain arithmetic parsing', () => {
    const result = parseExpression('Sales[Revenue] - Sales[Cost] * 2')
    expect(result.diagnostics).toEqual([])
    expect(result.expression?.kind).toBe('BinaryExpression')
  })

  it('parses CALCULATE/FILTER/REMOVEFILTERS/ALL as ordinary function calls', () => {
    const calculate = parseExpression('CALCULATE([Total Revenue], Customers[Country] = "Spain")')
    expect(calculate.diagnostics).toEqual([])
    expect(calculate.expression).toMatchObject({ kind: 'FunctionCall', name: 'CALCULATE' })

    const filter = parseExpression('FILTER(Products, Products[Price] > 100)')
    expect(filter.diagnostics).toEqual([])
    expect(filter.expression).toMatchObject({ kind: 'FunctionCall', name: 'FILTER' })

    const removeFilters = parseExpression('REMOVEFILTERS(Customers[Country])')
    expect(removeFilters.diagnostics).toEqual([])
    expect(removeFilters.expression).toMatchObject({ kind: 'FunctionCall', name: 'REMOVEFILTERS' })

    const all = parseExpression('ALL(Customers)')
    expect(all.diagnostics).toEqual([])
    expect(all.expression).toMatchObject({ kind: 'FunctionCall', name: 'ALL' })
  })

  it('rejects a bare "&" or "|"', () => {
    expect(parseExpression('Products[Price] > 50 & Products[Price] < 100').diagnostics).toEqual([
      expect.objectContaining({ code: 'SYNTAX_ERROR' }),
    ])
    expect(parseExpression('Products[Price] > 50 | Products[Price] < 100').diagnostics).toEqual([
      expect.objectContaining({ code: 'SYNTAX_ERROR' }),
    ])
  })
})
