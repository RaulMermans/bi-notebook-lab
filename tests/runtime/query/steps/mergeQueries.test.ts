import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../../src/domain/data'
import type { MergeJoinKind, MergeQueriesStep } from '../../../../src/domain/query'
import type { QueryFrame } from '../../../../src/runtime/query/queryFrame'
import { evaluateMergeQueries } from '../../../../src/runtime/query/steps/mergeQueries'
import type { StepContext } from '../../../../src/runtime/query/stepContext'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string'): DataColumn {
  return { id, name, dataType, nullable: true }
}

function frame(columns: DataColumn[], rows: Record<string, unknown>[]): QueryFrame {
  return { columns, rows }
}

const left = frame(
  [col('l1', 'ProductID', 'integer'), col('l2', 'Revenue', 'decimal')],
  [
    { ProductID: 1, Revenue: 100 },
    { ProductID: 2, Revenue: 200 },
    { ProductID: 2, Revenue: 50 },
    { ProductID: 99, Revenue: 5 },
  ],
)

const right = frame(
  [col('r1', 'ProductID', 'integer'), col('r2', 'ProductName', 'string')],
  [
    { ProductID: 1, ProductName: 'Widget' },
    { ProductID: 2, ProductName: 'Gadget' },
    { ProductID: 3, ProductName: 'Unused' },
  ],
)

function context(): StepContext {
  return {
    resolveSource: () => ({ ok: true, value: { columns: right.columns, rows: right.rows } }),
    maxRows: 100_000,
    maxColumns: 200,
  }
}

function mergeStep(joinKind: MergeJoinKind): MergeQueriesStep {
  return {
    id: 's1',
    kind: 'merge-queries',
    name: 'Merged Queries',
    right: { kind: 'query', queryId: 'right-query' },
    joinKind,
    leftKeys: ['l1'],
    rightKeys: ['r1'],
    expand: [{ rightColumnId: 'r2', outputColumnId: 'out1', outputName: 'ProductName' }],
  }
}

