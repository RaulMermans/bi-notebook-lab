import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../../src/domain/data'
import type { ChangeTypeStep, RemoveColumnsStep, RenameColumnsStep, ReorderColumnsStep } from '../../../../src/domain/query'
import type { QueryFrame } from '../../../../src/runtime/query/queryFrame'
import { evaluateChangeType, convertValue } from '../../../../src/runtime/query/steps/changeType'
import { evaluateRemoveColumns } from '../../../../src/runtime/query/steps/removeColumns'
import { evaluateRenameColumns } from '../../../../src/runtime/query/steps/renameColumns'
import { evaluateReorderColumns } from '../../../../src/runtime/query/steps/reorderColumns'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string'): DataColumn {
  return { id, name, dataType, nullable: false }
}

function frame(columns: DataColumn[], rows: Record<string, unknown>[]): QueryFrame {
  return { columns, rows }
}

describe('rename-columns', () => {
  const base = frame([col('c1', 'customer_id'), col('c2', 'Name')], [{ customer_id: 1, Name: 'Ana' }])

  it('renames a column and preserves its id and row values', () => {
    const step: RenameColumnsStep = { id: 's1', kind: 'rename-columns', name: 'Renamed', renames: [{ columnId: 'c1', newName: 'CustomerID' }] }
    const result = evaluateRenameColumns(base, step)
    expect(result.diagnostics).toEqual([])
    expect(result.frame?.columns.find((c) => c.id === 'c1')?.name).toBe('CustomerID')
    expect(result.frame?.rows[0]).toEqual({ CustomerID: 1, Name: 'Ana' })
  })

  it('fails with QUERY_DUPLICATE_COLUMN_NAME when a rename collides', () => {
    const step: RenameColumnsStep = { id: 's1', kind: 'rename-columns', name: 'Renamed', renames: [{ columnId: 'c1', newName: 'Name' }] }
    const result = evaluateRenameColumns(base, step)
    expect(result.frame).toBeUndefined()
    expect(result.diagnostics[0].code).toBe('QUERY_DUPLICATE_COLUMN_NAME')
  })

  it('fails with QUERY_COLUMN_NOT_FOUND for a missing column', () => {
    const step: RenameColumnsStep = { id: 's1', kind: 'rename-columns', name: 'Renamed', renames: [{ columnId: 'missing', newName: 'X' }] }
    const result = evaluateRenameColumns(base, step)
    expect(result.diagnostics[0].code).toBe('QUERY_COLUMN_NOT_FOUND')
  })

  it('never mutates the source frame', () => {
    const step: RenameColumnsStep = { id: 's1', kind: 'rename-columns', name: 'Renamed', renames: [{ columnId: 'c1', newName: 'CustomerID' }] }
    evaluateRenameColumns(base, step)
    expect(base.columns[0].name).toBe('customer_id')
  })
})

describe('remove-columns', () => {
  const base = frame([col('c1', 'A'), col('c2', 'B'), col('c3', 'C')], [{ A: 1, B: 2, C: 3 }])

  it('removes columns, preserving remaining ids/order and row values', () => {
    const step: RemoveColumnsStep = { id: 's1', kind: 'remove-columns', name: 'Removed', columnIds: ['c2'] }
    const result = evaluateRemoveColumns(base, step)
    expect(result.frame?.columns.map((c) => c.id)).toEqual(['c1', 'c3'])
    expect(result.frame?.rows[0]).toEqual({ A: 1, C: 3 })
  })

  it('fails with QUERY_NO_COLUMNS when removing every column', () => {
    const step: RemoveColumnsStep = { id: 's1', kind: 'remove-columns', name: 'Removed', columnIds: ['c1', 'c2', 'c3'] }
    const result = evaluateRemoveColumns(base, step)
    expect(result.diagnostics[0].code).toBe('QUERY_NO_COLUMNS')
  })
})

describe('reorder-columns', () => {
  const base = frame([col('c1', 'OrderID'), col('c2', 'CustomerID'), col('c3', 'Date'), col('c4', 'Revenue')], [{ OrderID: 1, CustomerID: 2, Date: '2024-01-01', Revenue: 10 }])

  it('reorders columns without changing ids or row values', () => {
    const step: ReorderColumnsStep = { id: 's1', kind: 'reorder-columns', name: 'Reordered', columnOrder: ['c3', 'c1', 'c2', 'c4'] }
    const result = evaluateReorderColumns(base, step)
    expect(result.frame?.columns.map((c) => c.id)).toEqual(['c3', 'c1', 'c2', 'c4'])
    expect(result.frame?.rows).toEqual(base.rows)
  })
})

describe('change-type', () => {
  it('converts string -> integer, string -> decimal, integer -> decimal, boolean, date, datetime', () => {
    expect(convertValue('123', 'integer')).toEqual({ ok: true, value: 123 })
    expect(convertValue('123.4', 'decimal')).toEqual({ ok: true, value: 123.4 })
    expect(convertValue(123, 'decimal')).toEqual({ ok: true, value: 123 })
    expect(convertValue('true', 'boolean')).toEqual({ ok: true, value: true })
    expect(convertValue('2026-03-21', 'date')).toEqual({ ok: true, value: '2026-03-21' })
    expect(convertValue('2026-03-21T10:00:00Z', 'datetime')).toEqual({ ok: true, value: '2026-03-21T10:00:00.000Z' })
  })

  it('keeps blank/null as null regardless of target type', () => {
    expect(convertValue(null, 'integer')).toEqual({ ok: true, value: null })
    expect(convertValue(undefined, 'date')).toEqual({ ok: true, value: null })
  })

  it('fails a bad conversion instead of coercing to 0/false', () => {
    expect(convertValue('abc', 'integer').ok).toBe(false)
  })

  it('fails the step with QUERY_TYPE_CONVERSION_FAILED and sample offending values, without mutating the source table', () => {
    const source = frame([col('c1', 'Qty', 'string')], [{ Qty: '1' }, { Qty: 'abc' }, { Qty: '3' }])
    const step: ChangeTypeStep = { id: 's1', kind: 'change-type', name: 'Changed Type', changes: [{ columnId: 'c1', dataType: 'integer' }] }

    const result = evaluateChangeType(source, step)

    expect(result.frame).toBeUndefined()
    expect(result.diagnostics[0].code).toBe('QUERY_TYPE_CONVERSION_FAILED')
    expect(result.diagnostics[0].details?.sampleValues).toEqual(['abc'])
    expect(result.diagnostics[0].details?.failureCount).toBe(1)
    expect(source.rows[0].Qty).toBe('1')
  })
})
