import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { ExpressionSemanticAssertion, ExpressionSemanticValidationRule } from '../../domain/validation'
import type { Expression } from '../../expression/ast'
import { parseExpression } from '../../expression/parser'
import { classifySelectorFailure, resolveCalculatedColumnSelector, resolveColumnSelector, resolveMeasureSelector } from './selectorResolver'
import type { RuleEvaluationResult } from './types'

function configError(message: string): RuleEvaluationResult {
  return { status: 'error', pointsEarned: 0, feedback: [{ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message }] }
}

function roundPoints(value: number): number {
  return Math.round(value * 100) / 100
}

function collectFunctionNames(expr: Expression, names: Set<string>): void {
  if (expr.kind === 'FunctionCall') {
    names.add(expr.name.toUpperCase())
    for (const arg of expr.args) collectFunctionNames(arg, names)
    return
  }
  if (expr.kind === 'UnaryExpression') return collectFunctionNames(expr.operand, names)
  if (expr.kind === 'BinaryExpression') {
    collectFunctionNames(expr.left, names)
    collectFunctionNames(expr.right, names)
  }
}

/** Bracket-only references (`[Name]`) — a measure reference in measure mode, or a current-table column shorthand in a calculated column. Either way, this is what "references X" means at the AST level. */
function collectBracketNames(expr: Expression, names: Set<string>): void {
  if (expr.kind === 'ColumnReference' && expr.table === null) {
    names.add(expr.column.toLowerCase())
    return
  }
  if (expr.kind === 'UnaryExpression') return collectBracketNames(expr.operand, names)
  if (expr.kind === 'BinaryExpression') {
    collectBracketNames(expr.left, names)
    collectBracketNames(expr.right, names)
    return
  }
  if (expr.kind === 'FunctionCall') {
    for (const arg of expr.args) collectBracketNames(arg, names)
  }
}

function collectColumnReferences(expr: Expression, refs: { table: string | null; column: string }[]): void {
  if (expr.kind === 'ColumnReference') {
    refs.push({ table: expr.table, column: expr.column })
    return
  }
  if (expr.kind === 'UnaryExpression') return collectColumnReferences(expr.operand, refs)
  if (expr.kind === 'BinaryExpression') {
    collectColumnReferences(expr.left, refs)
    collectColumnReferences(expr.right, refs)
    return
  }
  if (expr.kind === 'FunctionCall') {
    for (const arg of expr.args) collectColumnReferences(arg, refs)
  }
}

function isConstantOnly(expr: Expression): boolean {
  switch (expr.kind) {
    case 'NumberLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral':
      return true
    case 'UnaryExpression':
      return isConstantOnly(expr.operand)
    case 'BinaryExpression':
      return isConstantOnly(expr.left) && isConstantOnly(expr.right)
    default:
      return false
  }
}

interface AssertionOutcome {
  passed: boolean
  message: string
}

/** Evaluates one AST-level assertion — walks the parsed tree, never compares source strings (AGENTS.md "Semantic validation must be used carefully"). */
function evaluateAssertion(
  assertion: ExpressionSemanticAssertion,
  expression: Expression,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
): AssertionOutcome {
  switch (assertion.kind) {
    case 'uses-function': {
      const names = new Set<string>()
      collectFunctionNames(expression, names)
      const passed = names.has(assertion.functionName.toUpperCase())
      return { passed, message: passed ? `Uses ${assertion.functionName}.` : `Expected the expression to use ${assertion.functionName}.` }
    }
    case 'references-measure': {
      const names = new Set<string>()
      collectBracketNames(expression, names)
      const passed = names.has(assertion.measureName.toLowerCase())
      return {
        passed,
        message: passed ? `References [${assertion.measureName}].` : `Expected the expression to reference [${assertion.measureName}].`,
      }
    }
    case 'references-column': {
      const columnResolution = resolveColumnSelector(model, datasets, assertion.column)
      if (!columnResolution.ok) return { passed: false, message: columnResolution.error.message }

      const refs: { table: string | null; column: string }[] = []
      collectColumnReferences(expression, refs)
      const lowerColumn = columnResolution.value.columnName.toLowerCase()
      const passed = refs.some((r) => r.column.toLowerCase() === lowerColumn)
      return {
        passed,
        message: passed
          ? `References ${assertion.column.columnName}.`
          : `Expected the expression to reference ${assertion.column.columnName}.`,
      }
    }
    case 'not-constant-only': {
      const passed = !isConstantOnly(expression)
      return {
        passed,
        message: passed ? 'Does not look like a hardcoded constant.' : 'This expression is a constant — it does not read any data.',
      }
    }
  }
}

/**
 * Inspects the parsed AST of a measure or calculated column against one or
 * more structural assertions. Supplementary by design (docs/VALIDATION_ENGINE.md
 * "Semantic validation must be used carefully") — only wire this into an
 * exercise when the learning objective specifically requires a technique.
 */
export function evaluateExpressionSemanticRule(
  rule: ExpressionSemanticValidationRule,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
): RuleEvaluationResult {
  let expressionSource: string

  if (rule.target.kind === 'measure') {
    const resolution = resolveMeasureSelector(model, rule.target.measure)
    if (!resolution.ok) {
      if (classifySelectorFailure(resolution.error) === 'failed') {
        return { status: 'failed', pointsEarned: 0, feedback: [{ severity: 'error', code: 'MEASURE_MISSING', message: resolution.error.message }] }
      }
      return configError(`Semantic rule "${rule.title}": ${resolution.error.message}`)
    }
    expressionSource = resolution.value.expression
  } else {
    const resolution = resolveCalculatedColumnSelector(model, datasets, rule.target.column)
    if (!resolution.ok) {
      if (classifySelectorFailure(resolution.error) === 'failed') {
        return {
          status: 'failed',
          pointsEarned: 0,
          feedback: [{ severity: 'error', code: 'CALCULATED_COLUMN_MISSING', message: resolution.error.message }],
        }
      }
      return configError(`Semantic rule "${rule.title}": ${resolution.error.message}`)
    }
    expressionSource = resolution.value.expression
  }

  const parsed = parseExpression(expressionSource)
  if (!parsed.expression) {
    return configError(`Semantic rule "${rule.title}": the target expression could not be parsed.`)
  }

  const outcomes = rule.assertions.map((assertion) => evaluateAssertion(assertion, parsed.expression!, model, datasets))
  const passedCount = outcomes.filter((o) => o.passed).length
  const status = outcomes.length === 0 ? 'passed' : passedCount === outcomes.length ? 'passed' : passedCount === 0 ? 'failed' : 'partial'
  const pointsEarned = outcomes.length === 0 ? rule.points : roundPoints((rule.points * passedCount) / outcomes.length)

  return {
    status,
    pointsEarned,
    feedback: outcomes.map((o) => ({
      severity: o.passed ? 'success' : 'error',
      code: o.passed ? 'ASSERTION_PASSED' : 'ASSERTION_FAILED',
      message: o.message,
    })),
  }
}
