import { describe, expect, it } from 'vitest'
import type { QueryDefinition } from '../../../src/domain/query'
import { buildQueryGraph } from '../../../src/runtime/query/queryGraph'

function baseQuery(id: string, overrides: Partial<QueryDefinition> = {}): QueryDefinition {
  const now = new Date().toISOString()
  return {
    id,
    name: id,
    source: { kind: 'dataset-table', datasetId: 'ds', tableId: 'table' },
    steps: [],
    outputDatasetId: `${id}-out`,
    outputTableId: `${id}-out-table`,
    loadEnabled: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function referencing(id: string, sourceQueryId: string): QueryDefinition {
  return baseQuery(id, { source: { kind: 'query', queryId: sourceQueryId } })
}

describe('buildQueryGraph', () => {
  it('orders a single source query trivially', () => {
    const a = baseQuery('a')
    const graph = buildQueryGraph({ a })
    expect(graph.order).toEqual(['a'])
    expect(graph.cycles).toEqual([])
  })

  it('orders a query referencing another query dependency-first', () => {
    const a = baseQuery('a')
    const b = referencing('b', 'a')
    const graph = buildQueryGraph({ a, b })
    expect(graph.order.indexOf('a')).toBeLessThan(graph.order.indexOf('b'))
  })

  it('tracks a merge dependency', () => {
    const a = baseQuery('a')
    const b = baseQuery('b', {
      steps: [{ id: 's1', kind: 'merge-queries', name: 'Merged', right: { kind: 'query', queryId: 'a' }, joinKind: 'inner', leftKeys: [], rightKeys: [], expand: [] }],
    })
    const graph = buildQueryGraph({ a, b })
    expect(graph.order.indexOf('a')).toBeLessThan(graph.order.indexOf('b'))
  })

  it('tracks an append dependency', () => {
    const a = baseQuery('a')
    const b = baseQuery('b', { steps: [{ id: 's1', kind: 'append-queries', name: 'Appended', sources: [{ kind: 'query', queryId: 'a' }], columns: [] }] })
    const graph = buildQueryGraph({ a, b })
    expect(graph.order.indexOf('a')).toBeLessThan(graph.order.indexOf('b'))
  })

  it('orders a longer chain topologically', () => {
    const a = baseQuery('a')
    const b = referencing('b', 'a')
    const c = referencing('c', 'b')
    const graph = buildQueryGraph({ c, a, b })
    expect(graph.order).toEqual(['a', 'b', 'c'])
  })

  it('reports a missing dependency and excludes the query from order', () => {
    const b = referencing('b', 'missing')
    const graph = buildQueryGraph({ b })
    expect(graph.order).toEqual([])
    expect(graph.missing).toEqual([{ queryId: 'b', missingDependencyId: 'missing' }])
    expect(graph.blocked.has('b')).toBe(true)
  })

  it('detects a direct cycle and fails closed', () => {
    const a = referencing('a', 'b')
    const b = referencing('b', 'a')
    const graph = buildQueryGraph({ a, b })
    expect(graph.order).toEqual([])
    expect(graph.cycles.length).toBeGreaterThan(0)
    expect(graph.blocked.has('a')).toBe(true)
    expect(graph.blocked.has('b')).toBe(true)
  })

  it('detects an indirect cycle (a -> b -> c -> a)', () => {
    const a = referencing('a', 'c')
    const b = referencing('b', 'a')
    const c = referencing('c', 'b')
    const graph = buildQueryGraph({ a, b, c })
    expect(graph.order).toEqual([])
    expect(graph.cycles.length).toBeGreaterThan(0)
  })

  it('does not block a query with no relation to a cycle elsewhere in the graph', () => {
    const a = referencing('a', 'b')
    const b = referencing('b', 'a')
    const unrelated = baseQuery('unrelated')
    const graph = buildQueryGraph({ a, b, unrelated })
    expect(graph.order).toEqual(['unrelated'])
  })
})
