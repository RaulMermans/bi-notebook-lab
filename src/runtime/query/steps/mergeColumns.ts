import type { MergeColumnsStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

export function evaluateMergeColumns(frame: QueryFrame, step: MergeColumnsStep): StepEvalResult {
  if (step.columnIds.length < 2) {
    return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', 'Merge Columns needs at least two source columns.', { stepId: step.id })] }
  }
  const missing = step.columnIds.filter((id) => !frame.columns.some((c) => c.id === id))
  if (missing.length > 0) {
    return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A merge-columns source column no longer exists.', { stepId: step.id, details: { columnIds: missing } })] }
  }
  if (step.newColumnName.trim() === '') {
    return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', 'The merged column needs a name.', { stepId: step.id })] }
  }

  const sourceNames = step.columnIds.map((id) => frame.columns.find((c) => c.id === id)!.name)
  const remainingIfRemoved = frame.columns.filter((c) => !step.columnIds.includes(c.id))
  const collisionTarget = step.removeSource ? remainingIfRemoved : frame.columns
  if (collisionTarget.some((c) => c.name.toLowerCase() === step.newColumnName.toLowerCase())) {
    return { diagnostics: [errorDiagnostic('QUERY_DUPLICATE_COLUMN_NAME', `A column named "${step.newColumnName}" already exists.`, { stepId: step.id })] }
  }

  const newColumn = { id: step.outputColumnId, name: step.newColumnName, dataType: 'string' as const, nullable: false }
  const columns = step.removeSource ? [...remainingIfRemoved, newColumn] : [...frame.columns, newColumn]

  const rows = frame.rows.map((row) => {
    const next: Record<string, unknown> = { ...row }
    next[step.newColumnName] = sourceNames.map((name) => formatCell(row[name])).join(step.delimiter)
    if (step.removeSource) {
      for (const name of sourceNames) delete next[name]
    }
    return next
  })

  return { frame: { columns, rows }, diagnostics: [] }
}
