import type { DataType } from '../../domain/data'

export const TYPE_INFERENCE_SAMPLE_SIZE = 500

const INTEGER_PATTERN = /^[+-]?\d+$/
const DECIMAL_PATTERN = /^[+-]?\d+\.\d+$/
const BOOLEAN_PATTERN = /^(true|false)$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

/**
 * Classifies a single raw cell value. Accepts both raw CSV strings and the
 * native values SheetJS returns for Excel cells (number/boolean/Date), so the
 * same reducer in `inferColumnType` works for both importers.
 */
export function classifyValue(value: unknown): DataType {
  if (value === null || value === undefined) return 'null'

  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'null'
    return Number.isInteger(value) ? 'integer' : 'decimal'
  }

  if (typeof value === 'boolean') return 'boolean'

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return 'null'
    return 'datetime'
  }

  const raw = String(value).trim()
  if (raw === '') return 'null'
  if (BOOLEAN_PATTERN.test(raw)) return 'boolean'
  if (INTEGER_PATTERN.test(raw)) return 'integer'
  if (DECIMAL_PATTERN.test(raw)) return 'decimal'
  if (DATETIME_PATTERN.test(raw) && !Number.isNaN(Date.parse(raw))) return 'datetime'
  if (DATE_PATTERN.test(raw) && !Number.isNaN(Date.parse(raw))) return 'date'
  return 'string'
}

const NUMERIC_TYPES = new Set<DataType>(['integer', 'decimal'])
const TEMPORAL_TYPES = new Set<DataType>(['date', 'datetime'])

/**
 * Infers a single column type from a bounded sample of values rather than
 * trusting the first row. Falls back to `string` whenever the sample mixes
 * incompatible types, so destructive coercion never happens silently.
 */
export function inferColumnType(values: unknown[]): DataType {
  if (values.length === 0) return 'unknown'

  const sample = values.slice(0, TYPE_INFERENCE_SAMPLE_SIZE)
  const classifications = sample.map(classifyValue)
  const nonNull = classifications.filter((type) => type !== 'null')

  if (nonNull.length === 0) return 'null'

  const unique = new Set(nonNull)
  if (unique.size === 1) {
    const [only] = unique
    return only
  }

  if ([...unique].every((type) => NUMERIC_TYPES.has(type))) return 'decimal'
  if ([...unique].every((type) => TEMPORAL_TYPES.has(type))) return 'datetime'

  return 'string'
}

/**
 * Coerces a raw cell value into the storage representation for an inferred
 * column type. Dates are normalized to ISO strings so rows stay JSON/IndexedDB
 * friendly. Values that don't fit the inferred type are preserved as strings
 * rather than dropped, so import never silently loses data.
 */
export function coerceValue(value: unknown, dataType: DataType): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null

  switch (dataType) {
    case 'integer':
    case 'decimal': {
      const num = typeof value === 'number' ? value : Number(String(value).trim())
      return Number.isNaN(num) ? String(value) : num
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value
      const raw = String(value).trim().toLowerCase()
      if (raw === 'true') return true
      if (raw === 'false') return false
      return String(value)
    }
    case 'date': {
      const date = value instanceof Date ? value : new Date(String(value).trim())
      if (Number.isNaN(date.getTime())) return String(value)
      return date.toISOString().slice(0, 10)
    }
    case 'datetime': {
      const date = value instanceof Date ? value : new Date(String(value).trim())
      if (Number.isNaN(date.getTime())) return String(value)
      return date.toISOString()
    }
    case 'string':
    case 'null':
    case 'unknown':
    default: {
      const raw = value instanceof Date ? value.toISOString() : String(value).trim()
      return raw === '' ? null : raw
    }
  }
}
