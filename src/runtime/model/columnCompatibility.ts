import type { DataType } from '../../domain/data'

const NUMERIC_TYPES = new Set<DataType>(['integer', 'decimal'])
const TEMPORAL_TYPES = new Set<DataType>(['date', 'datetime'])

/**
 * Relationship keys must be exact-match comparable. Same type is always
 * compatible; integer/decimal and date/datetime are treated as the same
 * "family" (matching the widening rules `inferType.ts` already uses for
 * column type inference). `null`/`unknown` are never compatible with
 * anything, including each other, since a key column should never be
 * legitimately all-blank or unresolved.
 */
export function typesCompatible(a: DataType, b: DataType): boolean {
  if (a === 'null' || a === 'unknown' || b === 'null' || b === 'unknown') return false
  if (a === b) return true
  if (NUMERIC_TYPES.has(a) && NUMERIC_TYPES.has(b)) return true
  if (TEMPORAL_TYPES.has(a) && TEMPORAL_TYPES.has(b)) return true
  return false
}
