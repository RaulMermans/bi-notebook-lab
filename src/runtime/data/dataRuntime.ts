import { DATA_LIMITS, type Dataset } from '../../domain/data'
import { DataImportError } from '../../lib/errors'
import { parseCsvText } from '../../lib/csv/parseCsv'
import { generateId } from '../../lib/ids'
import { generateRetailDataset } from '../../lib/sample/generateRetailDataset'
import { generateRelationshipLabDataset } from '../../lib/sample/generateRelationshipLabDataset'
import { generatePowerQueryLabDataset } from '../../lib/sample/generatePowerQueryLabDataset'

function tableNameFromFileName(fileName: string): string {
  return fileName.replace(/\.[^./]+$/, '') || fileName
}

function assertFileSize(file: File): void {
  if (file.size > DATA_LIMITS.maxFileSizeBytes) {
    const limitMb = Math.round(DATA_LIMITS.maxFileSizeBytes / (1024 * 1024))
    throw new DataImportError(
      'file-too-large',
      `"${file.name}" is larger than the ${limitMb} MB limit for this training environment.`,
    )
  }
}

export function isCsvFile(file: File): boolean {
  return /\.csv$/i.test(file.name)
}

export function isXlsxFile(file: File): boolean {
  return /\.xlsx?$/i.test(file.name)
}

export async function importCsvFile(file: File): Promise<Dataset> {
  if (!isCsvFile(file)) {
    throw new DataImportError('unsupported-file-type', `"${file.name}" is not a supported file type. Import a .csv or .xlsx file.`)
  }
  assertFileSize(file)

  const text = await file.text()
  const table = parseCsvText(text, tableNameFromFileName(file.name))

  return {
    id: generateId('dataset'),
    name: table.name,
    source: { type: 'csv', fileName: file.name },
    tables: [table],
    createdAt: new Date().toISOString(),
  }
}

export async function listWorkbookSheets(file: File): Promise<string[]> {
  if (!isXlsxFile(file)) {
    throw new DataImportError('unsupported-file-type', `"${file.name}" is not a supported file type. Import a .csv or .xlsx file.`)
  }
  assertFileSize(file)

  const { listXlsxSheets } = await import('../../lib/excel/parseExcel')
  const buffer = await file.arrayBuffer()
  return listXlsxSheets(buffer, file.name)
}

/**
 * Imports one Dataset per selected sheet, so a multi-sheet workbook adds one
 * DataCell per sheet to the notebook rather than a single dataset that
 * bundles unrelated tables together. The xlsx parser (a large dependency) is
 * loaded on demand so CSV-only sessions don't pay for it upfront.
 */
export async function importWorkbookSheets(file: File, sheetNames: string[]): Promise<Dataset[]> {
  assertFileSize(file)
  const { parseXlsxSheet } = await import('../../lib/excel/parseExcel')
  const buffer = await file.arrayBuffer()

  return sheetNames.map((sheetName) => {
    const table = parseXlsxSheet(buffer, file.name, sheetName)
    return {
      id: generateId('dataset'),
      name: table.name,
      source: { type: 'xlsx', fileName: file.name, sheetName },
      tables: [table],
      createdAt: new Date().toISOString(),
    }
  })
}

export function loadSampleRetailDataset(): Dataset[] {
  return generateRetailDataset()
}

export function loadSampleRelationshipLabDataset(): Dataset[] {
  return generateRelationshipLabDataset()
}

export function loadSamplePowerQueryLabDataset(): Dataset[] {
  return generatePowerQueryLabDataset()
}
