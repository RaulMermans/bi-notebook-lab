import type { RenameColumnsStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

/** Preserves column ids — only `DataColumn.name` changes (docs/POWER_QUERY_RUNTIME.md "Stable column identity"). */
export function evaluateRenameColumns(frame: QueryFrame, step: RenameColumnsStep): StepEvalResult {
  for (const rename of step.renames) {
    if (!frame.columns.some((c) => c.id === rename.columnId)) {
      return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', `Column no longer exists.`, { stepId: step.id, details: { columnId: rename.columnId } })] }
    }
    if (rename.newName.trim() === '') {
      return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', 'A new column name cannot be blank.', { stepId: step.id })] }
    }
  }

  const nextNames = new Map(frame.columns.map((c) => [c.id, c.name]))
  for (const rename of step.renames) nextNames.set(rename.columnId, rename.newName)

  const seen = new Set<string>()
  for (const name of nextNames.values()) {
    const lower = name.toLowerCase()
    if (seen.has(lower)) {
      return { diagnostics: [errorDiagnostic('QUERY_DUPLICATE_COLUMN_NAME', `More than one column would be named "${name}".`, { stepId: step.id })] }
    }
    seen.add(lower)
  }

  const columns = frame.columns.map((c) => ({ ...c, name: nextNames.get(c.id) ?? c.name }))
  const renameMap = new Map(step.renames.map((r) => [frame.columns.find((c) => c.id === r.columnId)!.name, nextNames.get(r.columnId)!]))
  const rows = frame.rows.map((row) => {
    const next: Record<string, unknown> = { ...row }
    for (const [oldName, newName] of renameMap) {
      if (oldName === newName) continue
      next[newName] = row[oldName]
      delete next[oldName]
    }
    return next
  })

  return { frame: { columns, rows }, diagnostics: [] }
}
