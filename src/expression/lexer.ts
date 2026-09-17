import type { SourceSpan } from './ast'

export type TokenType =
  | 'number'
  | 'string'
  | 'identifier'
  | 'bracket' // raw content of a [Column Name] segment
  | '('
  | ')'
  | ','
  | '+'
  | '-'
  | '*'
  | '/'
  | 'eof'

export interface Token {
  type: TokenType
  /** Raw text for identifier/number tokens; decoded content for string/bracket tokens. */
  text: string
  span: SourceSpan
}

export class LexError extends Error {
  constructor(
    message: string,
    readonly span: SourceSpan,
  ) {
    super(message)
    this.name = 'LexError'
  }
}

const IDENTIFIER_START = /[A-Za-z_]/
const IDENTIFIER_PART = /[A-Za-z0-9_]/
const DIGIT = /[0-9]/

/**
 * Hand-written tokenizer for the Sprint 3 DAX subset. `[Column Name]`
 * segments are read as one token so column names may contain spaces, the
 * way real DAX bracket syntax works.
 */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const n = source.length

  function isDigit(ch: string): boolean {
    return DIGIT.test(ch)
  }

  while (i < n) {
    const ch = source[i]

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }

    if (ch === '(' || ch === ')' || ch === ',' || ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: ch as TokenType, text: ch, span: { start: i, end: i + 1 } })
      i += 1
      continue
    }

    if (ch === '[') {
      const start = i
      i += 1
      let content = ''
      while (i < n && source[i] !== ']') {
        content += source[i]
        i += 1
      }
      if (i >= n) {
        throw new LexError('Unterminated column reference: missing closing "]".', { start, end: n })
      }
      i += 1 // consume ']'
      tokens.push({ type: 'bracket', text: content.trim(), span: { start, end: i } })
      continue
    }

    if (ch === '"' || ch === "'") {
      const quote = ch
      const start = i
      i += 1
      let value = ''
      let closed = false
      while (i < n) {
        if (source[i] === quote) {
          if (source[i + 1] === quote) {
            value += quote
            i += 2
            continue
          }
          i += 1
          closed = true
          break
        }
        value += source[i]
        i += 1
      }
      if (!closed) {
        throw new LexError('Unterminated string literal: missing closing quote.', { start, end: n })
      }
      tokens.push({ type: 'string', text: value, span: { start, end: i } })
      continue
    }

    if (isDigit(ch)) {
      const start = i
      while (i < n && isDigit(source[i])) i += 1
      if (source[i] === '.' && isDigit(source[i + 1])) {
        i += 1
        while (i < n && isDigit(source[i])) i += 1
      }
      tokens.push({ type: 'number', text: source.slice(start, i), span: { start, end: i } })
      continue
    }

    if (IDENTIFIER_START.test(ch)) {
      const start = i
      while (i < n && IDENTIFIER_PART.test(source[i])) i += 1
      tokens.push({ type: 'identifier', text: source.slice(start, i), span: { start, end: i } })
      continue
    }

    throw new LexError(`Unexpected character "${ch}".`, { start: i, end: i + 1 })
  }

  tokens.push({ type: 'eof', text: '', span: { start: n, end: n } })
  return tokens
}
