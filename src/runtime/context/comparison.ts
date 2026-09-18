import type { MeasureContextComparison } from '../../domain/context'

/**
 * Compares a measure's baseline (no filters) and current (learner filters)
 * results. Only ever reads two already-evaluated scalars — see
 * `docs/CONTEXT_VISUALIZER.md` "Baseline vs current". Never computes a
 * meaningless delta between two non-numeric results (e.g. two strings) —
 * Sprint 6 brief §32.
 */
export function compareMeasureResults(baselineValue: unknown, currentValue: unknown): MeasureContextComparison {
  const bothNumeric = typeof baselineValue === 'number' && typeof currentValue === 'number' && Number.isFinite(baselineValue) && Number.isFinite(currentValue)

  if (!bothNumeric) {
    return { baselineValue, currentValue, bothNumeric: false }
  }

  const absoluteDelta = currentValue - baselineValue
  let relativeDelta: number | undefined
  if (baselineValue !== 0) {
    relativeDelta = absoluteDelta / baselineValue
  } else if (currentValue === 0) {
    relativeDelta = 0
  }
  // baselineValue === 0 && currentValue !== 0: relativeDelta stays undefined — "n/a", never a divide-by-zero artifact.

  return { baselineValue, currentValue, bothNumeric: true, absoluteDelta, relativeDelta }
}
