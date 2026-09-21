import type { DataType } from '../../../domain/data'
import type { ChangeTypeStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

const INTEGER_PATTERN = /^[+-]?\d+$/
const DECIMAL_PATTERN = /^[+-]?\d+(\.\d+)?$/
const BOOLEAN_PATTERN = /^(true|false)$/i
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/

const MAX_SAMPLE_VALUES = 5

/**
 * Deterministic, non-lossy conversion for a single value. Never uses
 * JavaScript loose coercion (`==`, unchecked `Number()`/`Boolean()`) — every
 * accepted shape is matched explicitly, and anything else fails rather than
 * silently becoming `0`/`false`/`NaN` (docs/APPLIED_STEPS.md "Change Type").
 */
export function convertValue(value: unknown, dataType: DataType): { ok: true; value: unknown } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, value: null }

  switch (dataType) {
    case 'string': {
      if (typeof value === 'string') return { ok: true, value }
      if (value instanceof Date) return { ok: true, value: value.toISOString() }
      return { ok: true, value: String(value) }
    }
    case 'integer': {
      if (typeof value === 'number') return Number.isInteger(value) ? { ok: true, value } : { ok: false }
      if (typeof value === 'string' && INTEGER_PATTERN.test(value.trim())) return { ok: true, value: Number(value.trim()) }
      return { ok: false }
    }
    case 'decimal': {
      if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value } : { ok: false }
      if (typeof value === 'string' && DECIMAL_PATTERN.test(value.trim())) return { ok: true, value: Number(value.trim()) }
      return { ok: false }
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value }
      if (typeof value === 'string' && BOOLEAN_PATTERN.test(value.trim())) return { ok: true, value: value.trim().toLowerCase() === 'true' }
      return { ok: false }
    }
    case 'date': {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? { ok: false } : { ok: true, value: value.toISOString().slice(0, 10) }
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (DATE_PATTERN.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return { ok: true, value: trimmed }
        if (DATETIME_PATTERN.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return { ok: true, value: trimmed.slice(0, 10) }
      }
      return { ok: false }
    }
    case 'datetime': {
      if (value instanceof Date) return Number.isNaN(value.getTime()) ? { ok: false } : { ok: true, value: value.toISOString() }
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (DATETIME_PATTERN.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return { ok: true, value: new Date(trimmed).toISOString() }
        if (DATE_PATTERN.test(trimmed) && !Number.isNaN(Date.parse(trimmed))) return { ok: true, value: new Date(trimmed).toISOString() }
      }
      return { ok: false }
    }
    case 'null':
    case 'unknown':
    default:
      return { ok: true, value }
  }
}

export function evaluateChangeType(frame: QueryFrame, step: ChangeTypeStep): StepEvalResult {
  for (const change of step.changes) {
    if (!frame.columns.some((c) => c.id === change.columnId)) {
      return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A column to convert no longer exists.', { stepId: step.id, details: { columnId: change.columnId } })] }
    }
  }

  const columns = frame.columns.map((c) => {
    const change = step.changes.find((ch) => ch.columnId === c.id)
    return change ? { ...c, dataType: change.dataType } : c
  })

  const rows: Record<string, unknown>[] = frame.rows.map((row) => ({ ...row }))

  for (const change of step.changes) {
    const column = frame.columns.find((c) => c.id === change.columnId)!
    const failures: { row: number; value: unknown }[] = []

    for (let i = 0; i < rows.length; i += 1) {
      const raw = rows[i][column.name]
      const result = convertValue(raw, change.dataType)
      if (!result.ok) {
        failures.push({ row: i, value: raw })
        continue
      }
      rows[i][column.name] = result.value
    }

    if (failures.length > 0) {
      const sampleValues = failures.slice(0, MAX_SAMPLE_VALUES).map((f) => f.value)
      return {
        diagnostics: [
          errorDiagnostic(
            'QUERY_TYPE_CONVERSION_FAILED',
            `${failures.length} value(s) in "${column.name}" could not convert to ${change.dataType}.`,
            { stepId: step.id, details: { column: column.name, dataType: change.dataType, sampleValues, failureCount: failures.length } },
          ),
        ],
      }
    }
  }

  return { frame: { columns, rows }, diagnostics: [] }
}
