import { describe, expect, it } from 'vitest'
import type { QueryDefinition } from '../../src/domain/query'
import { deleteQuery, loadQueries, loadQuery, saveQuery } from '../../src/persistence/queryStore'

function fakeQuery(id: string): QueryDefinition {
  const now = new Date().toISOString()
  return {
    id,
    name: id,
    source: { kind: 'dataset-table', datasetId: 'ds1', tableId: 'table1' },
    steps: [],
    outputDatasetId: `${id}-out`,
    outputTableId: `${id}-out-table`,
    loadEnabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

describe('queryStore persistence', () => {
  it('round-trips a query definition', async () => {
    const query = fakeQuery('query-x')
    await saveQuery(query)
    const restored = await loadQuery('query-x')
    expect(restored).toEqual(query)
  })

  it('loads multiple queries by id and skips ids that were never saved', async () => {
    await saveQuery(fakeQuery('query-a'))
    await saveQuery(fakeQuery('query-b'))

    const restored = await loadQueries(['query-a', 'query-b', 'missing'])

    expect(Object.keys(restored).sort()).toEqual(['query-a', 'query-b'])
  })

  it('deletes a query', async () => {
    await saveQuery(fakeQuery('query-del'))
    await deleteQuery('query-del')
    const restored = await loadQuery('query-del')
    expect(restored).toBeUndefined()
  })
})
