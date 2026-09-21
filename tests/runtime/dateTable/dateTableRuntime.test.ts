import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { buildDataTable } from '../../../src/lib/buildDataTable'
import {
  findDateTableDefinitionForColumn,
  getDateTableDefinition,
  markDateTable,
  unmarkDateTable,
  validateDateTableDefinition,
} from '../../../src/runtime/dateTable/dateTableRuntime'
import { addTable, createModel, removeTable } from '../../../src/runtime/model/modelRuntime'

function contiguousDates(start: string, count: number): string[] {
  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00.000Z`)
  for (let i = 0; i < count; i += 1) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function datasetFromTable(id: string, tableId: string, dates: (string | null)[]): Dataset {
  const table = buildDataTable(tableId, { headers: ['Date', 'Row'], rows: dates.map((d, i) => [d, i]) })
  return { id, name: tableId, source: { type: 'sample', key: id }, tables: [table], createdAt: new Date().toISOString() }
}

describe('dateTableRuntime — validateDateTableDefinition', () => {
  it('accepts a valid, contiguous, unique calendar', () => {
    const dates = contiguousDates('2024-01-01', 365)
    const ds = datasetFromTable('calendar-ds', 'Calendar', dates)
    const datasets = { [ds.id]: ds }
    let model = createModel('m')
    model = addTable(model, { datasetId: ds.id, tableId: ds.tables[0].id })
    const modelTableId = model.tables[0].id
    const dateColumn = { datasetId: ds.id, tableId: ds.tables[0].id, columnId: ds.tables[0].columns[0].id }

    const result = validateDateTableDefinition(model, datasets, modelTableId, dateColumn)
    expect(result.valid).toBe(true)
    expect(result.diagnostics).toEqual([])
    expect(result.minDate).toBe(dates[0])
    expect(result.maxDate).toBe(dates[dates.length - 1])
  })

  it('rejects a duplicate date with DATE_TABLE_DATE_NOT_UNIQUE', () => {
    const dates = [...contiguousDates('2024-01-01', 5), '2024-01-01']
    const ds = datasetFromTable('calendar-ds', 'Calendar', dates)
    const datasets = { [ds.id]: ds }
    let model = createModel('m')
    model = addTable(model, { datasetId: ds.id, tableId: ds.tables[0].id })
    const dateColumn = { datasetId: ds.id, tableId: ds.tables[0].id, columnId: ds.tables[0].columns[0].id }

    const result = validateDateTableDefinition(model, datasets, model.tables[0].id, dateColumn)
    expect(result.valid).toBe(false)
    expect(result.diagnostics.map((d) => d.code)).toContain('DATE_TABLE_DATE_NOT_UNIQUE')
  })

  it('rejects a blank date with DATE_TABLE_DATE_HAS_BLANKS', () => {
    const dates = [...contiguousDates('2024-01-01', 4), null]
    const ds = datasetFromTable('calendar-ds', 'Calendar', dates)
    const datasets = { [ds.id]: ds }
    let model = createModel('m')
    model = addTable(model, { datasetId: ds.id, tableId: ds.tables[0].id })
    const dateColumn = { datasetId: ds.id, tableId: ds.tables[0].id, columnId: ds.tables[0].columns[0].id }

    const result = validateDateTableDefinition(model, datasets, model.tables[0].id, dateColumn)
    expect(result.valid).toBe(false)
    expect(result.diagnostics.map((d) => d.code)).toContain('DATE_TABLE_DATE_HAS_BLANKS')
  })

  it('rejects a missing day with DATE_TABLE_NOT_CONTIGUOUS', () => {
    const dates = ['2025-01-01', '2025-01-02', '2025-01-04']
    const ds = datasetFromTable('calendar-ds', 'Calendar', dates)
    const datasets = { [ds.id]: ds }
    let model = createModel('m')
    model = addTable(model, { datasetId: ds.id, tableId: ds.tables[0].id })
    const dateColumn = { datasetId: ds.id, tableId: ds.tables[0].id, columnId: ds.tables[0].columns[0].id }

    const result = validateDateTableDefinition(model, datasets, model.tables[0].id, dateColumn)
    expect(result.valid).toBe(false)
    expect(result.diagnostics.map((d) => d.code)).toContain('DATE_TABLE_NOT_CONTIGUOUS')
    expect(result.diagnostics.find((d) => d.code === 'DATE_TABLE_NOT_CONTIGUOUS')?.details).toEqual({ missingDate: '2025-01-03' })
  })

  it('rejects a string-typed column with DATE_TABLE_INVALID_TYPE', () => {
    const table = buildDataTable('Calendar', { headers: ['Date', 'Label'], rows: [['not-a-date', 'x'], ['also-not', 'y']] })
    const ds: Dataset = { id: 'calendar-ds', name: 'Calendar', source: { type: 'sample', key: 'calendar' }, tables: [table], createdAt: new Date().toISOString() }
    const datasets = { [ds.id]: ds }
    let model = createModel('m')
    model = addTable(model, { datasetId: ds.id, tableId: ds.tables[0].id })
    const dateColumn = { datasetId: ds.id, tableId: ds.tables[0].id, columnId: ds.tables[0].columns[0].id }

    const result = validateDateTableDefinition(model, datasets, model.tables[0].id, dateColumn)
    expect(result.valid).toBe(false)
    expect(result.diagnostics.map((d) => d.code)).toContain('DATE_TABLE_INVALID_TYPE')
  })

  it('rejects a datetime column with an inconsistent time-of-day component', () => {
    const table = buildDataTable('Calendar', {
      headers: ['Date', 'Row'],
      rows: [
        ['2025-01-01T08:00:00', 1],
        ['2025-01-02', 2],
      ],
    })
    expect(table.columns[0].dataType).toBe('datetime')
    const ds: Dataset = { id: 'calendar-ds', name: 'Calendar', source: { type: 'sample', key: 'calendar' }, tables: [table], createdAt: new Date().toISOString() }
    const datasets = { [ds.id]: ds }
    let model = createModel('m')
    model = addTable(model, { datasetId: ds.id, tableId: ds.tables[0].id })
    const dateColumn = { datasetId: ds.id, tableId: ds.tables[0].id, columnId: ds.tables[0].columns[0].id }

    const result = validateDateTableDefinition(model, datasets, model.tables[0].id, dateColumn)
    expect(result.valid).toBe(false)
    expect(result.diagnostics.map((d) => d.code)).toContain('DATE_TABLE_INCONSISTENT_TIME')
  })
})

describe('dateTableRuntime — marking', () => {
  function validFixture() {
    const dates = contiguousDates('2024-01-01', 30)
    const ds = datasetFromTable('calendar-ds', 'Calendar', dates)
    const datasets = { [ds.id]: ds }
    let model = createModel('m')
    model = addTable(model, { datasetId: ds.id, tableId: ds.tables[0].id })
    const modelTableId = model.tables[0].id
    const dateColumn = { datasetId: ds.id, tableId: ds.tables[0].id, columnId: ds.tables[0].columns[0].id }
    return { model, datasets, modelTableId, dateColumn }
  }

  it('marks a valid table as a Date Table', () => {
    const { model, datasets, modelTableId, dateColumn } = validFixture()
    const result = markDateTable(model, datasets, modelTableId, dateColumn)
    expect(result.diagnostics).toEqual([])
    expect(getDateTableDefinition(result.model, modelTableId)).toEqual({ modelTableId, dateColumn })
    expect(findDateTableDefinitionForColumn(result.model, dateColumn)?.modelTableId).toBe(modelTableId)
  })

  it('never marks an invalid table (sprint brief §9)', () => {
    const dates = ['2025-01-01', '2025-01-02', '2025-01-04']
    const ds = datasetFromTable('calendar-ds', 'Calendar', dates)
    const datasets = { [ds.id]: ds }
    let model = createModel('m')
    model = addTable(model, { datasetId: ds.id, tableId: ds.tables[0].id })
    const dateColumn = { datasetId: ds.id, tableId: ds.tables[0].id, columnId: ds.tables[0].columns[0].id }

    const result = markDateTable(model, datasets, model.tables[0].id, dateColumn)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.model.dateTables).toEqual([])
    expect(getDateTableDefinition(result.model, model.tables[0].id)).toBeUndefined()
  })

  it('unmarks a Date Table', () => {
    const { model, datasets, modelTableId, dateColumn } = validFixture()
    const marked = markDateTable(model, datasets, modelTableId, dateColumn).model
    const unmarked = unmarkDateTable(marked, modelTableId)
    expect(getDateTableDefinition(unmarked, modelTableId)).toBeUndefined()
  })

  it('removing a marked Date Table also removes its DateTableDefinition (no dangling metadata, sprint brief §11)', () => {
    const { model, datasets, modelTableId, dateColumn } = validFixture()
    const marked = markDateTable(model, datasets, modelTableId, dateColumn).model
    expect(marked.dateTables).toHaveLength(1)

    const afterRemoval = removeTable(marked, modelTableId)
    expect(afterRemoval.dateTables).toEqual([])
  })
})
