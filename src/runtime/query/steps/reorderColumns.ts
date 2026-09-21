import type { ReorderColumnsStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

/** Pure schema-order operation — column ids and row values are untouched. */
export function evaluateReorderColumns(frame: QueryFrame, step: ReorderColumnsStep): StepEvalResult {
  const missing = step.columnOrder.filter((id) => !frame.columns.some((c) => c.id === id))
  if (missing.length > 0) {
    return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A column in the reorder list no longer exists.', { stepId: step.id, details: { columnIds: missing } })] }
  }

  const orderIndex = new Map(step.columnOrder.map((id, index) => [id, index]))
  const columns = [...frame.columns].sort((a, b) => {
    const ai = orderIndex.has(a.id) ? orderIndex.get(a.id)! : Number.MAX_SAFE_INTEGER
    const bi = orderIndex.has(b.id) ? orderIndex.get(b.id)! : Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return 0
  })

  return { frame: { columns, rows: frame.rows }, diagnostics: [] }
}
