import { hashString } from '../../../lib/hash'

/**
 * Canonicalizes a raw pivot value for grouping/identity purposes — includes
 * the JS type tag so the number `1` and the string `"1"` are never treated
 * as the same pivot bucket (they'd otherwise collide under `String(value)`
 * alone).
 */
export function canonicalPivotKey(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'blank'
  return `${typeof value}:${String(value)}`
}

/** The column name shown to the learner/model — distinct raw values can still produce the same display name (e.g. `1` and `"1"` both display as `"1"`), which `pivotColumn.ts` detects and reports as `QUERY_PIVOT_SCHEMA_COLLISION`. */
export function pivotDisplayName(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(blank)'
  return String(value)
}

/**
 * Pivot's dynamic-schema identity mechanism (docs/POWER_QUERY_RUNTIME.md
 * "Pivot column identity"): a pure function of the step's own id and the
 * canonical pivot value. Same step + same value → same id, forever, with no
 * dependency on row order or how many times the pipeline has reevaluated —
 * this is NOT "minting a new id every reevaluation" (that would be
 * `generateId()`/`crypto.randomUUID()` per call); it is a deterministic
 * derivation, so it never needs to be persisted on the step itself.
 */
export function pivotOutputColumnId(stepId: string, canonicalKey: string): string {
  return `col_pivot_${hashString(`${stepId}::${canonicalKey}`)}`
}
