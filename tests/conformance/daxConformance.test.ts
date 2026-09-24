import { describe, expect, it } from 'vitest'
import { runConformanceCase } from '../../src/conformance/runCase'
import { ALL_CONFORMANCE_CASES } from './fixtures'

/**
 * Sprint 15 — DAX Semantic Conformance (docs/SEMANTIC_CONFORMANCE.md). Runs
 * every corpus case through the public runtime APIs and asserts it matches
 * an independently-derived expected value. A case with a `knownDivergence`
 * is reported as skipped (visible in the run, never silently passed) — any
 * *other* mismatch fails the suite, per brief §28 "a new unexpected
 * divergence must fail CI/tests."
 */
describe('DAX semantic conformance', () => {
  for (const testCase of ALL_CONFORMANCE_CASES) {
    const label = `[${testCase.category}] ${testCase.id} — ${testCase.description}`

    if (testCase.knownDivergence) {
      it.skip(`${label} (KNOWN DIVERGENCE: ${testCase.knownDivergence.reason})`, () => {})
      continue
    }

    it(label, () => {
      const result = runConformanceCase(testCase)
      const detail = result.reason ?? (result.diagnostics.length > 0 ? result.diagnostics.join('; ') : `actual=${JSON.stringify(result.actual)}`)
      expect(result.matches, detail).toBe(true)
    })
  }
})
