import { describe, expect, it } from 'vitest'
import type { NotebookCell, QueryCell } from '../../src/domain/notebook'
import type { QueryDefinition, QueryStep } from '../../src/domain/query'

describe('QueryDefinition / QueryCell contracts', () => {
  it('a QueryDefinition carries a stable output identity distinct from any step', () => {
    const query: QueryDefinition = {
      id: 'q1',
      name: 'Sales Clean',
      source: { kind: 'dataset-table', datasetId: 'ds1', tableId: 'table1' },
      steps: [],
      outputDatasetId: 'out-ds',
      outputTableId: 'out-table',
      loadEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    expect(query.outputDatasetId).not.toBe(query.id)
    expect(query.source.kind).toBe('dataset-table')
  })

  it('a QueryCell stores a reference only, mirroring ModelCell', () => {
    const cell: QueryCell = { id: 'cell1', kind: 'query', title: 'Sales Clean', queryId: 'q1', status: 'idle' }
    const asNotebookCell: NotebookCell = cell
    expect(asNotebookCell.kind).toBe('query')
  })

  it('the QueryStep union covers all fourteen required step kinds', () => {
    const kinds: QueryStep['kind'][] = [
      'rename-columns',
      'remove-columns',
      'reorder-columns',
      'change-type',
      'filter-rows',
      'replace-values',
      'remove-duplicates',
      'sort-rows',
      'fill',
      'split-column',
      'merge-columns',
      'group-by',
      'merge-queries',
      'append-queries',
    ]
    expect(new Set(kinds).size).toBe(14)
  })

  it('a query-as-source references another query by id, not a dataset', () => {
    const query: QueryDefinition = {
      id: 'q2',
      name: 'Sales Enriched',
      source: { kind: 'query', queryId: 'q1' },
      steps: [],
      outputDatasetId: 'out-ds-2',
      outputTableId: 'out-table-2',
      loadEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    expect(query.source).toEqual({ kind: 'query', queryId: 'q1' })
  })
})
