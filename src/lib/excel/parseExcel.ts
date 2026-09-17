import * as XLSX from 'xlsx'
import type { DataTable } from '../../domain/data'
import { buildDataTable } from '../buildDataTable'
import { DataImportError } from '../errors'

function readWorkbook(buffer: ArrayBuffer, fileName: string): XLSX.WorkBook {
  try {
    return XLSX.read(buffer, { type: 'array', cellDates: true })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new DataImportError('parse-failed', `Unable to parse "${fileName}": ${detail}.`)
  }
}

export function listXlsxSheets(buffer: ArrayBuffer, fileName: string): string[] {
  const workbook = readWorkbook(buffer, fileName)
  if (workbook.SheetNames.length === 0) {
    throw new DataImportError('empty-sheet', `"${fileName}" contains no sheets.`)
  }
  return workbook.SheetNames
}

export function parseXlsxSheet(buffer: ArrayBuffer, fileName: string, sheetName: string): DataTable {
  const workbook = readWorkbook(buffer, fileName)
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) {
    throw new DataImportError('parse-failed', `"${fileName}" has no sheet named "${sheetName}".`)
  }

  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  })

  const [headerRow, ...dataRows] = grid
  if (!headerRow) {
    throw new DataImportError('empty-sheet', `"${sheetName}" contains no rows.`)
  }

  const headers = headerRow.map((cell) => (cell === null ? '' : String(cell)))
  return buildDataTable(sheetName, { headers, rows: dataRows })
}
