import { describe, expect, it } from 'vitest'
import { parseCsvText } from '../../src/lib/csv/parseCsv'
import { DataImportError } from '../../src/lib/errors'

describe('parseCsvText', () => {
  it('parses standard CSV with headers and infers column types', () => {
    const csv = 'OrderID,Revenue,Country\n1,12.5,US\n2,20,CA\n'
    const table = parseCsvText(csv, 'Sales')

    expect(table.rowCount).toBe(2)
    expect(table.columns.map((c) => c.name)).toEqual(['OrderID', 'Revenue', 'Country'])
    expect(table.columns.find((c) => c.name === 'OrderID')?.dataType).toBe('integer')
    expect(table.columns.find((c) => c.name === 'Revenue')?.dataType).toBe('decimal')
    expect(table.columns.find((c) => c.name === 'Country')?.dataType).toBe('string')
  })

  it('handles commas inside quoted fields', () => {
    const csv = 'Name,City\n"Doe, John","New York"\n"Smith, Jane","Los Angeles"\n'
    const table = parseCsvText(csv, 'People')

    expect(table.rows[0].Name).toBe('Doe, John')
    expect(table.rows[0].City).toBe('New York')
  })

  it('treats blank values as null and marks the column nullable', () => {
    const csv = 'ID,Note\n1,hello\n2,\n3,world\n'
    const table = parseCsvText(csv, 'Notes')
    const note = table.columns.find((c) => c.name === 'Note')

    expect(note?.nullable).toBe(true)
    expect(table.rows[1].Note).toBeNull()
  })

  it('drops fully empty rows', () => {
    const csv = 'ID,Value\n1,10\n\n2,20\n'
    const table = parseCsvText(csv, 'Values')

    expect(table.rowCount).toBe(2)
  })

  it('falls back to string when a column mixes incompatible values', () => {
    const csv = 'Mixed\n1\n2\nhello\n4\n'
    const table = parseCsvText(csv, 'Mixed')

    expect(table.columns[0].dataType).toBe('string')
    expect(table.rows.map((r) => r.Mixed)).toEqual(['1', '2', 'hello', '4'])
  })

  it('throws a DataImportError for a file with no rows', () => {
    expect(() => parseCsvText('', 'Empty')).toThrow(DataImportError)
  })
})
