import type { CustomColumnStep } from '../../../domain/query'
import { bindExpression } from '../expression/binder'
import { ExpressionEvalError } from '../expression/evalError'
import { evaluateBoundExpression } from '../expression/evaluator'
import { ExpressionLexError, tokenize } from '../expression/lexer'
import { ExpressionParseError, parseExpression } from '../expression/parser'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'
import { inferOutputType } from './inferOutputType'

/**
 * Parses + binds once per evaluation (source text is the only persisted
 * form — no AST is stored), then evaluates the bound expression per row.
 * Never `eval`/`new Function` (docs/POWER_QUERY_RUNTIME.md "Custom Column
 * runtime safety"). A row that throws fails the whole step, per the Step
 * Failure Boundary — Custom Column never partially applies.
 */
export function evaluateCustomColumn(frame: QueryFrame, step: CustomColumnStep): StepEvalResult {
  const existingNames = new Set(frame.columns.map((c) => c.name.toLowerCase()))
  if (existingNames.has(step.outputName.toLowerCase())) {
    return { diagnostics: [errorDiagnostic('QUERY_DUPLICATE_COLUMN_NAME', `A column named "${step.outputName}" already exists.`, { stepId: step.id })] }
  }

  try {
    tokenize(step.expression)
  } catch (err) {
    if (err instanceof ExpressionLexError) {
      return { diagnostics: [errorDiagnostic('QUERY_CUSTOM_PARSE_ERROR', err.message, { stepId: step.id })] }
    }
    throw err
  }

  let ast
  try {
    ast = parseExpression(step.expression)
  } catch (err) {
    if (err instanceof ExpressionParseError) {
      return { diagnostics: [errorDiagnostic('QUERY_CUSTOM_PARSE_ERROR', err.message, { stepId: step.id })] }
    }
    throw err
  }

  const { bound, diagnostics: bindDiagnostics } = bindExpression(ast, frame.columns, step.id)
  const hasBindError = bindDiagnostics.some((d) => d.severity === 'error')
  if (!bound || hasBindError) {
    return { diagnostics: bindDiagnostics.length > 0 ? bindDiagnostics : [errorDiagnostic('QUERY_CUSTOM_PARSE_ERROR', 'The Custom Column expression could not be resolved.', { stepId: step.id })] }
  }

  const values: unknown[] = []
  for (const row of frame.rows) {
    try {
      values.push(evaluateBoundExpression(bound, row))
    } catch (err) {
      if (err instanceof ExpressionEvalError) {
        return { diagnostics: [errorDiagnostic(err.code, err.message, { stepId: step.id })] }
      }
      throw err
    }
  }

  const inferred = inferOutputType(values)
  if (!inferred.ok) {
    return {
      diagnostics: [
        errorDiagnostic('QUERY_CUSTOM_TYPE_ERROR', 'This Custom Column expression produces incompatible result types across rows — use consistent types.', { stepId: step.id }),
      ],
    }
  }

  const outputColumn = { id: step.outputColumnId, name: step.outputName, dataType: inferred.dataType, nullable: inferred.nullable }
  const rows = frame.rows.map((row, i) => ({ ...row, [step.outputName]: values[i] }))

  return { frame: { columns: [...frame.columns, outputColumn], rows }, diagnostics: [] }
}
