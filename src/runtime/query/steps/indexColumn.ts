import type { IndexColumnStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

/** O(rows). Rejects non-finite start/increment and a zero increment (brief §5: "unless zero-increment behavior is explicitly justified" — it never is here). */
export function evaluateIndexColumn(frame: QueryFrame, step: IndexColumnStep): StepEvalResult {
  if (!Number.isFinite(step.start) || !Number.isFinite(step.increment) || step.increment === 0) {
    return { diagnostics: [errorDiagnostic('QUERY_INDEX_INVALID_CONFIG', 'Index Column requires finite start/increment values, and the increment cannot be zero.', { stepId: step.id })] }
  }

  const existingNames = new Set(frame.columns.map((c) => c.name.toLowerCase()))
  if (existingNames.has(step.outputName.toLowerCase())) {
    return { diagnostics: [errorDiagnostic('QUERY_DUPLICATE_COLUMN_NAME', `A column named "${step.outputName}" already exists.`, { stepId: step.id })] }
  }

  const dataType = Number.isInteger(step.start) && Number.isInteger(step.increment) ? ('integer' as const) : ('decimal' as const)
  const outputColumn = { id: step.outputColumnId, name: step.outputName, dataType, nullable: false }
  const rows = frame.rows.map((row, i) => ({ ...row, [step.outputName]: step.start + i * step.increment }))

  return { frame: { columns: [...frame.columns, outputColumn], rows }, diagnostics: [] }
}