describe('merge-queries', () => {
  it('inner join keeps only matched rows and expands the right columns', () => {
    const result = evaluateMergeQueries(left, mergeStep('inner'), context())
    expect(result.frame?.rows).toHaveLength(3)
    expect(result.frame?.rows.every((r) => r.ProductName !== null)).toBe(true)
  })

  it('left outer keeps every left row, nulling expand columns when unmatched', () => {
    const result = evaluateMergeQueries(left, mergeStep('left-outer'), context())
    expect(result.frame?.rows).toHaveLength(4)
    expect(result.frame?.rows.find((r) => r.ProductID === 99)?.ProductName).toBeNull()
  })

  it('right outer includes every right row, including the unmatched one', () => {
    const result = evaluateMergeQueries(left, mergeStep('right-outer'), context())
    expect(result.frame?.rows.some((r) => r.ProductName === 'Unused' && r.ProductID === null)).toBe(true)
  })

  it('full outer includes both left-only and right-only rows', () => {
    const result = evaluateMergeQueries(left, mergeStep('full-outer'), context())
    expect(result.frame?.rows.some((r) => r.ProductID === 99)).toBe(true)
    expect(result.frame?.rows.some((r) => r.ProductName === 'Unused')).toBe(true)
  })

  it('left anti keeps only unmatched left rows', () => {
    const result = evaluateMergeQueries(left, mergeStep('left-anti'), context())
    expect(result.frame?.rows).toEqual([{ ProductID: 99, Revenue: 5, ProductName: null }])
  })

  it('right anti keeps only unmatched right rows', () => {
    const result = evaluateMergeQueries(left, mergeStep('right-anti'), context())
    expect(result.frame?.rows.length).toBe(1)
    expect(result.frame?.rows[0].ProductName).toBe('Unused')
  })

  it('produces a row for every matching pair on a duplicate key (row explosion)', () => {
    const result = evaluateMergeQueries(left, mergeStep('inner'), context())
    const gadgetRows = result.frame?.rows.filter((r) => r.ProductID === 2)
    expect(gadgetRows).toHaveLength(2)
  })

  it('never matches null keys', () => {
    const leftWithNull = frame(left.columns, [...left.rows, { ProductID: null, Revenue: 1 }])
    const result = evaluateMergeQueries(leftWithNull, mergeStep('left-anti'), context())
    expect(result.frame?.rows.some((r) => r.ProductID === null)).toBe(true)
  })

  it('supports multi-column keys', () => {
    const l = frame([col('l1', 'Country'), col('l2', 'ProductID', 'integer')], [{ Country: 'ES', ProductID: 1 }])
    const r = frame([col('r1', 'Country'), col('r2', 'ProductID', 'integer'), col('r3', 'Label')], [{ Country: 'ES', ProductID: 1, Label: 'match' }, { Country: 'FR', ProductID: 1, Label: 'no' }])
    const ctx: StepContext = { resolveSource: () => ({ ok: true, value: { columns: r.columns, rows: r.rows } }), maxRows: 1000, maxColumns: 100 }
    const step: MergeQueriesStep = {
      id: 's1',
      kind: 'merge-queries',
      name: 'Merged Queries',
      right: { kind: 'query', queryId: 'r' },
      joinKind: 'inner',
      leftKeys: ['l1', 'l2'],
      rightKeys: ['r1', 'r2'],
      expand: [{ rightColumnId: 'r3', outputColumnId: 'out1', outputName: 'Label' }],
    }
    const result = evaluateMergeQueries(l, step, ctx)
    expect(result.frame?.rows).toEqual([{ Country: 'ES', ProductID: 1, Label: 'match' }])
  })

  it('fails with QUERY_JOIN_KEY_TYPE_MISMATCH for incompatible key types', () => {
    const l = frame([col('l1', 'ID', 'string')], [{ ID: '1' }])
    const r = frame([col('r1', 'ID', 'integer')], [{ ID: 1 }])
    const ctx: StepContext = { resolveSource: () => ({ ok: true, value: { columns: r.columns, rows: r.rows } }), maxRows: 1000, maxColumns: 100 }
    const step: MergeQueriesStep = { id: 's1', kind: 'merge-queries', name: 'Merged Queries', right: { kind: 'query', queryId: 'r' }, joinKind: 'inner', leftKeys: ['l1'], rightKeys: ['r1'], expand: [] }
    expect(evaluateMergeQueries(l, step, ctx).diagnostics[0].code).toBe('QUERY_JOIN_KEY_TYPE_MISMATCH')
  })

  it('fails with QUERY_MERGE_COLUMN_COLLISION when an expand alias collides', () => {
    const step: MergeQueriesStep = { ...mergeStep('inner'), expand: [{ rightColumnId: 'r2', outputColumnId: 'out1', outputName: 'Revenue' }] }
    expect(evaluateMergeQueries(left, step, context()).diagnostics[0].code).toBe('QUERY_MERGE_COLUMN_COLLISION')
  })

  it('fails with QUERY_ROW_LIMIT_EXCEEDED when the join would exceed the row limit', () => {
    const ctx: StepContext = { ...context(), maxRows: 1 }
    expect(evaluateMergeQueries(left, mergeStep('inner'), ctx).diagnostics[0].code).toBe('QUERY_ROW_LIMIT_EXCEEDED')
  })

  it('fails with QUERY_DEPENDENCY_NOT_FOUND when the right source cannot be resolved', () => {
    const ctx: StepContext = { resolveSource: () => ({ ok: false, diagnostic: { severity: 'error', code: 'QUERY_DEPENDENCY_NOT_FOUND', message: 'missing' } }), maxRows: 1000, maxColumns: 100 }
    const result = evaluateMergeQueries(left, mergeStep('inner'), ctx)
    expect(result.diagnostics[0].code).toBe('QUERY_DEPENDENCY_NOT_FOUND')
    expect(result.diagnostics[0].stepId).toBe('s1')
  })
})
