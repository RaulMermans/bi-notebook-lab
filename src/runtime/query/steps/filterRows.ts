import type { FilterRowsStep, QueryFilterCondition } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

function compare(value: unknown, target: unknown): number {
  if (value instanceof Date || target instanceof Date) {
    return new Date(value as string).getTime() - new Date(target as string).getTime()
  }
  if (typeof value === 'number' && typeof target === 'number') return value - target
  return String(value).localeCompare(String(target))
}

function matchesCondition(row: Record<string, unknown>, columnName: string, condition: QueryFilterCondition): boolean {
  const value = row[columnName]

  switch (condition.operator) {
    case 'is-blank':
      return isBlank(value)
    case 'is-not-blank':
      return !isBlank(value)
    default:
      break
  }

  if (isBlank(value)) return false

  switch (condition.operator) {
    case 'equals':
      return value === condition.value || compare(value, condition.value) === 0
    case 'not-equals':
      return !(value === condition.value || compare(value, condition.value) === 0)
    case 'greater-than':
      return compare(value, condition.value) > 0
    case 'greater-than-or-equal':
      return compare(value, condition.value) >= 0
    case 'less-than':
      return compare(value, condition.value) < 0
    case 'less-than-or-equal':
      return compare(value, condition.value) <= 0
    case 'contains':
      return String(value).toLowerCase().includes(String(condition.value).toLowerCase())
    case 'starts-with':
      return String(value).toLowerCase().startsWith(String(condition.value).toLowerCase())
    case 'ends-with':
      return String(value).toLowerCase().endsWith(String(condition.value).toLowerCase())
    default:
      return false
  }
}

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
