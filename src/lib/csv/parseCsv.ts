import Papa from 'papaparse'
import type { DataTable } from '../../domain/data'
import { buildDataTable } from '../buildDataTable'
import { DataImportError } from '../errors'

/**
 * Parses CSV text into a DataTable. Delegates the character-level grammar
 * (quoted fields, commas inside quotes, escaped quotes) to PapaParse and
 * keeps header normalization / type inference / limits in `buildDataTable`
 * so CSV and Excel share the same pipeline past this point.
 */
export function parseCsvText(text: string, tableName: string): DataTable {
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: 'greedy',
    header: false,
  })

  const criticalErrors = result.errors.filter((error) => error.type !== 'FieldMismatch')
  if (criticalErrors.length > 0 && result.data.length === 0) {
    throw new DataImportError('parse-failed', `Unable to parse "${tableName}": ${criticalErrors[0].message}.`)
  }

  const [headerRow, ...dataRows] = result.data
  if (!headerRow) {
    throw new DataImportError('empty-sheet', `"${tableName}" contains no rows.`)
  }

  return buildDataTable(tableName, { headers: headerRow, rows: dataRows })
}
