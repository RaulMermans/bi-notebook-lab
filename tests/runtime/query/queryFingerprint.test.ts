import { describe, expect, it } from 'vitest'
import type { QueryDefinition, QueryStep } from '../../../src/domain/query'
import { computeQueryFingerprint } from '../../../src/runtime/query/queryFingerprint'

function makeQuery(steps: QueryStep[]): QueryDefinition {
  const now = new Date().toISOString()
  return {
    id: 'q1',
    name: 'Q1',
    source: { kind: 'dataset-table', datasetId: 'ds', tableId: 'table' },
    steps,
    outputDatasetId: 'out-ds',
    outputTableId: 'out-table',
    loadEnabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

const filterStep: QueryStep = { id: 's1', kind: 'filter-rows', name: 'Filtered Rows', logic: 'and', conditions: [{ columnId: 'c1', operator: 'greater-than', value: 0 }] }

describe('computeQueryFingerprint', () => {
  it('is stable for identical query semantics', () => {
    const a = computeQueryFingerprint(makeQuery([filterStep]), {})
    const b = computeQueryFingerprint(makeQuery([filterStep]), {})
    expect(a).toBe(b)
  })

  it('does not change when only the step display name changes', () => {
    const a = computeQueryFingerprint(makeQuery([filterStep]), {})
    const renamed = { ...filterStep, name: 'My custom filter label' }
    const b = computeQueryFingerprint(makeQuery([renamed]), {})
    expect(a).toBe(b)
  })

  it('changes when a filter condition value changes', () => {
    const a = computeQueryFingerprint(makeQuery([filterStep]), {})
    const edited: QueryStep = { ...filterStep, conditions: [{ columnId: 'c1', operator: 'greater-than', value: 1000 }] }
    const b = computeQueryFingerprint(makeQuery([edited]), {})
    expect(a).not.toBe(b)
  })

  it('changes when step order changes', () => {
    const renameStep: QueryStep = { id: 's2', kind: 'rename-columns', name: 'Renamed Columns', renames: [{ columnId: 'c1', newName: 'X' }] }
    const a = computeQueryFingerprint(makeQuery([filterStep, renameStep]), {})
    const b = computeQueryFingerprint(makeQuery([renameStep, filterStep]), {})
    expect(a).not.toBe(b)
  })

  it('changes when a dependency fingerprint changes', () => {
    const query = makeQuery([])
    const a = computeQueryFingerprint(query, { dep1: 'aaa' })
    const b = computeQueryFingerprint(query, { dep1: 'bbb' })
    expect(a).not.toBe(b)
  })

  it('is unaffected by UI-only fields (query name, loadEnabled, timestamps)', () => {
    const a = computeQueryFingerprint(makeQuery([filterStep]), {})
    const renamedQuery: QueryDefinition = { ...makeQuery([filterStep]), name: 'Totally different name', loadEnabled: false, createdAt: '2000-01-01T00:00:00.000Z' }
    const b = computeQueryFingerprint(renamedQuery, {})
    expect(a).toBe(b)
  })

  it('covers every Sprint 14 step kind generically — no special-casing needed for fingerprinting', () => {
    const customStep: QueryStep = { id: 's3', kind: 'custom-column', name: 'Added Custom', outputColumnId: 'out1', outputName: 'Revenue', expression: '[Quantity] * [UnitPrice]' }
    const a = computeQueryFingerprint(makeQuery([customStep]), {})
    const editedExpression: QueryStep = { ...customStep, expression: '[Quantity] * [UnitPrice] * 2' }
    const b = computeQueryFingerprint(makeQuery([editedExpression]), {})
    expect(a).not.toBe(b)

    const pivotStep: QueryStep = { id: 's4', kind: 'pivot-column', name: 'Pivoted Column', pivotColumnId: 'c1', valueColumnId: 'c2', aggregation: 'sum' }
    const c = computeQueryFingerprint(makeQuery([pivotStep]), {})
    const editedAggregation: QueryStep = { ...pivotStep, aggregation: 'count' }
    const d = computeQueryFingerprint(makeQuery([editedAggregation]), {})
    expect(c).not.toBe(d)

    const renamedPivotStep: QueryStep = { ...pivotStep, name: 'My custom pivot label' }
    expect(computeQueryFingerprint(makeQuery([renamedPivotStep]), {})).toBe(c)
  })
})
