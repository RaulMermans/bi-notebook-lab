import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../../src/domain/data'
import type { GroupByStep, MergeColumnsStep, SplitColumnStep } from '../../../../src/domain/query'
import type { QueryFrame } from '../../../../src/runtime/query/queryFrame'
import { evaluateGroupBy } from '../../../../src/runtime/query/steps/groupBy'
import { evaluateMergeColumns } from '../../../../src/runtime/query/steps/mergeColumns'
import { evaluateSplitColumn } from '../../../../src/runtime/query/steps/splitColumn'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string'): DataColumn {
  return { id, name, dataType, nullable: true }
}

function frame(columns: DataColumn[], rows: Record<string, unknown>[]): QueryFrame {
  return { columns, rows }
}

describe('split-column', () => {
  const columns = [col('c1', 'Code')]

  it('splits on a present delimiter into two stable-id columns', () => {
    const base = frame(columns, [{ Code: 'ABC-123' }])
    const step: SplitColumnStep = {
      id: 's1',
      kind: 'split-column',
      name: 'Split Column',
      columnId: 'c1',
      delimiter: '-',
      outputNames: ['Prefix', 'Number'],
      outputColumnIds: ['out1', 'out2'],
      removeSource: true,
    }
    const result = evaluateSplitColumn(base, step)
    expect(result.frame?.columns.map((c) => c.id)).toEqual(['out1', 'out2'])
    expect(result.frame?.rows[0]).toEqual({ Prefix: 'ABC', Number: '123' })
  })

  it('puts the whole value in output 1 and null in output 2 when the delimiter is absent', () => {
    const base = frame(columns, [{ Code: 'ABC' }])
    const step: SplitColumnStep = {
      id: 's1',
      kind: 'split-column',
      name: 'Split Column',
      columnId: 'c1',
      delimiter: '-',
      outputNames: ['Prefix', 'Number'],
      outputColumnIds: ['out1', 'out2'],
      removeSource: false,
    }
    const result = evaluateSplitColumn(base, step)
    expect(result.frame?.rows[0]).toEqual({ Code: 'ABC', Prefix: 'ABC', Number: null })
  })

  it('produces null/null for a null source value', () => {
    const base = frame(columns, [{ Code: null }])
    const step: SplitColumnStep = { id: 's1', kind: 'split-column', name: 'Split Column', columnId: 'c1', delimiter: '-', outputNames: ['A', 'B'], outputColumnIds: ['out1', 'out2'], removeSource: true }
    expect(evaluateSplitColumn(base, step).frame?.rows[0]).toEqual({ A: null, B: null })
  })

  it('rejects an output name that collides with an existing column', () => {
    const base = frame([col('c1', 'Code'), col('c2', 'Prefix')], [{ Code: 'A-1', Prefix: 'x' }])
    const step: SplitColumnStep = { id: 's1', kind: 'split-column', name: 'Split Column', columnId: 'c1', delimiter: '-', outputNames: ['Prefix', 'Number'], outputColumnIds: ['out1', 'out2'], removeSource: false }
    expect(evaluateSplitColumn(base, step).diagnostics[0].code).toBe('QUERY_DUPLICATE_COLUMN_NAME')
  })
})

describe('merge-columns', () => {
  it('combines columns with a delimiter using stable generated id, removing sources when asked', () => {
    const base = frame([col('c1', 'FirstName'), col('c2', 'LastName')], [{ FirstName: 'Raul', LastName: 'Mermans' }])
    const step: MergeColumnsStep = { id: 's1', kind: 'merge-columns', name: 'Merged Columns', columnIds: ['c1', 'c2'], delimiter: ' ', newColumnName: 'FullName', outputColumnId: 'out1', removeSource: true }
    const result = evaluateMergeColumns(base, step)
    expect(result.frame?.columns.map((c) => c.id)).toEqual(['out1'])
    expect(result.frame?.rows[0]).toEqual({ FullName: 'Raul Mermans' })
  })

  it('keeps source columns when removeSource is false', () => {
    const base = frame([col('c1', 'A'), col('c2', 'B')], [{ A: '1', B: '2' }])
    const step: MergeColumnsStep = { id: 's1', kind: 'merge-columns', name: 'Merged Columns', columnIds: ['c1', 'c2'], delimiter: '-', newColumnName: 'AB', outputColumnId: 'out1', removeSource: false }
    const result = evaluateMergeColumns(base, step)
    expect(result.frame?.rows[0]).toEqual({ A: '1', B: '2', AB: '1-2' })
  })
})

