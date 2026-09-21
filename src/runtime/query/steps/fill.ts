import type { FillStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

/** Only `null`/`undefined` count as blank — `0`, `false`, `""` are real values and are never filled over (brief §28). */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined
}

export function evaluateFill(frame: QueryFrame, step: FillStep): StepEvalResult {
  const missing = step.columnIds.filter((id) => !frame.columns.some((c) => c.id === id))
  if (missing.length > 0) {
    return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A fill target column no longer exists.', { stepId: step.id, details: { columnIds: missing } })] }
  }

  const columnNames = step.columnIds.map((id) => frame.columns.find((c) => c.id === id)!.name)
  const rows = frame.rows.map((row) => ({ ...row }))
  const indices = step.direction === 'down' ? rows.map((_, i) => i) : rows.map((_, i) => rows.length - 1 - i)

  for (const name of columnNames) {
    let lastValue: unknown = null
    let hasLastValue = false
    for (const i of indices) {
      if (isBlank(rows[i][name])) {
        if (hasLastValue) rows[i][name] = lastValue
      } else {
        lastValue = rows[i][name]
        hasLastValue = true
      }
    }
  }

  return { frame: { columns: frame.columns, rows }, diagnostics: [] }
}
