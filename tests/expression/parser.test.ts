import { describe, expect, it } from 'vitest'
import { parseExpression } from '../../src/expression/parser'
import type { BinaryExpressionNode, ColumnReferenceNode, FunctionCallNode } from '../../src/expression/ast'

describe('parseExpression', () => {
  it('parses a number literal', () => {
    const result = parseExpression('42')
    expect(result.diagnostics).toEqual([])
    expect(result.expression).toMatchObject({ kind: 'NumberLiteral', value: 42 })
  })

  it('parses a decimal number literal', () => {
    const result = parseExpression('3.5')
    expect(result.expression).toMatchObject({ kind: 'NumberLiteral', value: 3.5 })
  })

  it('parses a string literal', () => {
    const result = parseExpression('"Spain"')
    expect(result.expression).toMatchObject({ kind: 'StringLiteral', value: 'Spain' })
  })

  it('parses boolean literals', () => {
    expect(parseExpression('TRUE').expression).toMatchObject({ kind: 'BooleanLiteral', value: true })
    expect(parseExpression('false').expression).toMatchObject({ kind: 'BooleanLiteral', value: false })
  })

  it('parses a table[column] reference', () => {
    const result = parseExpression('Sales[Revenue]')
    expect(result.diagnostics).toEqual([])
    const node = result.expression as ColumnReferenceNode
    expect(node.kind).toBe('ColumnReference')
    expect(node.table).toBe('Sales')
    expect(node.column).toBe('Revenue')
  })

  it('parses the current-table shorthand [Column]', () => {
    const result = parseExpression('[Revenue]')
    const node = result.expression as ColumnReferenceNode
    expect(node.table).toBeNull()
    expect(node.column).toBe('Revenue')
  })

  it('supports column names with spaces inside brackets', () => {
    const result = parseExpression('Products[Unit Cost]')
    const node = result.expression as ColumnReferenceNode
    expect(node.column).toBe('Unit Cost')
  })

  it('respects operator precedence: multiplication before addition', () => {
    const result = parseExpression('1 + 2 * 3')
    const node = result.expression as BinaryExpressionNode
    expect(node.operator).toBe('+')
    expect(node.left).toMatchObject({ kind: 'NumberLiteral', value: 1 })
    expect(node.right).toMatchObject({ kind: 'BinaryExpression', operator: '*' })
  })

  it('respects parentheses over default precedence', () => {
    const result = parseExpression('(1 + 2) * 3')
    const node = result.expression as BinaryExpressionNode
    expect(node.operator).toBe('*')
    expect(node.left).toMatchObject({ kind: 'BinaryExpression', operator: '+' })
  })

  it('parses unary minus', () => {
    const result = parseExpression('-Sales[Cost]')
    expect(result.expression).toMatchObject({ kind: 'UnaryExpression', operator: '-' })
  })

  it('parses nested unary minus', () => {
    const result = parseExpression('--5')
    expect(result.expression).toMatchObject({
      kind: 'UnaryExpression',
      operator: '-',
      operand: { kind: 'UnaryExpression', operator: '-' },
    })
  })

  it('parses left-to-right for same-precedence operators', () => {
    const result = parseExpression('10 - 2 - 3')
    const node = result.expression as BinaryExpressionNode
    expect(node.operator).toBe('-')
    expect(node.left).toMatchObject({ kind: 'BinaryExpression', operator: '-' })
    expect(node.right).toMatchObject({ kind: 'NumberLiteral', value: 3 })
  })

  it('parses a margin expression end to end', () => {
    const result = parseExpression('Sales[Revenue] - Sales[Cost]')
    expect(result.diagnostics).toEqual([])
    const node = result.expression as BinaryExpressionNode
    expect(node.operator).toBe('-')
    expect((node.left as ColumnReferenceNode).column).toBe('Revenue')
    expect((node.right as ColumnReferenceNode).column).toBe('Cost')
  })

  it('parses a margin % expression with parentheses and division', () => {
    const result = parseExpression('(Sales[Revenue] - Sales[Cost]) / Sales[Revenue]')
    const node = result.expression as BinaryExpressionNode
    expect(node.operator).toBe('/')
    expect(node.left).toMatchObject({ kind: 'BinaryExpression', operator: '-' })
  })

  it('parses RELATED as a function call with one column-reference argument', () => {
    const result = parseExpression('RELATED(Products[UnitCost])')
    const node = result.expression as FunctionCallNode
    expect(node.kind).toBe('FunctionCall')
    expect(node.name).toBe('RELATED')
    expect(node.args).toHaveLength(1)
    expect(node.args[0]).toMatchObject({ kind: 'ColumnReference', table: 'Products', column: 'UnitCost' })
  })

  it('records a source span for the whole expression', () => {
    const result = parseExpression('Sales[Revenue] - Sales[Cost]')
    expect(result.expression?.span).toEqual({ start: 0, end: 28 })
  })

  it('records a source span for an unknown-column diagnostic target', () => {
    const result = parseExpression('Sales[Revenu]')
    const node = result.expression as ColumnReferenceNode
    expect(node.columnSpan).toEqual({ start: 5, end: 13 })
  })

  it('rejects an empty expression', () => {
    const result = parseExpression('')
    expect(result.expression).toBeUndefined()
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'SYNTAX_ERROR' })])
  })

  it('rejects invalid syntax: dangling operator', () => {
    const result = parseExpression('Sales[Revenue] -')
    expect(result.expression).toBeUndefined()
    expect(result.diagnostics).toEqual([expect.objectContaining({ severity: 'error', code: 'SYNTAX_ERROR' })])
  })

  it('rejects invalid syntax: unbalanced parentheses', () => {
    const result = parseExpression('(1 + 2')
    expect(result.expression).toBeUndefined()
    expect(result.diagnostics[0].code).toBe('SYNTAX_ERROR')
  })

  it('rejects invalid syntax: unterminated column reference', () => {
    const result = parseExpression('Sales[Revenue')
    expect(result.expression).toBeUndefined()
    expect(result.diagnostics[0].code).toBe('SYNTAX_ERROR')
  })

  it('rejects trailing garbage after a valid expression', () => {
    const result = parseExpression('1 + 1 2')
    expect(result.expression).toBeUndefined()
    expect(result.diagnostics[0].code).toBe('SYNTAX_ERROR')
  })
})
