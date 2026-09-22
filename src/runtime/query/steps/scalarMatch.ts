import type { QueryFilterCondition, QueryFilterOperator } from '../../../domain/query'

/** Shared by Filter Rows and Conditional Column so the two never drift on what "equals"/"contains"/etc. mean (AGENTS.md "Do not duplicate inconsistent comparison logic"). */
export function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

export function compareScalars(value: unknown, target: unknown): number {
  if (value instanceof Date || target instanceof Date) {
    return new Date(value as string).getTime() - new Date(target as string).getTime()
  }
  if (typeof value === 'number' && typeof target === 'number') return value - target
  return String(value).localeCompare(String(target))
}

export function matchesOperator(value: unknown, operator: QueryFilterOperator, target: unknown): boolean {
  switch (operator) {
    case 'is-blank':
      return isBlank(value)
    case 'is-not-blank':
      return !isBlank(value)
    default:
      break
  }

  if (isBlank(value)) return false

  switch (operator) {
    case 'equals':
      return value === target || compareScalars(value, target) === 0
    case 'not-equals':
      return !(value === target || compareScalars(value, target) === 0)
    case 'greater-than':
      return compareScalars(value, target) > 0
    case 'greater-than-or-equal':
      return compareScalars(value, target) >= 0
    case 'less-than':
      return compareScalars(value, target) < 0
    case 'less-than-or-equal':
      return compareScalars(value, target) <= 0
    case 'contains':
      return String(value).toLowerCase().includes(String(target).toLowerCase())
    case 'starts-with':
      return String(value).toLowerCase().startsWith(String(target).toLowerCase())
    case 'ends-with':
      return String(value).toLowerCase().endsWith(String(target).toLowerCase())
    default:
      return false
  }
}

export function matchesCondition(row: Record<string, unknown>, columnName: string, condition: QueryFilterCondition): boolean {
  return matchesOperator(row[columnName], condition.operator, condition.value)
}
