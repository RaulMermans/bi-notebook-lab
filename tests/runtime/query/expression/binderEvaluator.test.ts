import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../../src/domain/data'
import { bindExpression } from '../../../../src/runtime/query/expression/binder'
import { ExpressionEvalError } from '../../../../src/runtime/query/expression/evalError'
import { evaluateBoundExpression } from '../../../../src/runtime/query/expression/evaluator'
import { parseExpression } from '../../../../src/runtime/query/expression/parser'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string'): DataColumn {
  return { id, name, dataType, nullable: true }
}

function evaluate(source: string, columns: DataColumn[], row: Record<string, unknown>): unknown {
  const { bound, diagnostics } = bindExpression(parseExpression(source), columns, 'step1')
  if (!bound) throw new Error(`bind failed: ${diagnostics.map((d) => d.message).join('; ')}`)
  return evaluateBoundExpression(bound, row)
}

describe('binder', () => {
  it('resolves a column reference to its DataColumn.id', () => {
    const { bound, diagnostics } = bindExpression(parseExpression('[Revenue]'), [col('c1', 'Revenue')], 'step1')
    expect(diagnostics).toEqual([])
    expect(bound).toEqual({ kind: 'column', name: 'Revenue', columnId: 'c1' })
  })

  it('resolves column references case-insensitively', () => {
    const { bound } = bindExpression(parseExpression('[revenue]'), [col('c1', 'Revenue')], 'step1')
    expect(bound).toMatchObject({ columnId: 'c1' })
  })

  it('reports an unresolved column reference', () => {
    const { bound, diagnostics } = bindExpression(parseExpression('[Nope]'), [col('c1', 'Revenue')], 'step1')
    expect(bound).toBeUndefined()
    expect(diagnostics[0].code).toBe('QUERY_CUSTOM_COLUMN_NOT_FOUND')
  })

  it('rejects an unsupported function name', () => {
    const { diagnostics } = bindExpression(parseExpression('Table.AddColumn([A])'), [col('c1', 'A')], 'step1')
    expect(diagnostics[0].code).toBe('QUERY_CUSTOM_PARSE_ERROR')
  })

  it('rejects a wrong argument count', () => {
    const { diagnostics } = bindExpression(parseExpression('Text.Trim([A], [A])'), [col('c1', 'A')], 'step1')
    expect(diagnostics[0].code).toBe('QUERY_CUSTOM_PARSE_ERROR')
  })
})

describe('evaluator', () => {
  it('evaluates arithmetic', () => {
    expect(evaluate('[A] * [B]', [col('c1', 'A', 'integer'), col('c2', 'B', 'integer')], { A: 4, B: 5 })).toBe(20)
  })

  it('evaluates comparisons', () => {
    expect(evaluate('[A] >= 10', [col('c1', 'A', 'integer')], { A: 12 })).toBe(true)
    expect(evaluate('[A] <> 10', [col('c1', 'A', 'integer')], { A: 10 })).toBe(false)
  })

  it('evaluates text concatenation with null coerced to empty text', () => {
    expect(evaluate('[A] & [B]', [col('c1', 'A'), col('c2', 'B')], { A: null, B: 'x' })).toBe('x')
  })

  it('evaluates if/then/else', () => {
    const expr = 'if [A] >= 1000 then "High" else "Standard"'
    expect(evaluate(expr, [col('c1', 'A', 'integer')], { A: 1500 })).toBe('High')
    expect(evaluate(expr, [col('c1', 'A', 'integer')], { A: 100 })).toBe('Standard')
  })

  it('evaluates every supported function', () => {
    const cols = [col('c1', 'Text'), col('c2', 'Num', 'decimal'), col('c3', 'D', 'date')]
    expect(evaluate('Text.Trim([Text])', cols, { Text: '  x  ' })).toBe('x')
    expect(evaluate('Text.Upper([Text])', cols, { Text: 'x' })).toBe('X')
    expect(evaluate('Text.Lower([Text])', cols, { Text: 'X' })).toBe('x')
    expect(evaluate('Text.Length([Text])', cols, { Text: 'abcd' })).toBe(4)
    expect(evaluate('Number.Abs([Num])', cols, { Num: -5.5 })).toBe(5.5)
    expect(evaluate('Number.Round([Num])', cols, { Num: 5.6 })).toBe(6)
    expect(evaluate('Number.Round([Num], 1)', cols, { Num: 5.66 })).toBe(5.7)
    expect(evaluate('Date.Year([D])', cols, { D: '2024-03-15' })).toBe(2024)
    expect(evaluate('Date.Month([D])', cols, { D: '2024-03-15' })).toBe(3)
    expect(evaluate('Date.Day([D])', cols, { D: '2024-03-15' })).toBe(15)
  })

  it('throws a typed error on divide by zero', () => {
    expect(() => evaluate('[A] / [B]', [col('c1', 'A', 'integer'), col('c2', 'B', 'integer')], { A: 1, B: 0 })).toThrowError(ExpressionEvalError)
    try {
      evaluate('[A] / [B]', [col('c1', 'A', 'integer'), col('c2', 'B', 'integer')], { A: 1, B: 0 })
    } catch (err) {
      expect((err as ExpressionEvalError).code).toBe('QUERY_CUSTOM_DIVIDE_BY_ZERO')
    }
  })

  it('throws a typed error on arithmetic over non-numeric values', () => {
    try {
      evaluate('[A] + 1', [col('c1', 'A', 'string')], { A: 'x' })
      throw new Error('expected to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ExpressionEvalError)
      expect((err as ExpressionEvalError).code).toBe('QUERY_CUSTOM_TYPE_ERROR')
    }
  })

  it('null propagates as null through a column reference with no value', () => {
    expect(evaluate('[A]', [col('c1', 'A')], {})).toBeNull()
  })
})
