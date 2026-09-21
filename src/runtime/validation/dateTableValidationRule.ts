import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { DateTableValidationRule } from '../../domain/validation'
import { getDateTableDefinition, validateDateTableDefinition } from '../dateTable/dateTableRuntime'
import { classifySelectorFailure, resolveColumnSelector, resolveTableSelector } from './selectorResolver'
import type { RuleEvaluationResult } from './types'

function configError(message: string): RuleEvaluationResult {
  return { status: 'error', pointsEarned: 0, feedback: [{ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message }] }
}

/**
 * Checks that `rule.table` is marked as a Date Table using exactly
 * `rule.dateColumn` as its canonical date column, and that the marking is
 * currently valid — never reimplements Date Table validation (reuses
 * `validateDateTableDefinition`, docs/VALIDATION_ENGINE.md "No independent
 * calculation oracle").
 */
export function evaluateDateTableRule(
  rule: DateTableValidationRule,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
): RuleEvaluationResult {
  const tableResolution = resolveTableSelector(model, datasets, rule.table)
  if (!tableResolution.ok) {
    if (classifySelectorFailure(tableResolution.error) === 'failed') {
      return { status: 'failed', pointsEarned: 0, feedback: [{ severity: 'error', code: 'DATE_TABLE_MISSING', message: tableResolution.error.message }] }
    }
    return configError(`Date Table rule "${rule.title}": ${tableResolution.error.message}`)
  }

  const columnResolution = resolveColumnSelector(model, datasets, rule.dateColumn)
  if (!columnResolution.ok) {
    return configError(`Date Table rule "${rule.title}": ${columnResolution.error.message}`)
  }

  const modelTableId = tableResolution.value.modelTable.id
  const definition = getDateTableDefinition(model, modelTableId)
  const expectedColumnRef = {
    datasetId: columnResolution.value.datasetId,
    tableId: columnResolution.value.tableId,
    columnId: columnResolution.value.columnId,
  }

  if (!definition) {
    return {
      status: 'failed',
      pointsEarned: 0,
      feedback: [
        {
          severity: 'error',
          code: 'DATE_TABLE_NOT_MARKED',
          message: `"${tableResolution.value.tableName}" is not marked as a Date Table yet.`,
          hint: `Mark "${tableResolution.value.tableName}" as a Date Table using "${tableResolution.value.tableName}[${columnResolution.value.columnName}]".`,
        },
      ],
    }
  }

  const matchesColumn =
    definition.dateColumn.datasetId === expectedColumnRef.datasetId &&
    definition.dateColumn.tableId === expectedColumnRef.tableId &&
    definition.dateColumn.columnId === expectedColumnRef.columnId

  if (!matchesColumn) {
    return {
      status: 'failed',
      pointsEarned: 0,
      feedback: [
        {
          severity: 'error',
          code: 'DATE_TABLE_WRONG_COLUMN',
          message: `"${tableResolution.value.tableName}" is marked as a Date Table, but not using "${tableResolution.value.tableName}[${columnResolution.value.columnName}]" as its date column.`,
        },
      ],
    }
  }

  const validation = validateDateTableDefinition(model, datasets, modelTableId, definition.dateColumn)
  if (!validation.valid) {
    return {
      status: 'failed',
      pointsEarned: 0,
      feedback: validation.diagnostics.map((d) => ({ severity: 'error' as const, code: d.code, message: d.message })),
      evidence: { validation },
    }
  }

  return {
    status: 'passed',
    pointsEarned: rule.points,
    feedback: [{ severity: 'success', code: 'DATE_TABLE_OK', message: `${rule.title} is correct.` }],
    evidence: { validation },
  }
}
