import { DATA_LIMITS, type DataColumn, type DataTable } from '../domain/data'
import { generateId } from './ids'
import { classifyValue, coerceValue, inferColumnType } from './profiling/inferType'
import { DataImportError } from './errors'

export interface RawTable {
  headers: string[]
  rows: unknown[][]
}

function isBlank(cell: unknown): boolean {
  return cell === null || cell === undefined || String(cell).trim() === ''
}

function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>()
  return headers.map((raw, index) => {
    const base = raw?.trim() || `Column${index + 1}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}_${count + 1}`
  })
}

/**
 * Shared table construction used by both the CSV and Excel importers: header
 * normalization, empty-row filtering, limit enforcement, type inference and
 * value coercion all happen here so the two importers only need to produce a
 * flat header/row grid.
 */
export function buildDataTable(name: string, raw: RawTable): DataTable {
  if (raw.headers.length === 0) {
    throw new DataImportError('empty-sheet', `"${name}" has no columns to import.`)
  }
  if (raw.headers.length > DATA_LIMITS.maxColumns) {
    throw new DataImportError(
      'too-many-columns',
      `"${name}" has ${raw.headers.length} columns, which exceeds the limit of ${DATA_LIMITS.maxColumns}.`,
    )
  }

  const headers = dedupeHeaders(raw.headers)
  const rows = raw.rows.filter((row) => row.some((cell) => !isBlank(cell)))

  if (rows.length === 0) {
    throw new DataImportError('empty-sheet', `"${name}" contains no rows.`)
  }
  if (rows.length > DATA_LIMITS.maxRowsPerTable) {
    throw new DataImportError(
      'too-many-rows',
      `"${name}" has ${rows.length} rows, which exceeds the limit of ${DATA_LIMITS.maxRowsPerTable} for this training environment.`,
    )
  }

  const columns: DataColumn[] = headers.map((columnName, columnIndex) => {
    const values = rows.map((row) => row[columnIndex])
    const dataType = inferColumnType(values)
    const nullable = values.some((value) => classifyValue(value) === 'null')
    return { id: generateId('col'), name: columnName, dataType, nullable }
  })

  const tableRows = rows.map((row) => {
    const record: Record<string, unknown> = {}
    columns.forEach((column, columnIndex) => {
      record[column.name] = coerceValue(row[columnIndex], column.dataType)
    })
    return record
  })

  return {
    id: generateId('table'),
    name,
    columns,
    rows: tableRows,
    rowCount: tableRows.length,
  }
}
