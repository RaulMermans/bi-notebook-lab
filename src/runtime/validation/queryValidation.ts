import { primaryTable } from '../../domain/data'
import type { QueryDefinition, QueryEvaluation } from '../../domain/query'
import type {
  QueryHealthValidationRule,
  QueryOutputRowCountValidationRule,
  QueryOutputSchemaValidationRule,
  QueryOutputValueValidationRule,
  QueryPresentValidationRule,
  QueryStepSemanticsValidationRule,
  ValidationFeedback,
} from '../../domain/validation'
import { compareScalar } from './scalarComparison'
import { classifyQuerySelectorFailure, resolveQuerySelector } from './selectorResolver'
import type { RuleEvaluationResult } from './types'

function configError(message: string): RuleEvaluationResult {
  return { status: 'error', pointsEarned: 0, feedback: [{ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message }] }
}

function roundPoints(value: number): number {
  return Math.round(value * 100) / 100
}

/** Verifies a learner-created query exists — the query counterpart to `evaluateTablePresenceRule`. */
export function evaluateQueryPresentRule(rule: QueryPresentValidationRule, queries: Record<string, QueryDefinition>): RuleEvaluationResult {
  const resolution = resolveQuerySelector(queries, rule.query)
  if (!resolution.ok) {
    if (classifyQuerySelectorFailure(resolution.error) === 'failed') {
      return { status: 'failed', pointsEarned: 0, feedback: [{ severity: 'error', code: 'QUERY_MISSING', message: resolution.error.message }] }
    }
    return configError(`Query-present rule "${rule.title}": ${resolution.error.message}`)
  }
  return { status: 'passed', pointsEarned: rule.points, feedback: [{ severity: 'success', code: 'QUERY_PRESENT', message: `"${rule.query.queryName}" exists.` }] }
}

/** Passes when the query's current `QueryEvaluation.status === 'success'`. Failure feedback summarizes learner-facing diagnostic messages — never raw evidence (docs/QUERY_VALIDATION.md "Evidence vs feedback"). */
export function evaluateQueryHealthRule(
  rule: QueryHealthValidationRule,
  queries: Record<string, QueryDefinition>,
  queryEvaluations: Record<string, QueryEvaluation>,
): RuleEvaluationResult {
  const resolution = resolveQuerySelector(queries, rule.query)
  if (!resolution.ok) {
    if (classifyQuerySelectorFailure(resolution.error) === 'failed') {
      return { status: 'failed', pointsEarned: 0, feedback: [{ severity: 'error', code: 'QUERY_MISSING', message: resolution.error.message }] }
    }
    return configError(`Query-health rule "${rule.title}": ${resolution.error.message}`)
  }

  const evaluation = queryEvaluations[resolution.value.id]
  if (!evaluation) {
    return { status: 'failed', pointsEarned: 0, feedback: [{ severity: 'error', code: 'QUERY_NOT_EVALUATED', message: `"${rule.query.queryName}" has not been evaluated yet.` }] }
  }
  if (evaluation.status !== 'success') {
    const errorDiagnostics = evaluation.diagnostics.filter((d) => d.severity === 'error')
    return {
      status: 'failed',
      pointsEarned: 0,
      feedback:
        errorDiagnostics.length > 0
          ? errorDiagnostics.map((d) => ({ severity: 'error' as const, code: d.code, message: d.message }))
          : [{ severity: 'error', code: 'QUERY_HEALTH_FAILED', message: `"${rule.query.queryName}" failed to evaluate.` }],
      evidence: { queryId: resolution.value.id, diagnostics: evaluation.diagnostics },
    }
  }

  return {
    status: 'passed',
    pointsEarned: rule.points,
    feedback: [{ severity: 'success', code: 'QUERY_HEALTHY', message: `"${rule.query.queryName}" evaluates successfully.` }],
    evidence: { queryId: resolution.value.id },
  }
}

