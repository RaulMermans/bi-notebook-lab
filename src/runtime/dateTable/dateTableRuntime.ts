import type { Dataset } from '../../domain/data'
import type { ColumnRef, DateTableDefinition, SemanticModel } from '../../domain/model'
import { resolveTableRef } from '../model/modelRuntime'
import { addDays, compareModelDates, formatModelDate, parseModelDate, type ModelDate } from './dateMath'
import type { DateTableDiagnostic, DateTableValidationResult } from './dateTableTypes'

function sameColumnRef(a: ColumnRef, b: ColumnRef): boolean {
  return a.datasetId === b.datasetId && a.tableId === b.tableId && a.columnId === b.columnId
}

export function getDateTableDefinition(model: SemanticModel, modelTableId: string): DateTableDefinition | undefined {
  return model.dateTables.find((dt) => dt.modelTableId === modelTableId)
}

/** Finds the `DateTableDefinition` (if any) whose canonical date column is exactly `column` — the check every Sprint 10 time-intelligence function uses to enforce sprint brief §16 ("marked Date Table requirement"). */
export function findDateTableDefinitionForColumn(model: SemanticModel, column: ColumnRef): DateTableDefinition | undefined {
  return model.dateTables.find((dt) => sameColumnRef(dt.dateColumn, column))
}

/**
 * Power BI-style Classic Date Table validation (sprint brief §6): the
 * referenced table/column must exist, be date/datetime typed, contain no
 * blanks, contain only unique dates, form a contiguous day-by-day calendar,
 * and (for `datetime`) use one consistent time-of-day. Never throws — every
 * failure is a structured `DateTableDiagnostic` (sprint brief §7).
 */
export function validateDateTableDefinition(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  modelTableId: string,
  dateColumn: ColumnRef,
): DateTableValidationResult {
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  if (!modelTable) {
    return {
      valid: false,
      diagnostics: [{ severity: 'error', code: 'DATE_TABLE_NOT_FOUND', message: 'The selected table is not part of this model.' }],
      rowCount: 0,
    }
  }

  const resolved = resolveTableRef(datasets, modelTable)
  if (!resolved) {
    return {
      valid: false,
      diagnostics: [{ severity: 'error', code: 'DATE_TABLE_NOT_FOUND', message: 'The selected table could not be resolved against its dataset.' }],
      rowCount: 0,
    }
  }

  const column = resolved.table.columns.find((c) => c.id === dateColumn.columnId)
  if (!column) {
    return {
      valid: false,
      diagnostics: [
        { severity: 'error', code: 'DATE_COLUMN_NOT_FOUND', message: `The selected date column no longer exists on "${resolved.table.name}".` },
      ],
      rowCount: resolved.table.rowCount,
    }
  }

  if (column.dataType !== 'date' && column.dataType !== 'datetime') {
    return {
      valid: false,
      diagnostics: [
        {
          severity: 'error',
          code: 'DATE_TABLE_INVALID_TYPE',
          message: `"${resolved.table.name}[${column.name}]" is ${column.dataType}, not date or datetime.`,
          details: { dataType: column.dataType },
        },
      ],
      rowCount: resolved.table.rowCount,
    }
  }

  const diagnostics: DateTableDiagnostic[] = []
  const rawValues = resolved.table.rows.map((row) => row[column.name])
  const blankCount = rawValues.filter((v) => v === null || v === undefined || v === '').length
  if (blankCount > 0) {
    diagnostics.push({
      severity: 'error',
      code: 'DATE_TABLE_DATE_HAS_BLANKS',
      message: `${blankCount} row(s) have a blank "${column.name}" value. A Date Table's date column may not contain blanks.`,
      details: { blankCount },
    })
  }

  const nonBlank = rawValues.filter((v): v is string => typeof v === 'string' && v !== '')

  if (column.dataType === 'datetime') {
    const timeComponents = new Set(nonBlank.map((v) => v.slice(10)))
    if (timeComponents.size > 1) {
      diagnostics.push({
        severity: 'error',
        code: 'DATE_TABLE_INCONSISTENT_TIME',
        message: `"${column.name}" contains ${timeComponents.size} different time-of-day components. A Date Table must use one consistent time component (e.g. always midnight).`,
        details: { distinctTimeComponents: timeComponents.size },
      })
    }
  }

  const dateStrings = nonBlank.map((v) => v.slice(0, 10))
  const seen = new Set<string>()
  let hasDuplicate = false
  for (const value of dateStrings) {
    if (seen.has(value)) {
      hasDuplicate = true
    } else {
      seen.add(value)
    }
  }
  if (hasDuplicate) {
    diagnostics.push({
      severity: 'error',
      code: 'DATE_TABLE_DATE_NOT_UNIQUE',
      message: `"${column.name}" contains duplicate dates. A Date Table's date column must be unique.`,
    })
  }

  const parsedDates = [...seen]
    .map(parseModelDate)
    .filter((d): d is ModelDate => d !== undefined)
    .sort(compareModelDates)

  let missingDate: string | undefined
  for (let i = 1; i < parsedDates.length; i += 1) {
    const expectedNext = addDays(parsedDates[i - 1], 1)
    if (compareModelDates(expectedNext, parsedDates[i]) !== 0) {
      missingDate = formatModelDate(expectedNext)
      break
    }
  }
  if (missingDate) {
    diagnostics.push({
      severity: 'error',
      code: 'DATE_TABLE_NOT_CONTIGUOUS',
      message: `"${column.name}" is missing ${missingDate} — a Date Table's dates must be contiguous, one row per calendar day.`,
      details: { missingDate },
    })
  }

  const valid = !diagnostics.some((d) => d.severity === 'error')
  return {
    valid,
    diagnostics,
    rowCount: resolved.table.rowCount,
    minDate: parsedDates[0] ? formatModelDate(parsedDates[0]) : undefined,
    maxDate: parsedDates.length > 0 ? formatModelDate(parsedDates[parsedDates.length - 1]) : undefined,
  }
}

export interface MarkDateTableResult {
  model: SemanticModel
  diagnostics: DateTableDiagnostic[]
}

/**
 * Validates and, only if valid, marks `modelTableId` as a Date Table with
 * `dateColumn` as its canonical date column — never partially applies an
 * invalid marking (sprint brief §9 "Do not allow invalid metadata to become
 * canonical"), mirroring `modelRuntime.createRelationship`'s validate-then-
 * apply shape.
 */
export function markDateTable(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  modelTableId: string,
  dateColumn: ColumnRef,
): MarkDateTableResult {
  const validation = validateDateTableDefinition(model, datasets, modelTableId, dateColumn)
  if (!validation.valid) {
    return { model, diagnostics: validation.diagnostics }
  }

  const definition: DateTableDefinition = { modelTableId, dateColumn }
  const dateTables = [...model.dateTables.filter((dt) => dt.modelTableId !== modelTableId), definition]
  return { model: { ...model, dateTables, updatedAt: new Date().toISOString() }, diagnostics: validation.diagnostics }
}

export function unmarkDateTable(model: SemanticModel, modelTableId: string): SemanticModel {
  const dateTables = model.dateTables.filter((dt) => dt.modelTableId !== modelTableId)
  if (dateTables.length === model.dateTables.length) return model
  return { ...model, dateTables, updatedAt: new Date().toISOString() }
}
