import type { ReplaceValuesStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === null && b === null) return true
  return a === b
}

/** Reject a replacement value whose type is incompatible with the column's current type (brief §25) — e.g. an object literal into a numeric column. */
function isCompatible(dataType: string, replacement: unknown): boolean {
  if (replacement === null) return true
  switch (dataType) {
    case 'integer':
    case 'decimal':
      return typeof replacement === 'number'
    case 'boolean':
      return typeof replacement === 'boolean'
    case 'string':
    case 'date':
    case 'datetime':
      return typeof replacement === 'string'
    default:
      return true
  }
}

export function evaluateReplaceValues(frame: QueryFrame, step: ReplaceValuesStep): StepEvalResult {
  for (const replacement of step.replacements) {
    const column = frame.columns.find((c) => c.id === replacement.columnId)
    if (!column) {
      return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A replace-values target column no longer exists.', { stepId: step.id, details: { columnId: replacement.columnId } })] }
    }
    if (!isCompatible(column.dataType, replacement.replace)) {
      return {
        diagnostics: [
          errorDiagnostic('QUERY_INVALID_STEP_CONFIG', `Replacement value is not compatible with "${column.name}"'s type (${column.dataType}).`, { stepId: step.id }),
        ],
      }
    }
  }

  const rows = frame.rows.map((row) => ({ ...row }))

  for (const replacement of step.replacements) {
    const column = frame.columns.find((c) => c.id === replacement.columnId)!
    for (const row of rows) {
      if (valuesEqual(row[column.name], replacement.find)) {
        row[column.name] = replacement.replace
      }
    }
  }

  return { frame: { columns: frame.columns, rows }, diagnostics: [] }
}