/** Resolves a query and its current output table together, or returns why it couldn't (query missing/ambiguous, or not yet evaluated) — the shared entry point for every rule that reads a query's evaluated output. */
function resolveOutputTable(
  queries: Record<string, QueryDefinition>,
  queryEvaluations: Record<string, QueryEvaluation>,
  selector: { queryName: string },
  ruleTitle: string,
):
  | { ok: true; query: QueryDefinition; table: ReturnType<typeof primaryTable> }
  | { ok: false; result: RuleEvaluationResult } {
  const resolution = resolveQuerySelector(queries, selector)
  if (!resolution.ok) {
    if (classifyQuerySelectorFailure(resolution.error) === 'failed') {
      return { ok: false, result: { status: 'failed', pointsEarned: 0, feedback: [{ severity: 'error', code: 'QUERY_MISSING', message: resolution.error.message }] } }
    }
    return { ok: false, result: configError(`"${ruleTitle}": ${resolution.error.message}`) }
  }

  const query = resolution.value
  const evaluation = queryEvaluations[query.id]
  if (!evaluation?.output) {
    return {
      ok: false,
      result: { status: 'failed', pointsEarned: 0, feedback: [{ severity: 'error', code: 'QUERY_NOT_EVALUATED', message: `"${selector.queryName}" has no output yet.` }] },
    }
  }

  return { ok: true, query, table: primaryTable(evaluation.output) }
}

/** No whole-schema equality requirement — only the listed columns are asserted, each worth an equal share of the rule's points. */
export function evaluateQueryOutputSchemaRule(
  rule: QueryOutputSchemaValidationRule,
  queries: Record<string, QueryDefinition>,
  queryEvaluations: Record<string, QueryEvaluation>,
): RuleEvaluationResult {
  const resolved = resolveOutputTable(queries, queryEvaluations, rule.query, rule.title)
  if (!resolved.ok) return resolved.result

  const feedback: ValidationFeedback[] = []
  let passedCount = 0

  for (const assertion of rule.columns) {
    const expectPresent = assertion.present ?? true
    const match = resolved.table.columns.find((c) => c.name.toLowerCase() === assertion.name.toLowerCase())

    if (expectPresent && !match) {
      feedback.push({ severity: 'error', code: 'QUERY_COLUMN_MISSING', message: `"${resolved.query.name}" should have a column named "${assertion.name}", but it doesn't yet.` })
      continue
    }
    if (!expectPresent && match) {
      feedback.push({ severity: 'error', code: 'QUERY_COLUMN_SHOULD_BE_ABSENT', message: `"${resolved.query.name}" still has a column named "${assertion.name}" — it should have been removed or renamed.` })
      continue
    }
    if (expectPresent && match && assertion.dataType && match.dataType !== assertion.dataType) {
      feedback.push({
        severity: 'error',
        code: 'QUERY_COLUMN_TYPE_MISMATCH',
        message: `"${resolved.query.name}[${assertion.name}]" should be ${assertion.dataType}, but is currently ${match.dataType}.`,
      })
      continue
    }

    passedCount += 1
    feedback.push({ severity: 'success', code: 'QUERY_COLUMN_OK', message: `"${assertion.name}" ${expectPresent ? 'is present' : 'is correctly absent'}.` })
  }

  const total = rule.columns.length
  const pointsEarned = total === 0 ? 0 : roundPoints((rule.points * passedCount) / total)
  const status = total === 0 ? 'passed' : passedCount === total ? 'passed' : passedCount === 0 ? 'failed' : 'partial'

  return { status, pointsEarned, feedback, evidence: { queryId: resolved.query.id, columns: resolved.table.columns } }
}

