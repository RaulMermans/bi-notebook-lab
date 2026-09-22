import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../../src/domain/data'
import type { PivotColumnStep } from '../../../../src/domain/query'
import type { QueryFrame } from '../../../../src/runtime/query/queryFrame'
import { evaluatePivotColumn } from '../../../../src/runtime/query/steps/pivotColumn'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string'): DataColumn {
  return { id, name, dataType, nullable: true }
}

function frame(columns: DataColumn[], rows: Record<string, unknown>[]): QueryFrame {
  return { columns, rows }
}

const columns = [col('c1', 'Product'), col('c2', 'Month'), col('c3', 'Revenue', 'decimal')]
const rows = [
  { Product: 'A', Month: 'Jan', Revenue: 100 },
  { Product: 'A', Month: 'Feb', Revenue: 150 },
  { Product: 'B', Month: 'Jan', Revenue: 80 },
]
const base = frame(columns, rows)

function step(overrides: Partial<PivotColumnStep> = {}): PivotColumnStep {
  return { id: 'p1', kind: 'pivot-column', name: 'Pivoted Column', pivotColumnId: 'c2', valueColumnId: 'c3', aggregation: 'sum', ...overrides }
}

describe('pivot-column', () => {
  it('pivots a value column across the distinct values of a pivot column, grouping by every other column', () => {
    const result = evaluatePivotColumn(base, step())
    expect(result.diagnostics).toEqual([])
    const a = result.frame?.rows.find((r) => r.Product === 'A')
    const b = result.frame?.rows.find((r) => r.Product === 'B')
    expect(a).toEqual({ Product: 'A', Jan: 100, Feb: 150 })
    expect(b).toEqual({ Product: 'B', Jan: 80, Feb: null })
  })

  it('supports count/min/max/first aggregations', () => {
    const dupRows = [
      { Product: 'A', Month: 'Jan', Revenue: 100 },
      { Product: 'A', Month: 'Jan', Revenue: 200 },
    ]
    const dupBase = frame(columns, dupRows)
    expect(evaluatePivotColumn(dupBase, step({ aggregation: 'count' })).frame?.rows[0].Jan).toBe(2)
    expect(evaluatePivotColumn(dupBase, step({ aggregation: 'min' })).frame?.rows[0].Jan).toBe(100)
    expect(evaluatePivotColumn(dupBase, step({ aggregation: 'max' })).frame?.rows[0].Jan).toBe(200)
    expect(evaluatePivotColumn(dupBase, step({ aggregation: 'first' })).frame?.rows[0].Jan).toBe(100)
  })

  it('produces the same DataColumn.id for the same pivot value across independent evaluations', () => {
    const first = evaluatePivotColumn(base, step())
    const second = evaluatePivotColumn(base, step())
    const janIdFirst = first.frame?.columns.find((c) => c.name === 'Jan')?.id
    const janIdSecond = second.frame?.columns.find((c) => c.name === 'Jan')?.id
    expect(janIdFirst).toBeDefined()
    expect(janIdFirst).toBe(janIdSecond)
  })

  it('column identity does not depend on upstream row order', () => {
    const reordered = frame(columns, [...rows].reverse())
    const original = evaluatePivotColumn(base, step())
    const shuffled = evaluatePivotColumn(reordered, step())
    const originalJanId = original.frame?.columns.find((c) => c.name === 'Jan')?.id
    const shuffledJanId = shuffled.frame?.columns.find((c) => c.name === 'Jan')?.id
    expect(originalJanId).toBe(shuffledJanId)
  })

  it('a different step id produces a different column id for the same pivot value', () => {
    const stepA = step()
    const stepB = step({ id: 'p2' })
    const idA = evaluatePivotColumn(base, stepA).frame?.columns.find((c) => c.name === 'Jan')?.id
    const idB = evaluatePivotColumn(base, stepB).frame?.columns.find((c) => c.name === 'Jan')?.id
    expect(idA).not.toBe(idB)
  })

  it('rejects SUM over a non-numeric value column', () => {
    const stringCols = [col('c1', 'Product'), col('c2', 'Month'), col('c3', 'Note', 'string')]
    const result = evaluatePivotColumn(frame(stringCols, [{ Product: 'A', Month: 'Jan', Note: 'x' }]), step())
    expect(result.diagnostics[0].code).toBe('QUERY_PIVOT_AGGREGATION_INVALID')
  })

  it('reports a missing pivot or value column', () => {
    expect(evaluatePivotColumn(base, step({ pivotColumnId: 'missing' })).diagnostics[0].code).toBe('QUERY_COLUMN_NOT_FOUND')
    expect(evaluatePivotColumn(base, step({ valueColumnId: 'missing' })).diagnostics[0].code).toBe('QUERY_COLUMN_NOT_FOUND')
  })

  it('reports a schema collision when two distinct pivot values would produce the same output column name', () => {
    const mixedRows = [
      { Product: 'A', Month: 1, Revenue: 100 },
      { Product: 'A', Month: '1', Revenue: 200 },
    ]
    const result = evaluatePivotColumn(frame(columns, mixedRows), step())
    expect(result.diagnostics[0].code).toBe('QUERY_PIVOT_SCHEMA_COLLISION')
  })

  it('treats blank/null pivot values as their own bucket', () => {
    const withBlank = frame(columns, [...rows, { Product: 'A', Month: null, Revenue: 999 }])
    const result = evaluatePivotColumn(withBlank, step())
    const a = result.frame?.rows.find((r) => r.Product === 'A')
    expect(a?.['(blank)']).toBe(999)
  })
})
