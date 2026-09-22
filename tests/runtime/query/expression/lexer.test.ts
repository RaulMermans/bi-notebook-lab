import { describe, expect, it } from 'vitest'
import { ExpressionLexError, tokenize } from '../../../../src/runtime/query/expression/lexer'

describe('expression lexer', () => {
  it('tokenizes numbers, strings, column refs, keywords and operators', () => {
    const tokens = tokenize('if [Revenue] >= 1000 then "High" else "Low"')
    expect(tokens.map((t) => t.type)).toEqual([
      'keyword', 'column', 'operator', 'number', 'keyword', 'string', 'keyword', 'string', 'eof',
    ])
  })

  it('tokenizes a dotted function call', () => {
    const tokens = tokenize('Text.Trim([Name])')
    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ['identifier', 'Text'],
      ['dot', '.'],
      ['identifier', 'Trim'],
      ['lparen', '('],
      ['column', 'Name'],
      ['rparen', ')'],
      ['eof', ''],
    ])
  })

  it('trims whitespace inside a column reference', () => {
    expect(tokenize('[  Unit Price  ]')[0]).toMatchObject({ type: 'column', value: 'Unit Price' })
  })

  it('supports decimal numbers and negative numbers via unary minus (lexed as separate tokens)', () => {
    const tokens = tokenize('1.5 - 2')
    expect(tokens.map((t) => t.value)).toEqual(['1.5', '-', '2', ''])
  })

  it('throws on an unterminated column reference', () => {
    expect(() => tokenize('[Revenue')).toThrow(ExpressionLexError)
  })

  it('throws on an unterminated string', () => {
    expect(() => tokenize('"abc')).toThrow(ExpressionLexError)
  })

  it('throws on an unexpected character', () => {
    expect(() => tokenize('[A] % 2')).toThrow(ExpressionLexError)
  })
})
