import type { DataType } from '../../../domain/data'

export type TypeInferenceResult = { ok: true; dataType: DataType; nullable: boolean } | { ok: false }

/**
 * Shared by Conditional Column and Custom Column: both produce a value per
 * row from heterogeneous branches/expressions, so the output `DataType`
 * must be inferred from what was actually produced rather than declared
 * up front. A small promotion lattice (integer + decimal → decimal) is
 * allowed; anything else mixed (e.g. text and numbers) fails explicitly —
 * never silently coerced (AGENTS.md; sprint brief "never silently coerce
 * arbitrary objects").
 */
export function inferOutputType(values: unknown[]): TypeInferenceResult {
  const nonNull = values.filter((v) => v !== null && v !== undefined)
  const nullable = nonNull.length !== values.length

  if (nonNull.length === 0) return { ok: true, dataType: 'unknown', nullable: true }

  const categories = new Set<'boolean' | 'number' | 'string' | 'other'>()
  let allIntegers = true
  for (const value of nonNull) {
    if (typeof value === 'boolean') {
      categories.add('boolean')
    } else if (typeof value === 'number') {
      categories.add('number')
      if (!Number.isInteger(value)) allIntegers = false
    } else if (typeof value === 'string') {
      categories.add('string')
    } else {
      categories.add('other')
    }
  }

  if (categories.size > 1) return { ok: false }
  const [category] = categories

  if (category === 'boolean') return { ok: true, dataType: 'boolean', nullable }
  if (category === 'number') return { ok: true, dataType: allIntegers ? 'integer' : 'decimal', nullable }
  if (category === 'string') return { ok: true, dataType: 'string', nullable }
  return { ok: false }
}
