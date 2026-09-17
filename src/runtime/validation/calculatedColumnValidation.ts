import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { CalculatedColumnResultRule, CalculatedColumnValidationCase, ValidationFeedback } from '../../domain/validation'
import { evaluateCalculatedColumn } from '../calculatedColumn/calculatedColumnRuntime'
import { resolveTableRef } from '../model/modelRuntime'
import { compareScalar } from './scalarComparison'
import { classifySelectorFailure, resolveCalculatedColumnSelector, resolveColumnSelector, type SelectorResolutionError } from './selectorResolver'
import type { RuleEvaluationResult } from './types'

function configError(message: string): RuleEvaluationResult {
  return { status: 'error', pointsEarned: 0, feedback: [{ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message }] }
}

type RowLookup = { ok: true; rowIndex: number } | { ok: false; error: SelectorResolutionError } | { ok: false; notFound: true; message: string }

/** Finds the row whose selector column equals a specific value — row identity is always explicit, never "the first row" (see docs/VALIDATION_ENGINE.md "Row identity"). */
function findRowIndex(model: SemanticModel, datasets: Record<string, Dataset>, row: CalculatedColumnValidationCase['row']): RowLookup {
  const columnResolution = resolveColumnSelector(model, datasets, row.column)
  if (!columnResolution.ok) return { ok: false, error: columnResolution.error }

  const resolvedTable = resolveTableRef(datasets, columnResolution.value.modelTable)
  if (!resolvedTable) return { ok: false, notFound: true, message: `Table "${columnResolution.value.tableName}" could not be resolved.` }

  const column = resolvedTable.table.columns.find((c) => c.id === columnResolution.value.columnId)
  if (!column) return { ok: false, notFound: true, message: `Column "${row.column.columnName}" could not be resolved.` }

  const rowIndex = resolvedTable.table.rows.findIndex((r) => r[column.name] === row.equals)
  if (rowIndex === -1) {
    return { ok: false, notFound: true, message: `No row found where ${columnResolution.value.tableName}[${column.name}] = ${String(row.equals)}.` }
  }
  return { ok: true, rowIndex }
}

/**
 * Validates a calculated column's real, row-level output — executed through
 * the Sprint 3 evaluator (`evaluateCalculatedColumn`), never a reimplemented
 * arithmetic check. Multiple deterministic rows prevent a row-specific
 * hardcoded solution from passing (see docs/VALIDATION_ENGINE.md
 * "Calculated-column result rule").
 */
export function evaluateCalculatedColumnResultRule(
  rule: CalculatedColumnResultRule,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
): RuleEvaluationResult {
  const columnResolution = resolveCalculatedColumnSelector(model, datasets, rule.column)
  if (!columnResolution.ok) {
    if (classifySelectorFailure(columnResolution.error) === 'failed') {
      return {
        status: 'failed',
        pointsEarned: 0,
        feedback: [{ severity: 'error', code: 'CALCULATED_COLUMN_MISSING', message: columnResolution.error.message }],
      }
    }
    return configError(`Calculated-column rule "${rule.title}": ${columnResolution.error.message}`)
  }

  const calculatedColumn = columnResolution.value
  const execution = evaluateCalculatedColumn(model, datasets, calculatedColumn.id)
  if (!execution) {
    return configError(`Calculated-column rule "${rule.title}": the column could not be evaluated.`)
  }
  if (execution.columnDiagnostics.length > 0) {
    return {
      status: 'failed',
      pointsEarned: 0,
      feedback: execution.columnDiagnostics.map((d) => ({ severity: 'error' as const, code: d.code, message: d.message })),
      evidence: { columnDiagnostics: execution.columnDiagnostics },
    }
  }

  const feedback: ValidationFeedback[] = []
  const caseResults: { id: string; passed: boolean }[] = []
  let hasConfigError = false

  for (const testCase of rule.cases) {
    const label = testCase.title ?? `${row(testCase)}`
    const rowLookup = findRowIndex(model, datasets, testCase.row)

    if (!rowLookup.ok && 'error' in rowLookup) {
      hasConfigError = true
      feedback.push({ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message: `Case "${label}": ${rowLookup.error.message}` })
      continue
    }
    if (!rowLookup.ok) {
      hasConfigError = true
      feedback.push({ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message: `Case "${label}": ${rowLookup.message}` })
      continue
    }

    const actual = execution.values[rowLookup.rowIndex]
    const rowErrors = execution.errors.filter((e) => e.rowIndex === rowLookup.rowIndex)
    if (rowErrors.length > 0) {
      caseResults.push({ id: testCase.id, passed: false })
      feedback.push({ severity: 'error', code: 'ROW_EVALUATION_ERROR', message: `${label}: ${rowErrors.map((e) => e.message).join('; ')}` })
      continue
    }

    const comparison = compareScalar(actual, testCase.expected, testCase.tolerance)
    caseResults.push({ id: testCase.id, passed: comparison.matches })
    feedback.push({
      severity: comparison.matches ? 'success' : 'error',
      code: comparison.matches ? 'CASE_PASSED' : 'CASE_FAILED',
      message: comparison.matches ? `${label}: correct.` : `${label}: ${comparison.reason}`,
    })
  }

  if (hasConfigError) {
    return { status: 'error', pointsEarned: 0, feedback, evidence: { caseResults } }
  }

  const passedCount = caseResults.filter((r) => r.passed).length
  const pointsEarned = rule.cases.length === 0 ? 0 : roundPoints((rule.points * passedCount) / rule.cases.length)
  const status = rule.cases.length === 0 ? 'passed' : passedCount === caseResults.length ? 'passed' : passedCount === 0 ? 'failed' : 'partial'

  return { status, pointsEarned, feedback, evidence: { caseResults, calculatedColumnId: calculatedColumn.id } }
}

function row(testCase: CalculatedColumnValidationCase): string {
  return `${testCase.row.column.columnName} = ${String(testCase.row.equals)}`
}

function roundPoints(value: number): number {
  return Math.round(value * 100) / 100
}
