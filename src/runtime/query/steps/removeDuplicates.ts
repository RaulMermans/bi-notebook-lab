import type { RemoveDuplicatesStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

function keyFor(row: Record<string, unknown>, columnNames: string[]): string {
  return JSON.stringify(columnNames.map((name) => row[name] ?? null))
}

/** Retains the first occurrence deterministically, scanning rows in their existing order (brief §26). */
export function evaluateRemoveDuplicates(frame: QueryFrame, step: RemoveDuplicatesStep): StepEvalResult {
  let columnNames: string[]
  if (step.columnIds && step.columnIds.length > 0) {
    const missing = step.columnIds.filter((id) => !frame.columns.some((c) => c.id === id))
    if (missing.length > 0) {
      return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A duplicate-detection column no longer exists.', { stepId: step.id, details: { columnIds: missing } })] }
    }
    columnNames = step.columnIds.map((id) => frame.columns.find((c) => c.id === id)!.name)
  } else {
    columnNames = frame.columns.map((c) => c.name)
  }

  const seen = new Set<string>()
  const rows = frame.rows.filter((row) => {
    const key = keyFor(row, columnNames)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return { frame: { columns: frame.columns, rows }, diagnostics: [] }
}
