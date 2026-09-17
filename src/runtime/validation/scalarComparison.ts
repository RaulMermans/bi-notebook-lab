import { DEFAULT_NUMERIC_TOLERANCE, type NumericTolerance, type ValidationScalar } from '../../domain/validation'

function withinTolerance(actual: number, expected: number, tolerance: NumericTolerance): boolean {
  const diff = Math.abs(actual - expected)
  const scale = Math.max(Math.abs(expected), Math.abs(actual))
  switch (tolerance.type) {
    case 'absolute':
      return diff <= tolerance.value
    case 'relative':
      return diff <= tolerance.value * scale
    case 'absolute-or-relative':
      return diff <= tolerance.absolute || diff <= tolerance.relative * scale
  }
}

export interface ScalarComparisonResult {
  matches: boolean
  reason?: string
}

/**
 * Compares a runtime execution value against an expected `ValidationScalar`.
 * Numbers always compare with tolerance — never `===` — see
 * docs/VALIDATION_ENGINE.md "Numeric tolerance". `null` means "expect blank"
 * and matches both `null` and `undefined`, since row/measure evaluation uses
 * both interchangeably for "no value" (see docs/EXPRESSION_ENGINE.md
 * "Null/blank semantics").
 */
export function compareScalar(
  actual: unknown,
  expected: ValidationScalar,
  tolerance: NumericTolerance = DEFAULT_NUMERIC_TOLERANCE,
): ScalarComparisonResult {
  if (expected === null) {
    const matches = actual === null || actual === undefined
    return { matches, reason: matches ? undefined : `expected blank, got ${formatActual(actual)}` }
  }

  if (typeof expected === 'number') {
    if (typeof actual !== 'number' || Number.isNaN(actual)) {
      return { matches: false, reason: `expected ${expected}, got ${formatActual(actual)}` }
    }
    const matches = withinTolerance(actual, expected, tolerance)
    return { matches, reason: matches ? undefined : `expected ${expected}, got ${actual} (difference ${Math.abs(actual - expected)})` }
  }

  if (typeof expected === 'boolean') {
    const matches = actual === expected
    return { matches, reason: matches ? undefined : `expected ${expected}, got ${formatActual(actual)}` }
  }

  // string
  const matches = actual === expected
  return { matches, reason: matches ? undefined : `expected "${expected}", got ${formatActual(actual)}` }
}

function formatActual(actual: unknown): string {
  if (actual === null || actual === undefined) return 'BLANK'
  if (typeof actual === 'string') return `"${actual}"`
  return String(actual)
}
