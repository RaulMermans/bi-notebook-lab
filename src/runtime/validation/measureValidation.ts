import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { MeasureResultValidationRule, MeasureValidationCase, ValidationFeedback } from '../../domain/validation'
import type { ColumnFilter } from '../measure/filterContext'
import { evaluateMeasure } from '../measure/measureRuntime'
import { compareScalar } from './scalarComparison'
import { classifySelectorFailure, resolveColumnSelector, resolveMeasureSelector } from './selectorResolver'
import type { RuleEvaluationResult } from './types'

function configError(message: string): RuleEvaluationResult {
  return { status: 'error', pointsEarned: 0, feedback: [{ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message }] }
}

function roundPoints(value: number): number {
  return Math.round(value * 100) / 100
}

type FilterResolution = { ok: true; filters: ColumnFilter[] } | { ok: false; message: string }

function resolveCaseFilters(model: SemanticModel, datasets: Record<string, Dataset>, filters: MeasureValidationCase['filters']): FilterResolution {
  const resolved: ColumnFilter[] = []
  for (const filter of filters) {
    const columnResolution = resolveColumnSelector(model, datasets, filter.column)
    if (!columnResolution.ok) return { ok: false, message: columnResolution.error.message }

    resolved.push({
      column: {
        datasetId: columnResolution.value.datasetId,
        tableId: columnResolution.value.tableId,
        columnId: columnResolution.value.columnId,
      },
      operator: filter.operator ?? (filter.values.length > 1 ? 'in' : 'equals'),
      values: filter.values,
    })
  }
  return { ok: true, filters: resolved }
}

interface CaseResult {
  testCase: MeasureValidationCase
  passed: boolean
}

/**
 * Detects the "hardcoded grand total" pattern (AGENTS.md §14/§26): a
 * baseline (fewest filters) case that passes while every more-filtered case
 * fails means the base aggregation is right but the result never responds to
 * filter context. This is generic, reusable heuristic feedback — it inspects
 * only case shapes/outcomes, never anything exercise-specific.
 */
function buildContextFeedback(caseResults: CaseResult[]): ValidationFeedback[] {
  if (caseResults.length < 2) return []

  const allFailed = caseResults.every((r) => !r.passed)
  if (allFailed) {
    return [
      {
        severity: 'info',
        code: 'HINT_ALL_CASES_FAILED',
        message: 'This measure does not currently produce the expected result in any context. Check the aggregation and the field it reads.',
      },
    ]
  }

  const allPassed = caseResults.every((r) => r.passed)
  if (allPassed) return []

  const [baseline, ...rest] = [...caseResults].sort((a, b) => a.testCase.filters.length - b.testCase.filters.length)
  const filteredCases = rest.filter((r) => r.testCase.filters.length > baseline.testCase.filters.length)

  if (baseline.passed && filteredCases.length > 0 && filteredCases.every((r) => !r.passed)) {
    return [
      {
        severity: 'info',
        code: 'HINT_FILTER_CONTEXT',
        message:
          'Your base result is correct without filters, but the result does not respond correctly to filter context. Check the active relationship path into this measure\'s table.',
        hint: 'Check whether the expected relationship is active and correctly connects to the filtered table.',
      },
    ]
  }

  return []
}

/**
 * Validates a measure's real, filter-context-aware output across every
 * authored case — executed through `evaluateMeasure`, never a reimplemented
 * aggregation/filter engine. See docs/VALIDATION_ENGINE.md "Multi-context
 * validation is required": testing only the unfiltered case would let a
 * hardcoded constant measure pass.
 */
export function evaluateMeasureResultRule(
  rule: MeasureResultValidationRule,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
): RuleEvaluationResult {
  const measureResolution = resolveMeasureSelector(model, rule.measure)
  if (!measureResolution.ok) {
    if (classifySelectorFailure(measureResolution.error) === 'failed') {
      return {
        status: 'failed',
        pointsEarned: 0,
        feedback: [{ severity: 'error', code: 'MEASURE_MISSING', message: measureResolution.error.message }],
      }
    }
    return configError(`Measure rule "${rule.title}": ${measureResolution.error.message}`)
  }

  const measure = measureResolution.value
  const feedback: ValidationFeedback[] = []
  const caseResults: CaseResult[] = []
  let hasConfigError = false
  let hasStructuralBlocker = false

  for (const testCase of rule.cases) {
    const filterResolution = resolveCaseFilters(model, datasets, testCase.filters)
    if (!filterResolution.ok) {
      hasConfigError = true
      feedback.push({ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message: `Case "${testCase.title}": ${filterResolution.message}` })
      continue
    }

    const execution = evaluateMeasure(model, datasets, measure.id, { filters: filterResolution.filters })

    if (execution.diagnostics.some((d) => d.code === 'FILTER_GRAPH_INVALID')) {
      hasStructuralBlocker = true
      caseResults.push({ testCase, passed: false })
      feedback.push({
        severity: 'error',
        code: 'FILTER_GRAPH_INVALID',
        message: `"${measure.name}" can't be checked under "${testCase.title}" because the model's relationship graph is invalid. Fix the model diagnostics first.`,
      })
      continue
    }

    if (execution.diagnostics.length > 0) {
      caseResults.push({ testCase, passed: false })
      feedback.push({
        severity: 'error',
        code: 'MEASURE_EXECUTION_ERROR',
        message: `"${testCase.title}": ${execution.diagnostics.map((d) => d.message).join('; ')}`,
      })
      continue
    }

    const comparison = compareScalar(execution.value, testCase.expected, testCase.tolerance)
    caseResults.push({ testCase, passed: comparison.matches })
    feedback.push({
      severity: comparison.matches ? 'success' : 'error',
      code: comparison.matches ? 'CASE_PASSED' : 'CASE_FAILED',
      message: comparison.matches ? `${testCase.title}: correct.` : `${testCase.title}: ${comparison.reason}`,
    })
  }

  if (hasConfigError) {
    return { status: 'error', pointsEarned: 0, feedback, evidence: { caseResults, measureId: measure.id } }
  }

  const totalWeight = rule.cases.reduce((sum, c) => sum + (c.weight ?? 1), 0) || 1
  const earnedWeight = caseResults.reduce((sum, r) => sum + (r.passed ? (r.testCase.weight ?? 1) : 0), 0)
  const pointsEarned = roundPoints((rule.points * earnedWeight) / totalWeight)

  const passedCount = caseResults.filter((r) => r.passed).length
  const status = rule.cases.length === 0 ? 'passed' : passedCount === caseResults.length ? 'passed' : passedCount === 0 ? 'failed' : 'partial'

  feedback.push(...buildContextFeedback(caseResults))
  if (hasStructuralBlocker) {
    feedback.push({
      severity: 'warning',
      code: 'STRUCTURAL_BLOCKER',
      message: 'Some cases could not be evaluated because of a model structural issue (see the Model section above).',
    })
  }

  return { status, pointsEarned, feedback, evidence: { caseResults, measureId: measure.id } }
}
