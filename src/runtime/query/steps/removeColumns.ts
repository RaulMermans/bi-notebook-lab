import type { RemoveColumnsStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

/** Preserves the remaining columns' ids and relative order (docs/POWER_QUERY_RUNTIME.md "Stable column identity"). */
export function evaluateRemoveColumns(frame: QueryFrame, step: RemoveColumnsStep): StepEvalResult {
  const missing = step.columnIds.filter((id) => !frame.columns.some((c) => c.id === id))
  if (missing.length > 0) {
    return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A column to remove no longer exists.', { stepId: step.id, details: { columnIds: missing } })] }
  }

  const removeIds = new Set(step.columnIds)
  const removeNames = new Set(frame.columns.filter((c) => removeIds.has(c.id)).map((c) => c.name))
  const columns = frame.columns.filter((c) => !removeIds.has(c.id))

  if (columns.length === 0) {
    return { diagnostics: [errorDiagnostic('QUERY_NO_COLUMNS', 'Removing these columns would leave the table with no columns.', { stepId: step.id })] }
  }

  const rows = frame.rows.map((row) => {
    const next: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (!removeNames.has(key)) next[key] = value
    }
    return next
  })

  return { frame: { columns, rows }, diagnostics: [] }
}
