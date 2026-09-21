import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { DateTableValidationRule } from '../../../src/domain/validation'
import { markDateTable } from '../../../src/runtime/dateTable/dateTableRuntime'
import { addTable, createModel } from '../../../src/runtime/model/modelRuntime'
import { evaluateDateTableRule } from '../../../src/runtime/validation/dateTableValidationRule'

function contiguousDates(start: string, count: number): string[] {
  const dates: string[] = []
  const cursor = new Date(`${start}T00:00:00.000Z`)
  for (let i = 0; i < count; i += 1) {
    dates.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return dates
}

function buildFixture() {
  const dates = contiguousDates('2024-01-01', 30)
  const ds: Dataset = {
    id: 'calendar-ds',
    name: 'Calendar',
    source: { type: 'sample', key: 'calendar' },
    tables: [
      {
        id: 'calendar-table',
        name: 'Calendar',
        columns: [{ id: 'cal-date', name: 'Date', dataType: 'date', nullable: false }],
        rows: dates.map((d) => ({ Date: d })),
        rowCount: dates.length,
      },
    ],
    createdAt: new Date().toISOString(),
  }
  const datasets = { [ds.id]: ds }
  let model = createModel('m')
  model = addTable(model, { datasetId: ds.id, tableId: 'calendar-table' })
  const modelTableId = model.tables[0].id
  const dateColumn = { datasetId: ds.id, tableId: 'calendar-table', columnId: 'cal-date' }
  return { model, datasets, modelTableId, dateColumn }
}

const rule: DateTableValidationRule = {
  id: 'rule-1',
  type: 'date-table',
  points: 10,
  title: 'Calendar is marked as a Date Table',
  table: { tableName: 'Calendar' },
  dateColumn: { table: { tableName: 'Calendar' }, columnName: 'Date' },
}

describe('evaluateDateTableRule', () => {
  it('fails when the table is not marked yet', () => {
    const { model, datasets } = buildFixture()
    const result = evaluateDateTableRule(rule, model, datasets)
    expect(result.status).toBe('failed')
    expect(result.pointsEarned).toBe(0)
  })

  it('passes once the table is marked with the expected column', () => {
    const { model, datasets, modelTableId, dateColumn } = buildFixture()
    const marked = markDateTable(model, datasets, modelTableId, dateColumn).model
    const result = evaluateDateTableRule(rule, marked, datasets)
    expect(result.status).toBe('passed')
    expect(result.pointsEarned).toBe(10)
  })

  it('fails (not errors) when the selector names a table the learner has not added yet', () => {
    const { model, datasets } = buildFixture()
    const badRule: DateTableValidationRule = { ...rule, table: { tableName: 'Nonexistent' } }
    const result = evaluateDateTableRule(badRule, model, datasets)
    expect(result.status).toBe('failed')
  })
})
