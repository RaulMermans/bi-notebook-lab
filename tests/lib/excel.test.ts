import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import { DataImportError } from '../../src/lib/errors'
import { listXlsxSheets, parseXlsxSheet } from '../../src/lib/excel/parseExcel'

function buildWorkbookBuffer(sheets: Record<string, unknown[][]>): ArrayBuffer {
  const workbook = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = XLSX.utils.aoa_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, sheet, name)
  }
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' })
}

describe('listXlsxSheets', () => {
  it('lists every sheet in the workbook', () => {
    const buffer = buildWorkbookBuffer({
      Sales: [['OrderID', 'Revenue'], [1, 10]],
      Notes: [['Text'], ['hi']],
    })

    expect(listXlsxSheets(buffer, 'wb.xlsx')).toEqual(['Sales', 'Notes'])
  })
})

describe('parseXlsxSheet', () => {
  it('parses a sheet into a DataTable with inferred types', () => {
    const buffer = buildWorkbookBuffer({
      Sales: [
        ['OrderID', 'Revenue', 'Country'],
        [1, 12.5, 'US'],
        [2, 20, 'CA'],
      ],
    })

    const table = parseXlsxSheet(buffer, 'wb.xlsx', 'Sales')

    expect(table.rowCount).toBe(2)
    expect(table.columns.find((c) => c.name === 'OrderID')?.dataType).toBe('integer')
    expect(table.columns.find((c) => c.name === 'Revenue')?.dataType).toBe('decimal')
    expect(table.columns.find((c) => c.name === 'Country')?.dataType).toBe('string')
  })

  it('throws a DataImportError when the sheet has no data rows', () => {
    const buffer = buildWorkbookBuffer({ Empty: [['OnlyHeader']] })

    expect(() => parseXlsxSheet(buffer, 'wb.xlsx', 'Empty')).toThrow(DataImportError)
  })

  it('throws when the requested sheet does not exist', () => {
    const buffer = buildWorkbookBuffer({ Sales: [['A'], [1]] })

    expect(() => parseXlsxSheet(buffer, 'wb.xlsx', 'Missing')).toThrow(DataImportError)
  })
})
