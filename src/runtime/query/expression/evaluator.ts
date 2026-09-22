import type { BinaryOperator, BoundExprNode } from './ast'
import { ExpressionEvalError } from './evalError'
import { CUSTOM_COLUMN_FUNCTIONS } from './functions'

function toNumber(value: unknown, context: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  throw new ExpressionEvalError('QUERY_CUSTOM_TYPE_ERROR', `${context} requires a numeric value, got ${describe(value)}.`)
}

function toBoolean(value: unknown, context: string): boolean {
  if (typeof value === 'boolean') return value
  throw new ExpressionEvalError('QUERY_CUSTOM_TYPE_ERROR', `${context} requires a true/false value, got ${describe(value)}.`)
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value)
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  return typeof value
}

function compareOrdered(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

/** Evaluates a bound expression against one row. Never `eval`/`new Function` — a plain recursive tree-walk over the bound AST (docs/POWER_QUERY_RUNTIME.md "Custom Column runtime safety"). Throws `ExpressionEvalError` on a row that can't be evaluated; the caller (steps/customColumn.ts) treats that as the whole step failing, per the Step Failure Boundary. */
export function evaluateBoundExpression(node: BoundExprNode, row: Record<string, unknown>): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value
    case 'column':
      return row[node.name] ?? null
    case 'unary-minus':
      return -toNumber(evaluateBoundExpression(node.operand, row), 'Unary "-"')
    case 'conditional': {
      const condition = toBoolean(evaluateBoundExpression(node.condition, row), 'An "if" condition')
      return condition ? evaluateBoundExpression(node.whenTrue, row) : evaluateBoundExpression(node.whenFalse, row)
    }
    case 'call': {
      const impl = CUSTOM_COLUMN_FUNCTIONS[node.functionName]
      const args = node.args.map((arg) => evaluateBoundExpression(arg, row))
      return impl.apply(args)
    }
    case 'binary':
      return evaluateBinary(node.operator, evaluateBoundExpression(node.left, row), evaluateBoundExpression(node.right, row))
  }
}

function evaluateBinary(operator: BinaryOperator, left: unknown, right: unknown): unknown {
  switch (operator) {
    case '+':
      return toNumber(left, '"+"') + toNumber(right, '"+"')
    case '-':
      return toNumber(left, '"-"') - toNumber(right, '"-"')
    case '*':
      return toNumber(left, '"*"') * toNumber(right, '"*"')
    case '/': {
      const divisor = toNumber(right, '"/"')
      if (divisor === 0) throw new ExpressionEvalError('QUERY_CUSTOM_DIVIDE_BY_ZERO', 'Division by zero.')
      return toNumber(left, '"/"') / divisor
    }
    case '&':
      return toText(left) + toText(right)
    case '=':
      return left === right || (left !== null && right !== null && compareOrdered(left, right) === 0)
    case '<>':
      return !(left === right || (left !== null && right !== null && compareOrdered(left, right) === 0))
    case '>':
    case '>=':
    case '<':
    case '<=': {
      if (left === null || right === null) throw new ExpressionEvalError('QUERY_CUSTOM_TYPE_ERROR', `Cannot compare a null value with "${operator}".`)
      const delta = compareOrdered(left, right)
      if (operator === '>') return delta > 0
      if (operator === '>=') return delta >= 0
      if (operator === '<') return delta < 0
      return delta <= 0
    }
  }
}
