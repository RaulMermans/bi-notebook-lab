import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../../src/domain/data'
import type { IndexColumnStep } from '../../../../src/domain/query'
import type { QueryFrame } from '../../../../src/runtime/query/queryFrame'
import { evaluateIndexColumn } from '../../../../src/runtime/query/steps/indexColumn'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string'): DataColumn {
  return { id, name, dataType, nullable: true }
}

function frame(columns: DataColumn[], rows: Record<string, unknown>[]): QueryFrame {
  return { columns, rows }
}

const columns = [col('c1', 'Name')]
const rows = [{ Name: 'A' }, { Name: 'B' }, { Name: 'C' }]
const base = frame(columns, rows)

function step(overrides: Partial<IndexColumnStep> = {}): IndexColumnStep {
  return { id: 's1', kind: 'index-column', name: 'Added Index', outputColumnId: 'out1', outputName: 'Index', start: 0, increment: 1, ...overrides }
}

describe('index-column', () => {
  it('defaults to 0, 1, 2, ...', () => {
    expect(evaluateIndexColumn(base, step()).frame?.rows.map((r) => r.Index)).toEqual([0, 1, 2])
  })

  it('supports a custom start', () => {
    expect(evaluateIndexColumn(base, step({ start: 1 })).frame?.rows.map((r) => r.Index)).toEqual([1, 2, 3])
  })

  it('supports a custom increment', () => {
    expect(evaluateIndexColumn(base, step({ start: 10, increment: 10 })).frame?.rows.map((r) => r.Index)).toEqual([10, 20, 30])
  })

  it('generates the column with the stable pre-minted id and integer type', () => {
    const result = evaluateIndexColumn(base, step())
    expect(result.frame?.columns.find((c) => c.name === 'Index')).toEqual({ id: 'out1', name: 'Index', dataType: 'integer', nullable: false })
  })

  it.each([
    ['NaN start', { start: Number.NaN }],
    ['Infinity start', { start: Number.POSITIVE_INFINITY }],
    ['zero increment', { increment: 0 }],
  ])('rejects %s', (_label, overrides) => {
    expect(evaluateIndexColumn(base, step(overrides)).diagnostics[0].code).toBe('QUERY_INDEX_INVALID_CONFIG')
  })

  it('rejects an output name that collides with an existing column', () => {
    expect(evaluateIndexColumn(base, step({ outputName: 'Name' })).diagnostics[0].code).toBe('QUERY_DUPLICATE_COLUMN_NAME')
  })
})
