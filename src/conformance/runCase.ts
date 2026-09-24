import { createCalculatedColumn } from '../runtime/calculatedColumn/calculatedColumnRuntime'
import { createMeasure, evaluateMeasure } from '../runtime/measure/measureRuntime'
import { compareScalar } from '../runtime/validation/scalarComparison'
import type { DaxConformanceCase } from './types'

export interface ConformanceCaseResult {
  actual: unknown
  matches: boolean
  reason?: string
  diagnostics: string[]
}

const PROBE_NAME = '__conformance_probe__'

/**
 * Runs one case through the **public** runtime APIs — the same
 * create/evaluate path a learner's own measure or calculated column goes
 * through (parse → bind → validate → evaluate), never a private helper
 * (brief §30).
 */
export function runConformanceCase(testCase: DaxConformanceCase): ConformanceCaseResult {
  const { fixture } = testCase
  const homeModelTableId = fixture.homeModelTableId ?? fixture.model.tables[0].id

  if (testCase.evaluationMode === 'measure') {
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId,
      name: PROBE_NAME,
      expression: testCase.expression,
    })
    if (!created.measure) {
      return {
        actual: undefined,
        matches: false,
        reason: 'expression failed to bind',
        diagnostics: created.diagnostics.map((d) => `${d.code}: ${d.message}`),
      }
    }

    const execution = evaluateMeasure(created.model, fixture.datasets, created.measure.id, testCase.filterContext)
    const comparison = compareScalar(execution.value, testCase.expected, testCase.tolerance)
    return {
      actual: execution.value,
      matches: comparison.matches,
      reason: comparison.reason,
      diagnostics: execution.diagnostics.map((d) => `${d.code}: ${d.message}`),
    }
  }

  const created = createCalculatedColumn(fixture.model, fixture.datasets, {
    modelTableId: homeModelTableId,
    name: PROBE_NAME,
    expression: testCase.expression,
  })
  if (!created.calculatedColumn || !created.execution) {
    return {
      actual: undefined,
      matches: false,
      reason: 'expression failed to bind',
      diagnostics: created.diagnostics.map((d) => `${d.code}: ${d.message}`),
    }
  }

  const actual = created.execution.values[0]
  const comparison = compareScalar(actual, testCase.expected, testCase.tolerance)
  return {
    actual,
    matches: comparison.matches,
    reason: comparison.reason,
    diagnostics: created.execution.errors.map((e) => e.message),
  }
}
