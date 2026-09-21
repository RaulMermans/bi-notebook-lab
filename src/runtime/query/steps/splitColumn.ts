import type { SplitColumnStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

/** Bounded to exactly two output columns (brief §29). A missing delimiter yields the whole value in the first output and `null` in the second. */
export function evaluateSplitColumn(frame: QueryFrame, step: SplitColumnStep): StepEvalResult {
  const source = frame.columns.find((c) => c.id === step.columnId)
  if (!source) {
    return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'The column to split no longer exists.', { stepId: step.id, details: { columnId: step.columnId } })] }
  }
  if (step.delimiter === '') {
    return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', 'A split delimiter cannot be empty.', { stepId: step.id })] }
  }

  const [nameA, nameB] = step.outputNames
  const existingNames = new Set(frame.columns.filter((c) => c.id !== source.id).map((c) => c.name.toLowerCase()))
  if (existingNames.has(nameA.toLowerCase()) || existingNames.has(nameB.toLowerCase()) || nameA.toLowerCase() === nameB.toLowerCase()) {
    return { diagnostics: [errorDiagnostic('QUERY_DUPLICATE_COLUMN_NAME', 'Split output names collide with an existing column.', { stepId: step.id })] }
  }

  const [idA, idB] = step.outputColumnIds
  const columnA = { id: idA, name: nameA, dataType: 'string' as const, nullable: true }
  const columnB = { id: idB, name: nameB, dataType: 'string' as const, nullable: true }

  const columns = step.removeSource
    ? [...frame.columns.filter((c) => c.id !== source.id), columnA, columnB]
    : [...frame.columns, columnA, columnB]

  const rows = frame.rows.map((row) => {
    const next: Record<string, unknown> = { ...row }
    const raw = row[source.name]
    if (raw === null || raw === undefined) {
      next[nameA] = null
      next[nameB] = null
    } else {
      const text = String(raw)
      const index = text.indexOf(step.delimiter)
      if (index === -1) {
        next[nameA] = text
        next[nameB] = null
      } else {
        next[nameA] = text.slice(0, index)
        next[nameB] = text.slice(index + step.delimiter.length)
      }
    }
    if (step.removeSource) delete next[source.name]
    return next
  })

  return { frame: { columns, rows }, diagnostics: [] }
}
