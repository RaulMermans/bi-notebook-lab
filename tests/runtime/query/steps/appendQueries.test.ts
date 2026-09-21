import { describe, expect, it } from 'vitest'
import type { DataColumn } from '../../../../src/domain/data'
import type { AppendQueriesStep } from '../../../../src/domain/query'
import type { QueryFrame } from '../../../../src/runtime/query/queryFrame'
import { evaluateAppendQueries } from '../../../../src/runtime/query/steps/appendQueries'
import type { ResolvedSource, StepContext } from '../../../../src/runtime/query/stepContext'

function col(id: string, name: string, dataType: DataColumn['dataType'] = 'string', nullable = false): DataColumn {
  return { id, name, dataType, nullable }
}

function frame(columns: DataColumn[], rows: Record<string, unknown>[]): QueryFrame {
  return { columns, rows }
}

function contextFor(sources: Record<string, ResolvedSource>, overrides: Partial<StepContext> = {}): StepContext {
  return {
    resolveSource: (source) => {
      if (source.kind !== 'query') return { ok: false, diagnostic: { severity: 'error', code: 'QUERY_DEPENDENCY_NOT_FOUND', message: 'unsupported' } }
      const value = sources[source.queryId]
      if (!value) return { ok: false, diagnostic: { severity: 'error', code: 'QUERY_DEPENDENCY_NOT_FOUND', message: 'missing' } }
      return { ok: true, value }
    },
    maxRows: 100_000,
    maxColumns: 200,
    ...overrides,
  }
}

describe('append-queries', () => {
  it('appends two queries with the same schema', () => {
    const jan = frame([col('c1', 'OrderID', 'integer'), col('c2', 'Revenue', 'decimal')], [{ OrderID: 1, Revenue: 10 }])
    const feb = { columns: [col('c3', 'OrderID', 'integer'), col('c4', 'Revenue', 'decimal')], rows: [{ OrderID: 2, Revenue: 20 }] }
    const step: AppendQueriesStep = { id: 's1', kind: 'append-queries', name: 'Appended Queries', sources: [{ kind: 'query', queryId: 'feb' }], columns: [{ name: 'OrderID', outputColumnId: 'o1' }, { name: 'Revenue', outputColumnId: 'o2' }] }
    const result = evaluateAppendQueries(jan, step, contextFor({ feb }))
    expect(result.frame?.rows).toEqual([{ OrderID: 1, Revenue: 10 }, { OrderID: 2, Revenue: 20 }])
  })

  it('fills missing columns with null when schemas differ', () => {
    const jan = frame([col('c1', 'OrderID', 'integer'), col('c2', 'Revenue', 'decimal')], [{ OrderID: 1, Revenue: 10 }])
    const feb = { columns: [col('c3', 'OrderID', 'integer'), col('c4', 'Revenue', 'decimal'), col('c5', 'Promotion', 'string', true)], rows: [{ OrderID: 2, Revenue: 20, Promotion: 'Sale' }] }
    const step: AppendQueriesStep = {
      id: 's1',
      kind: 'append-queries',
      name: 'Appended Queries',
      sources: [{ kind: 'query', queryId: 'feb' }],
      columns: [{ name: 'OrderID', outputColumnId: 'o1' }, { name: 'Revenue', outputColumnId: 'o2' }, { name: 'Promotion', outputColumnId: 'o3' }],
    }
    const result = evaluateAppendQueries(jan, step, contextFor({ feb }))
    expect(result.frame?.rows).toEqual([
      { OrderID: 1, Revenue: 10, Promotion: null },
      { OrderID: 2, Revenue: 20, Promotion: 'Sale' },
    ])
  })

  it('promotes integer + decimal to decimal', () => {
    const a = frame([col('c1', 'Value', 'integer')], [{ Value: 1 }])
    const b = { columns: [col('c2', 'Value', 'decimal')], rows: [{ Value: 1.5 }] }
    const step: AppendQueriesStep = { id: 's1', kind: 'append-queries', name: 'Appended Queries', sources: [{ kind: 'query', queryId: 'b' }], columns: [{ name: 'Value', outputColumnId: 'o1' }] }
    const result = evaluateAppendQueries(a, step, contextFor({ b }))
    expect(result.frame?.columns[0].dataType).toBe('decimal')
  })

  it('fails structurally on an incompatible type mix (number vs string)', () => {
    const a = frame([col('c1', 'Value', 'integer')], [{ Value: 1 }])
    const b = { columns: [col('c2', 'Value', 'string')], rows: [{ Value: 'x' }] }
    const step: AppendQueriesStep = { id: 's1', kind: 'append-queries', name: 'Appended Queries', sources: [{ kind: 'query', queryId: 'b' }], columns: [{ name: 'Value', outputColumnId: 'o1' }] }
    const result = evaluateAppendQueries(a, step, contextFor({ b }))
    expect(result.frame).toBeUndefined()
    expect(result.diagnostics[0].code).toBe('QUERY_INVALID_STEP_CONFIG')
  })

  it('appends 3+ queries deterministically in source order', () => {
    const a = frame([col('c1', 'N', 'integer')], [{ N: 1 }])
    const b = { columns: [col('c2', 'N', 'integer')], rows: [{ N: 2 }] }
    const c = { columns: [col('c3', 'N', 'integer')], rows: [{ N: 3 }] }
    const step: AppendQueriesStep = {
      id: 's1',
      kind: 'append-queries',
      name: 'Appended Queries',
      sources: [{ kind: 'query', queryId: 'b' }, { kind: 'query', queryId: 'c' }],
      columns: [{ name: 'N', outputColumnId: 'o1' }],
    }
    const result = evaluateAppendQueries(a, step, contextFor({ b, c }))
    expect(result.frame?.rows.map((r) => r.N)).toEqual([1, 2, 3])
  })

  it('fails with QUERY_ROW_LIMIT_EXCEEDED past the row limit', () => {
    const a = frame([col('c1', 'N', 'integer')], [{ N: 1 }, { N: 2 }])
    const b = { columns: [col('c2', 'N', 'integer')], rows: [{ N: 3 }] }
    const step: AppendQueriesStep = { id: 's1', kind: 'append-queries', name: 'Appended Queries', sources: [{ kind: 'query', queryId: 'b' }], columns: [{ name: 'N', outputColumnId: 'o1' }] }
    const result = evaluateAppendQueries(a, step, contextFor({ b }, { maxRows: 2 }))
    expect(result.diagnostics[0].code).toBe('QUERY_ROW_LIMIT_EXCEEDED')
  })
})
