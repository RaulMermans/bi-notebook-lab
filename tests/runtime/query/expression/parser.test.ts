import { describe, expect, it } from 'vitest'
import { ExpressionParseError, parseExpression } from '../../../../src/runtime/query/expression/parser'

describe('expression parser', () => {
  it('parses arithmetic with standard precedence', () => {
    const ast = parseExpression('1 + 2 * 3')
    expect(ast).toEqual({
      kind: 'binary',
      operator: '+',
      left: { kind: 'literal', value: 1 },
      right: { kind: 'binary', operator: '*', left: { kind: 'literal', value: 2 }, right: { kind: 'literal', value: 3 } },
    })
  })

  it('parses a column reference', () => {
    expect(parseExpression('[Revenue]')).toEqual({ kind: 'column', name: 'Revenue' })
  })

  it('parses if/then/else', () => {
    const ast = parseExpression('if [A] = 1 then "x" else "y"')
    expect(ast).toMatchObject({ kind: 'conditional', whenTrue: { kind: 'literal', value: 'x' }, whenFalse: { kind: 'literal', value: 'y' } })
  })

  it('parses a nested else-if chain', () => {
    const ast = parseExpression('if [A] >= 1000 then "High" else if [A] >= 500 then "Medium" else "Low"')
    expect(ast).toMatchObject({ kind: 'conditional', whenFalse: { kind: 'conditional' } })
  })

  it('parses a dotted function call with multiple arguments', () => {
    expect(parseExpression('Number.Round([A], 2)')).toEqual({
      kind: 'call',
      functionName: 'Number.Round',
      args: [{ kind: 'column', name: 'A' }, { kind: 'literal', value: 2 }],
    })
  })

  it('parses unary minus', () => {
    expect(parseExpression('-[A]')).toEqual({ kind: 'unary-minus', operand: { kind: 'column', name: 'A' } })
  })

  it('parses text concatenation', () => {
    expect(parseExpression('[A] & [B]')).toEqual({ kind: 'binary', operator: '&', left: { kind: 'column', name: 'A' }, right: { kind: 'column', name: 'B' } })
  })

  it('respects parentheses', () => {
    const ast = parseExpression('(1 + 2) * 3')
    expect(ast).toEqual({
      kind: 'binary',
      operator: '*',
      left: { kind: 'binary', operator: '+', left: { kind: 'literal', value: 1 }, right: { kind: 'literal', value: 2 } },
      right: { kind: 'literal', value: 3 },
    })
  })

  it('throws on trailing garbage', () => {
    expect(() => parseExpression('1 + 2 3')).toThrow(ExpressionParseError)
  })

  it('throws on an incomplete if/then/else', () => {
    expect(() => parseExpression('if [A] = 1 then "x"')).toThrow(ExpressionParseError)
  })

  it('throws on an unclosed function call', () => {
    expect(() => parseExpression('Text.Trim([A]')).toThrow(ExpressionParseError)
  })

  it('throws on a bare identifier used as a value (not a function call)', () => {
    expect(() => parseExpression('foo')).toThrow(ExpressionParseError)
  })
})
