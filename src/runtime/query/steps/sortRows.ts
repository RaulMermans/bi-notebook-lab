import type { SortRowsStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

/** Blank sorts first ascending / last descending — deterministic regardless of value type. */
function compareValues(a: unknown, b: unknown): number {
  const aBlank = a === null || a === undefined
  const bBlank = b === null || b === undefined
  if (aBlank && bBlank) return 0
  if (aBlank) return -1
  if (bBlank) return 1

  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  if (typeof a === 'number' && typeof b === 'number') return a - b

  const aDate = typeof a === 'string' && /^\d{4}-\d{2}-\d{2}/.test(a) ? Date.parse(a) : NaN
  const bDate = typeof b === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b) ? Date.parse(b) : NaN
  if (!Number.isNaN(aDate) && !Number.isNaN(bDate)) return aDate - bDate

  return String(a).localeCompare(String(b))
}

export function evaluateSortRows(frame: QueryFrame, step: SortRowsStep): StepEvalResult {
  if (step.keys.length === 0) {
    return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', 'A sort needs at least one key.', { stepId: step.id })] }
  }

  const keyNames: { name: string; direction: 'asc' | 'desc' }[] = []
  for (const key of step.keys) {
    const column = frame.columns.find((c) => c.id === key.columnId)
    if (!column) {
      return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A sort key column no longer exists.', { stepId: step.id, details: { columnId: key.columnId } })] }
    }
    keyNames.push({ name: column.name, direction: key.direction })
  }

  // Stable sort: rows keep their relative order for equal keys (Array.prototype.sort is stable since ES2019).
  const rows = [...frame.rows].sort((a, b) => {
    for (const key of keyNames) {
      const cmp = compareValues(a[key.name], b[key.name])
      if (cmp !== 0) return key.direction === 'asc' ? cmp : -cmp
    }
    return 0
  })

  return { frame: { columns: frame.columns, rows }, diagnostics: [] }
}
