import type { BinaryOperator, ColumnReferenceNode, Expression, SourceSpan } from './ast'
import { diagnostic, type ExpressionDiagnostic } from './diagnostics'
import { LexError, tokenize, type Token, type TokenType } from './lexer'

export interface ParseResult {
  expression?: Expression
  diagnostics: ExpressionDiagnostic[]
}

class ParseError extends Error {
  constructor(
    message: string,
    readonly span: SourceSpan,
  ) {
    super(message)
  }
}

class Parser {
  private position = 0

  constructor(private readonly tokens: Token[]) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.position + offset, this.tokens.length - 1)]
  }

  private advance(): Token {
    const token = this.peek()
    if (token.type !== 'eof') this.position += 1
    return token
  }

  private expect(type: TokenType, description: string): Token {
    const token = this.peek()
    if (token.type !== type) {
      throw new ParseError(`Expected ${description} but found ${describeToken(token)}.`, token.span)
    }
    return this.advance()
  }

  parseProgram(): Expression {
    const expression = this.parseExpression()
    const trailing = this.peek()
    if (trailing.type !== 'eof') {
      throw new ParseError(`Unexpected ${describeToken(trailing)} after the end of the expression.`, trailing.span)
    }
    return expression
  }

  private parseExpression(): Expression {
    return this.parseAdditive()
  }

  private parseAdditive(): Expression {
    let left = this.parseMultiplicative()
    while (this.peek().type === '+' || this.peek().type === '-') {
      const operatorToken = this.advance()
      const right = this.parseMultiplicative()
      left = {
        kind: 'BinaryExpression',
        operator: operatorToken.type as BinaryOperator,
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      }
    }
    return left
  }

  private parseMultiplicative(): Expression {
    let left = this.parseUnary()
    while (this.peek().type === '*' || this.peek().type === '/') {
      const operatorToken = this.advance()
      const right = this.parseUnary()
      left = {
        kind: 'BinaryExpression',
        operator: operatorToken.type as BinaryOperator,
        left,
        right,
        span: { start: left.span.start, end: right.span.end },
      }
    }
    return left
  }

  private parseUnary(): Expression {
    if (this.peek().type === '-') {
      const operatorToken = this.advance()
      const operand = this.parseUnary()
      return { kind: 'UnaryExpression', operator: '-', operand, span: { start: operatorToken.span.start, end: operand.span.end } }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): Expression {
    const token = this.peek()

    if (token.type === 'number') {
      this.advance()
      return { kind: 'NumberLiteral', value: Number(token.text), span: token.span }
    }

    if (token.type === 'string') {
      this.advance()
      return { kind: 'StringLiteral', value: token.text, span: token.span }
    }

    if (token.type === '(') {
      this.advance()
      const inner = this.parseExpression()
      const close = this.expect(')', '")"')
      return { ...inner, span: { start: token.span.start, end: close.span.end } }
    }

    if (token.type === 'bracket') {
      this.advance()
      return this.columnReference(null, undefined, token)
    }

    if (token.type === 'identifier') {
      const upper = token.text.toUpperCase()
      if (upper === 'TRUE' || upper === 'FALSE') {
        // Only treat TRUE/FALSE as boolean literals when not used as a table name (Table[Col] still wins).
        if (this.peek(1).type !== 'bracket') {
          this.advance()
          return { kind: 'BooleanLiteral', value: upper === 'TRUE', span: token.span }
        }
      }

      this.advance()
      if (this.peek().type === 'bracket') {
        const bracketToken = this.advance()
        return this.columnReference(token.text, token.span, bracketToken)
      }
      if (this.peek().type === '(') {
        return this.functionCall(token)
      }
      // A bare table name (e.g. `Sales` in `COUNTROWS(Sales)`). Whether this
      // is valid here is a binder concern — see ast.ts's TableReferenceNode doc.
      return { kind: 'TableReference', table: token.text, span: token.span }
    }

    throw new ParseError(`Unexpected ${describeToken(token)}.`, token.span)
  }

  private columnReference(table: string | null, tableSpan: SourceSpan | undefined, bracketToken: Token): ColumnReferenceNode {
    if (bracketToken.text === '') {
      throw new ParseError('A column reference cannot be empty — expected a column name inside the brackets.', bracketToken.span)
    }
    return {
      kind: 'ColumnReference',
      table,
      column: bracketToken.text,
      tableSpan,
      columnSpan: bracketToken.span,
      span: { start: tableSpan?.start ?? bracketToken.span.start, end: bracketToken.span.end },
    }
  }

  private functionCall(nameToken: Token): Expression {
    this.expect('(', '"("')
    const args: Expression[] = []
    if (this.peek().type !== ')') {
      args.push(this.parseExpression())
      while (this.peek().type === ',') {
        this.advance()
        args.push(this.parseExpression())
      }
    }
    const close = this.expect(')', '")"')
    return {
      kind: 'FunctionCall',
      name: nameToken.text,
      nameSpan: nameToken.span,
      args,
      span: { start: nameToken.span.start, end: close.span.end },
    }
  }
}

function describeToken(token: Token): string {
  if (token.type === 'eof') return 'end of expression'
  if (token.type === 'bracket') return `"[${token.text}]"`
  if (token.type === 'string') return `string "${token.text}"`
  return `"${token.text}"`
}

/**
 * Parses a calculated-column expression into an AST. Never throws: a
 * malformed expression yields no `expression` and a `SYNTAX_ERROR`
 * diagnostic instead. See docs/EXPRESSION_ENGINE.md for the supported
 * grammar.
 */
export function parseExpression(source: string): ParseResult {
  if (source.trim() === '') {
    return { diagnostics: [diagnostic('error', 'SYNTAX_ERROR', 'The expression is empty.', { start: 0, end: 0 })] }
  }

  try {
    const tokens = tokenize(source)
    const parser = new Parser(tokens)
    const expression = parser.parseProgram()
    return { expression, diagnostics: [] }
  } catch (error) {
    if (error instanceof ParseError || error instanceof LexError) {
      return { diagnostics: [diagnostic('error', 'SYNTAX_ERROR', error.message, error.span)] }
    }
    throw error
  }
}
