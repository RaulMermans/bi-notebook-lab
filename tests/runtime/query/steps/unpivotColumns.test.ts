import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../../src/domain/data'
import type { UnpivotColumnsStep } from '../../../../src/domain/query'
import type { QueryFrame } from '../../../../src/runtime/query/queryFrame'
import { evaluateUnpivotColumns } from '../../../../src/runtime/query/steps/unpivotColumns'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string'): DataColumn {
  return { id, name, dataType, nullable: true }
}

function frame(columns: DataColumn[], rows: Record<string, unknown>[]): QueryFrame {
  return { columns, rows }
}

const columns = [col('c1', 'Product'), col('c2', 'Jan', 'integer'), col('c3', 'Feb', 'integer'), col('c4', 'Mar', 'integer')]
const rows = [{ Product: 'A', Jan: 10, Feb: 20, Mar: 30 }]
const base = frame(columns, rows)

function step(overrides: Partial<UnpivotColumnsStep> = {}): UnpivotColumnsStep {
  return {
    id: 'u1',
    kind: 'unpivot-columns',
    name: 'Unpivoted Columns',
    mode: 'selected',
    columnIds: ['c2', 'c3', 'c4'],
    attributeColumnName: 'Month',
    attributeColumnId: 'attr1',
    valueColumnName: 'Value',
    valueColumnId: 'val1',
    ...overrides,
  }
}

describe('unpivot-columns', () => {
  it('unpivots the selected columns into attribute/value rows, one per unpivoted column', () => {
    const result = evaluateUnpivotColumns(base, step())
    expect(result.diagnostics).toEqual([])
    expect(result.frame?.rows).toEqual([
      { Product: 'A', Month: 'Jan', Value: 10 },
      { Product: 'A', Month: 'Feb', Value: 20 },
      { Product: 'A', Month: 'Mar', Value: 30 },
    ])
    expect(result.frame?.columns.map((c) => c.id)).toEqual(['c1', 'attr1', 'val1'])
  })

  it('unpivots "other columns" when mode is other-columns, keeping the selected columns as-is', () => {
    const result = evaluateUnpivotColumns(base, step({ mode: 'other-columns', columnIds: ['c1'] }))
    expect(result.frame?.rows).toEqual([
      { Product: 'A', Month: 'Jan', Value: 10 },
      { Product: 'A', Month: 'Feb', Value: 20 },
      { Product: 'A', Month: 'Mar', Value: 30 },
    ])
  })

  it('preserves untouched column ids exactly', () => {
    const result = evaluateUnpivotColumns(base, step())
    expect(result.frame?.columns.find((c) => c.name === 'Product')?.id).toBe('c1')
  })

  it('produces multiple rows per source row (O(rows × selectedColumns))', () => {
    const twoRows = frame(columns, [{ Product: 'A', Jan: 1, Feb: 2, Mar: 3 }, { Product: 'B', Jan: 4, Feb: 5, Mar: 6 }])
    const result = evaluateUnpivotColumns(twoRows, step())
    expect(result.frame?.rows).toHaveLength(6)
  })

  it('reports a missing column', () => {
    const result = evaluateUnpivotColumns(base, step({ columnIds: ['missing'] }))
    expect(result.diagnostics[0].code).toBe('QUERY_UNPIVOT_COLUMN_NOT_FOUND')
  })

  it('rejects attribute/value names that collide with a kept column', () => {
    const result = evaluateUnpivotColumns(base, step({ attributeColumnName: 'Product' }))
    expect(result.diagnostics[0].code).toBe('QUERY_DUPLICATE_COLUMN_NAME')
  })
})