/** Reuses `QueryEvaluation.output`'s already-materialized row count — no independent transformation engine. */
export function evaluateQueryOutputRowCountRule(
  rule: QueryOutputRowCountValidationRule,
  queries: Record<string, QueryDefinition>,
  queryEvaluations: Record<string, QueryEvaluation>,
): RuleEvaluationResult {
  const resolved = resolveOutputTable(queries, queryEvaluations, rule.query, rule.title)
  if (!resolved.ok) return resolved.result

  const actual = resolved.table.rowCount
  const { rowCount } = rule
  const matches =
    rowCount.mode === 'equals'
      ? actual === rowCount.value
      : rowCount.mode === 'minimum'
        ? actual >= rowCount.value
        : rowCount.mode === 'maximum'
          ? actual <= rowCount.value
          : actual >= rowCount.min && actual <= rowCount.max

  const expectedText =
    rowCount.mode === 'equals'
      ? `exactly ${rowCount.value.toLocaleString()}`
      : rowCount.mode === 'minimum'
        ? `at least ${rowCount.value.toLocaleString()}`
        : rowCount.mode === 'maximum'
          ? `at most ${rowCount.value.toLocaleString()}`
          : `between ${rowCount.min.toLocaleString()} and ${rowCount.max.toLocaleString()}`

  if (!matches) {
    return {
      status: 'failed',
      pointsEarned: 0,
      feedback: [{ severity: 'error', code: 'QUERY_ROW_COUNT_MISMATCH', message: `"${resolved.query.name}" has ${actual.toLocaleString()} rows; expected ${expectedText}.` }],
      evidence: { queryId: resolved.query.id, actualRowCount: actual },
    }
  }

  return {
    status: 'passed',
    pointsEarned: rule.points,
    feedback: [{ severity: 'success', code: 'QUERY_ROW_COUNT_OK', message: `"${resolved.query.name}" has ${actual.toLocaleString()} rows.` }],
    evidence: { queryId: resolved.query.id, actualRowCount: actual },
  }
}

/** Validates one or more output values using semantic row identification (never "row N") — mirrors `evaluateCalculatedColumnResultRule`'s `cases` pattern. */
export function evaluateQueryOutputValueRule(
  rule: QueryOutputValueValidationRule,
  queries: Record<string, QueryDefinition>,
  queryEvaluations: Record<string, QueryEvaluation>,
): RuleEvaluationResult {
  const resolved = resolveOutputTable(queries, queryEvaluations, rule.query, rule.title)
  if (!resolved.ok) return resolved.result

  const feedback: ValidationFeedback[] = []
  let hasConfigError = false
  let passedCount = 0

  for (const testCase of rule.cases) {
    const label = testCase.title ?? `${testCase.row.columnName} = ${String(testCase.row.equals)}`
    const rowColumn = resolved.table.columns.find((c) => c.name.toLowerCase() === testCase.row.columnName.toLowerCase())
    if (!rowColumn) {
      hasConfigError = true
      feedback.push({ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message: `Case "${label}": "${resolved.query.name}" has no column named "${testCase.row.columnName}".` })
      continue
    }

    const row = resolved.table.rows.find((r) => r[rowColumn.name] === testCase.row.equals)
    if (!row) {
      feedback.push({ severity: 'error', code: 'QUERY_ROW_NOT_FOUND', message: `Case "${label}": no row found where ${rowColumn.name} = ${String(testCase.row.equals)}.` })
      continue
    }

    const expectedColumn = resolved.table.columns.find((c) => c.name.toLowerCase() === testCase.expected.columnName.toLowerCase())
    if (!expectedColumn) {
      hasConfigError = true
      feedback.push({ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message: `Case "${label}": "${resolved.query.name}" has no column named "${testCase.expected.columnName}".` })
      continue
    }

    const comparison = compareScalar(row[expectedColumn.name], testCase.expected.value, testCase.expected.tolerance)
    if (comparison.matches) passedCount += 1
    feedback.push({
      severity: comparison.matches ? 'success' : 'error',
      code: comparison.matches ? 'CASE_PASSED' : 'CASE_FAILED',
      message: comparison.matches ? `${label}: correct.` : `${label}: ${comparison.reason}`,
    })
  }

  if (hasConfigError) {
    return { status: 'error', pointsEarned: 0, feedback }
  }

  const total = rule.cases.length
  const pointsEarned = total === 0 ? 0 : roundPoints((rule.points * passedCount) / total)
  const status = total === 0 ? 'passed' : passedCount === total ? 'passed' : passedCount === 0 ? 'failed' : 'partial'

  return { status, pointsEarned, feedback, evidence: { queryId: resolved.query.id } }
}

