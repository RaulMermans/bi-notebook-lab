import type { BinaryOperator, ExprNode } from './ast'
import { ExpressionLexError, tokenize, type Token } from './lexer'

export class ExpressionParseError extends Error {
  constructor(
    message: string,
    public position: number,
  ) {
    super(message)
  }
}

const COMPARISON_OPERATORS = new Set(['=', '<>', '>', '>=', '<', '<='])

class Parser {
  private index = 0

  constructor(private tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.index]
  }

  private advance(): Token {
    return this.tokens[this.index++]
  }

  private expect(type: Token['type'], expected: string): Token {
    const token = this.peek()
    if (token.type !== type) throw new ExpressionParseError(`Expected ${expected} but found "${token.value || '<end of expression>'}".`, token.position)
    return this.advance()
  }

  private isKeyword(value: string): boolean {
    const token = this.peek()
    return token.type === 'keyword' && token.value.toLowerCase() === value
  }

  parseProgram(): ExprNode {
    const expr = this.parseComparison()
    if (this.peek().type !== 'eof') {
      throw new ExpressionParseError(`Unexpected trailing content starting at "${this.peek().value}".`, this.peek().position)
    }
    return expr
  }

  private parseComparison(): ExprNode {
    let left = this.parseConcat()
    while (this.peek().type === 'operator' && COMPARISON_OPERATORS.has(this.peek().value)) {
      const operator = this.advance().value as BinaryOperator
      const right = this.parseConcat()
      left = { kind: 'binary', operator, left, right }
    }
    return left
  }

  private parseConcat(): ExprNode {
    let left = this.parseAdditive()
    while (this.peek().type === 'operator' && this.peek().value === '&') {
      this.advance()
      const right = this.parseAdditive()
      left = { kind: 'binary', operator: '&', left, right }
    }
    return left
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative()
    while (this.peek().type === 'operator' && (this.peek().value === '+' || this.peek().value === '-')) {
      const operator = this.advance().value as BinaryOperator
      const right = this.parseMultiplicative()
      left = { kind: 'binary', operator, left, right }
    }
    return left
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary()
    while (this.peek().type === 'operator' && (this.peek().value === '*' || this.peek().value === '/')) {
      const operator = this.advance().value as BinaryOperator
      const right = this.parseUnary()
      left = { kind: 'binary', operator, left, right }
    }
    return left
  }

  private parseUnary(): ExprNode {
    if (this.peek().type === 'operator' && this.peek().value === '-') {
      this.advance()
      return { kind: 'unary-minus', operand: this.parseUnary() }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): ExprNode {
    const token = this.peek()

    if (token.type === 'number') {
      this.advance()
      return { kind: 'literal', value: Number(token.value) }
    }
    if (token.type === 'string') {
      this.advance()
      return { kind: 'literal', value: token.value }
    }
    if (token.type === 'column') {
      this.advance()
      return { kind: 'column', name: token.value }
    }
    if (this.isKeyword('true')) {
      this.advance()
      return { kind: 'literal', value: true }
    }
    if (this.isKeyword('false')) {
      this.advance()
      return { kind: 'literal', value: false }
    }
    if (this.isKeyword('null')) {
      this.advance()
      return { kind: 'literal', value: null }
    }
    if (this.isKeyword('if')) {
      this.advance()
      const condition = this.parseComparison()
      if (!this.isKeyword('then')) throw new ExpressionParseError('Expected "then" after "if" condition.', this.peek().position)
      this.advance()
      const whenTrue = this.parseComparison()
      if (!this.isKeyword('else')) throw new ExpressionParseError('Expected "else" to complete "if ... then ...".', this.peek().position)
      this.advance()
      const whenFalse = this.parseComparison()
      return { kind: 'conditional', condition, whenTrue, whenFalse }
    }
    if (token.type === 'lparen') {
      this.advance()
      const expr = this.parseComparison()
      this.expect('rparen', '")"')
      return expr
    }
    if (token.type === 'identifier') {
      return this.parseCall()
    }

    throw new ExpressionParseError(`Unexpected token "${token.value || '<end of expression>'}".`, token.position)
  }

  private parseCall(): ExprNode {
    const first = this.expect('identifier', 'a function name')
    let functionName = first.value
    if (this.peek().type === 'dot') {
      this.advance()
      const second = this.expect('identifier', 'a function name after "."')
      functionName = `${functionName}.${second.value}`
    }

    this.expect('lparen', '"(" to start a function call')
    const args: ExprNode[] = []
    if (this.peek().type !== 'rparen') {
      args.push(this.parseComparison())
      while (this.peek().type === 'comma') {
        this.advance()
        args.push(this.parseComparison())
      }
    }
    this.expect('rparen', '")" to close the function call')
    return { kind: 'call', functionName, args }
  }
}

/** Parses Custom Column source text into an unbound `ExprNode`. Throws `ExpressionParseError`/`ExpressionLexError` — the caller maps either to `QUERY_CUSTOM_PARSE_ERROR`. */
export function parseExpression(source: string): ExprNode {
  const tokens = tokenize(source)
  return new Parser(tokens).parseProgram()
}

export { ExpressionLexError }