describe('group-by', () => {
  const columns = [col('c1', 'Country'), col('c2', 'Revenue', 'decimal')]
  const rows = [
    { Country: 'Spain', Revenue: 100 },
    { Country: 'Spain', Revenue: 200 },
    { Country: 'France', Revenue: 50 },
  ]
  const base = frame(columns, rows)

  it('groups by one key with Count Rows, Sum, Average, Min, Max', () => {
    const step: GroupByStep = {
      id: 's1',
      kind: 'group-by',
      name: 'Grouped Rows',
      groupColumnIds: ['c1'],
      aggregations: [
        { outputColumnId: 'a1', outputName: 'Count', function: 'count-rows' },
        { outputColumnId: 'a2', outputName: 'Total', function: 'sum', sourceColumnId: 'c2' },
        { outputColumnId: 'a3', outputName: 'Avg', function: 'average', sourceColumnId: 'c2' },
        { outputColumnId: 'a4', outputName: 'Min', function: 'min', sourceColumnId: 'c2' },
        { outputColumnId: 'a5', outputName: 'Max', function: 'max', sourceColumnId: 'c2' },
      ],
    }
    const result = evaluateGroupBy(base, step)
    const spain = result.frame?.rows.find((r) => r.Country === 'Spain')
    expect(spain).toEqual({ Country: 'Spain', Count: 2, Total: 300, Avg: 150, Min: 100, Max: 200 })
    expect(result.frame?.columns.map((c) => c.id)).toEqual(['c1', 'a1', 'a2', 'a3', 'a4', 'a5'])
  })

  it('groups by multiple keys', () => {
    const columns2 = [col('c1', 'Country'), col('c2', 'Category'), col('c3', 'Revenue', 'decimal')]
    const base2 = frame(columns2, [
      { Country: 'Spain', Category: 'A', Revenue: 10 },
      { Country: 'Spain', Category: 'B', Revenue: 20 },
      { Country: 'Spain', Category: 'A', Revenue: 5 },
    ])
    const step: GroupByStep = { id: 's1', kind: 'group-by', name: 'Grouped Rows', groupColumnIds: ['c1', 'c2'], aggregations: [{ outputColumnId: 'a1', outputName: 'Total', function: 'sum', sourceColumnId: 'c3' }] }
    const result = evaluateGroupBy(base2, step)
    expect(result.frame?.rows).toHaveLength(2)
    expect(result.frame?.rows.find((r) => r.Category === 'A')?.Total).toBe(15)
  })

  it('excludes nulls from numeric aggregation', () => {
    const columns2 = [col('c1', 'Country'), col('c2', 'Revenue', 'decimal')]
    const base2 = frame(columns2, [{ Country: 'Spain', Revenue: 10 }, { Country: 'Spain', Revenue: null }])
    const step: GroupByStep = { id: 's1', kind: 'group-by', name: 'Grouped Rows', groupColumnIds: ['c1'], aggregations: [{ outputColumnId: 'a1', outputName: 'Total', function: 'sum', sourceColumnId: 'c2' }] }
    expect(evaluateGroupBy(base2, step).frame?.rows[0].Total).toBe(10)
  })

  it('rejects SUM over a string column', () => {
    const columns2 = [col('c1', 'Country'), col('c2', 'Name', 'string')]
    const base2 = frame(columns2, [{ Country: 'Spain', Name: 'x' }])
    const step: GroupByStep = { id: 's1', kind: 'group-by', name: 'Grouped Rows', groupColumnIds: ['c1'], aggregations: [{ outputColumnId: 'a1', outputName: 'Total', function: 'sum', sourceColumnId: 'c2' }] }
    expect(evaluateGroupBy(base2, step).diagnostics[0].code).toBe('QUERY_INVALID_STEP_CONFIG')
  })

  it('produces results independently verifiable against the raw source', () => {
    const result = evaluateGroupBy(base, {
      id: 's1',
      kind: 'group-by',
      name: 'Grouped Rows',
      groupColumnIds: ['c1'],
      aggregations: [{ outputColumnId: 'a1', outputName: 'Total', function: 'sum', sourceColumnId: 'c2' }],
    })
    const expectedSpainTotal = rows.filter((r) => r.Country === 'Spain').reduce((sum, r) => sum + r.Revenue, 0)
    expect(result.frame?.rows.find((r) => r.Country === 'Spain')?.Total).toBe(expectedSpainTotal)
  })
})