/** Bounded assertions over Applied Step *kinds* only — never step ids, names, or exact step arrays, so renaming a step can never fail a check. */
export function evaluateQueryStepSemanticsRule(
  rule: QueryStepSemanticsValidationRule,
  queries: Record<string, QueryDefinition>,
): RuleEvaluationResult {
  const resolution = resolveQuerySelector(queries, rule.query)
  if (!resolution.ok) {
    if (classifyQuerySelectorFailure(resolution.error) === 'failed') {
      return { status: 'failed', pointsEarned: 0, feedback: [{ severity: 'error', code: 'QUERY_MISSING', message: resolution.error.message }] }
    }
    return configError(`Query-step-semantics rule "${rule.title}": ${resolution.error.message}`)
  }

  const query = resolution.value
  const stepKinds = query.steps.map((s) => s.kind)
  const feedback: ValidationFeedback[] = []
  let passedCount = 0

  for (const assertion of rule.assertions) {
    if (assertion.kind === 'uses-step') {
      const ok = stepKinds.includes(assertion.stepKind)
      if (ok) passedCount += 1
      feedback.push({
        severity: ok ? 'success' : 'error',
        code: ok ? 'QUERY_STEP_PRESENT' : 'QUERY_STEP_MISSING',
        message: ok ? `Uses ${assertion.stepKind}.` : `"${query.name}" doesn't use ${assertion.stepKind} yet.`,
      })
    } else if (assertion.kind === 'does-not-use-step') {
      const ok = !stepKinds.includes(assertion.stepKind)
      if (ok) passedCount += 1
      feedback.push({
        severity: ok ? 'success' : 'error',
        code: ok ? 'QUERY_STEP_ABSENT_OK' : 'QUERY_STEP_SHOULD_BE_ABSENT',
        message: ok ? `Does not use ${assertion.stepKind}.` : `"${query.name}" still uses ${assertion.stepKind}.`,
      })
    } else if (assertion.kind === 'step-before') {
      const earlierIndex = stepKinds.indexOf(assertion.earlier)
      const laterIndex = stepKinds.indexOf(assertion.later)
      const ok = earlierIndex !== -1 && laterIndex !== -1 && earlierIndex < laterIndex
      if (ok) passedCount += 1
      feedback.push({
        severity: ok ? 'success' : 'error',
        code: ok ? 'QUERY_STEP_ORDER_OK' : 'QUERY_STEP_ORDER_MISMATCH',
        message: ok
          ? `${assertion.earlier} happens before ${assertion.later}.`
          : `Expected ${assertion.earlier} to happen before ${assertion.later}.`,
      })
    } else {
      const ok = query.loadEnabled
      if (ok) passedCount += 1
      feedback.push({
        severity: ok ? 'success' : 'error',
        code: ok ? 'QUERY_LOAD_ENABLED' : 'QUERY_LOAD_DISABLED',
        message: ok ? `"${query.name}" has Enable Load turned on.` : `"${query.name}" needs Enable Load turned on to feed the semantic model.`,
      })
    }
  }

  const total = rule.assertions.length
  const pointsEarned = total === 0 ? 0 : roundPoints((rule.points * passedCount) / total)
  const status = total === 0 ? 'passed' : passedCount === total ? 'passed' : passedCount === 0 ? 'failed' : 'partial'

  return { status, pointsEarned, feedback, evidence: { queryId: query.id } }
}
