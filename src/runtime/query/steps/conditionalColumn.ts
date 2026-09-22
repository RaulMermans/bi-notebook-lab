import type { ConditionalColumnStep } from '../../../domain/query'
import { errorDiagnostic } from '../queryDiagnostics'
import type { QueryFrame } from '../queryFrame'
import type { StepEvalResult } from '../stepContext'
import { inferOutputType } from './inferOutputType'
import { matchesOperator } from './scalarMatch'

/** First matching clause wins, exactly like `if/then/elseif` — never "last match" or "all matches". */
export function evaluateConditionalColumn(frame: QueryFrame, step: ConditionalColumnStep): StepEvalResult {
  if (step.clauses.length === 0) {
    return { diagnostics: [errorDiagnostic('QUERY_INVALID_STEP_CONFIG', 'A conditional column needs at least one clause.', { stepId: step.id })] }
  }

  const existingNames = new Set(frame.columns.map((c) => c.name.toLowerCase()))
  if (existingNames.has(step.outputName.toLowerCase())) {
    return { diagnostics: [errorDiagnostic('QUERY_DUPLICATE_COLUMN_NAME', `A column named "${step.outputName}" already exists.`, { stepId: step.id })] }
  }

  const columnNames = new Map<string, string>()
  for (const clause of step.clauses) {
    const column = frame.columns.find((c) => c.id === clause.columnId)
    if (!column) {
      return { diagnostics: [errorDiagnostic('QUERY_COLUMN_NOT_FOUND', 'A conditional column clause references a column that no longer exists.', { stepId: step.id, details: { columnId: clause.columnId } })] }
    }
    columnNames.set(clause.columnId, column.name)
  }

  const values = frame.rows.map((row) => {
    for (const clause of step.clauses) {
      if (matchesOperator(row[columnNames.get(clause.columnId)!], clause.operator, clause.value)) return clause.result ?? null
    }
    return step.elseValue ?? null
  })

  const inferred = inferOutputType(values)
  if (!inferred.ok) {
    return {
      diagnostics: [
        errorDiagnostic('QUERY_CONDITIONAL_INVALID_RESULT_TYPE', 'This conditional column produces incompatible result types across its branches — use consistent types (e.g. always text, or always numbers).', {
          stepId: step.id,
        }),
      ],
    }
  }

  const outputColumn = { id: step.outputColumnId, name: step.outputName, dataType: inferred.dataType, nullable: inferred.nullable }
  const rows = frame.rows.map((row, i) => ({ ...row, [step.outputName]: values[i] }))

  return { frame: { columns: [...frame.columns, outputColumn], rows }, diagnostics: [] }
}
