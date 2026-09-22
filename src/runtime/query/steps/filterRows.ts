import type { FilterRowsStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'
import { matchesCondition } from './scalarMatch'

export function evaluateFilterRows(frame: QueryFrame, step: FilterRowsStep): StepEvalResult {
  if (step.conditions.length === 0) {
    return { diagnostics: [errorDiagnostic('QUERY_INVALID_FILTER', 'A filter needs at least one condition.', { stepId: step.id })] }
  }

  const columnNames = new Map<string, string>()
  for (const condition of step.conditions) {
    const column = frame.columns.find((c) => c.id === condition.columnId)
    if (!column) {
      return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A filter references a column that no longer exists.', { stepId: step.id, details: { columnId: condition.columnId } })] }
    }
    columnNames.set(condition.columnId, column.name)
  }

  const rows = frame.rows.filter((row) => {
    const results = step.conditions.map((condition) => matchesCondition(row, columnNames.get(condition.columnId)!, condition))
    return step.logic === 'and' ? results.every(Boolean) : results.some(Boolean)
  })

  return { frame: { columns: frame.columns, rows }, diagnostics: [] }
}
