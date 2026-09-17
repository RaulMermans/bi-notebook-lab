import type { ValidationRuleResult, ValidationRun } from '../../domain/validation'

/**
 * Deterministic overall scoring: `earned / possible × 100`, passing when the
 * percentage clears `passingPercentage` AND every `required` rule passed
 * (docs/VALIDATION_ENGINE.md "Scoring" / "Required rules"). A required rule
 * that is merely `partial` still blocks the pass — only `passed` counts.
 */
export function computeValidationRun(
  testCellId: string,
  ruleResults: ValidationRuleResult[],
  passingPercentage: number,
  fingerprint: string,
): ValidationRun {
  const pointsPossible = ruleResults.reduce((sum, r) => sum + r.pointsPossible, 0)
  const pointsEarned = ruleResults.reduce((sum, r) => sum + r.pointsEarned, 0)
  const percentage = pointsPossible === 0 ? 0 : (pointsEarned / pointsPossible) * 100
  const requiredFailed = ruleResults.some((r) => r.required && r.status !== 'passed')
  const passed = percentage >= passingPercentage && !requiredFailed

  return { testCellId, pointsEarned, pointsPossible, percentage, passed, ruleResults, fingerprint }
}

/**
 * The current notebook score: the sum of earned/possible points across
 * whichever `ValidationRun`s the caller considers current (non-stale) — see
 * docs/VALIDATION_ENGINE.md "Notebook score". This does not track history;
 * it's a snapshot of the notebook's present state only.
 */
export function computeNotebookScore(runs: ValidationRun[]): { pointsEarned: number; pointsPossible: number; percentage: number } {
  const pointsEarned = runs.reduce((sum, r) => sum + r.pointsEarned, 0)
  const pointsPossible = runs.reduce((sum, r) => sum + r.pointsPossible, 0)
  const percentage = pointsPossible === 0 ? 0 : (pointsEarned / pointsPossible) * 100
  return { pointsEarned, pointsPossible, percentage }
}
