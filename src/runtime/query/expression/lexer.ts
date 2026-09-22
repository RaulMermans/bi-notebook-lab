export type TokenType =
  | 'number'
  | 'string'
  | 'column'
  | 'identifier'
  | 'keyword'
  | 'operator'
  | 'dot'
  | 'lparen'
  | 'rparen'
  | 'comma'
  | 'eof'

export interface Token {
  type: TokenType
  value: string
  position: number
}

export class ExpressionLexError extends Error {
  constructor(
    message: string,
    public position: number,
  ) {
    super(message)
  }
}

const KEYWORDS = new Set(['if', 'then', 'else', 'true', 'false', 'null'])
const MULTI_CHAR_OPERATORS = ['<>', '>=', '<=']
const SINGLE_CHAR_OPERATORS = new Set(['+', '-', '*', '/', '&', '=', '>', '<'])

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch)
}

function isIdentPart(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch)
}

/** Tokenizes a Custom Column source string. Throws `ExpressionLexError` on the first invalid character — the caller (binder/step evaluator) turns this into a `QUERY_CUSTOM_PARSE_ERROR` diagnostic. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < source.length) {
    const ch = source[i]

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1
      continue
    }

    if (ch === '[') {
      const start = i
      const end = source.indexOf(']', i + 1)
      if (end === -1) throw new ExpressionLexError('Unterminated column reference — missing "]".', start)
      const name = source.slice(i + 1, end).trim()
      if (name === '') throw new ExpressionLexError('Empty column reference "[]".', start)
      tokens.push({ type: 'column', value: name, position: start })
      i = end + 1
      continue
    }

    if (ch === '"') {
      const start = i
      let j = i + 1
      let value = ''
      while (j < source.length && source[j] !== '"') {
        if (source[j] === '\\' && j + 1 < source.length) {
          value += source[j + 1]
          j += 2
        } else {
          value += source[j]
          j += 1
        }
      }
      if (j >= source.length) throw new ExpressionLexError('Unterminated string literal — missing closing quote.', start)
      tokens.push({ type: 'string', value, position: start })
      i = j + 1
      continue
    }

    if (isDigit(ch) || (ch === '.' && isDigit(source[i + 1] ?? ''))) {
      const start = i
      let j = i
      while (j < source.length && isDigit(source[j])) j += 1
      if (source[j] === '.' && isDigit(source[j + 1] ?? '')) {
        j += 1
        while (j < source.length && isDigit(source[j])) j += 1
      }
      tokens.push({ type: 'number', value: source.slice(start, j), position: start })
      i = j
      continue
    }

    if (isIdentStart(ch)) {
      const start = i
      let j = i
      while (j < source.length && isIdentPart(source[j])) j += 1
      const word = source.slice(start, j)
      tokens.push({ type: KEYWORDS.has(word.toLowerCase()) ? 'keyword' : 'identifier', value: word, position: start })
      i = j
      continue
    }

    const twoChar = source.slice(i, i + 2)
    if (MULTI_CHAR_OPERATORS.includes(twoChar)) {
      tokens.push({ type: 'operator', value: twoChar, position: i })
      i += 2
      continue
    }

    if (SINGLE_CHAR_OPERATORS.has(ch)) {
      tokens.push({ type: 'operator', value: ch, position: i })
      i += 1
      continue
    }

    if (ch === '.') {
      tokens.push({ type: 'dot', value: '.', position: i })
      i += 1
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(', position: i })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')', position: i })
      i += 1
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'comma', value: ',', position: i })
      i += 1
      continue
    }

    throw new ExpressionLexError(`Unexpected character "${ch}".`, i)
  }

  tokens.push({ type: 'eof', value: '', position: source.length })
  return tokens
}
