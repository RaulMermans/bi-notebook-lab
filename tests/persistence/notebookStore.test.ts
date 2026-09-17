import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../src/domain/data'
import {
  deleteDataset,
  loadDataset,
  loadDatasets,
  loadNotebook,
  saveDataset,
  saveNotebook,
} from '../../src/persistence/notebookStore'
import { emptyNotebook } from '../../src/runtime/notebook/notebookRuntime'

function fakeDataset(id: string): Dataset {
  return {
    id,
    name: id,
    source: { type: 'sample', key: id },
    tables: [
      {
        id: `${id}-table`,
        name: id,
        columns: [{ id: 'c1', name: 'A', dataType: 'integer', nullable: false }],
        rows: [{ A: 1 }, { A: 2 }],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

describe('notebookStore persistence', () => {
  it('round-trips a notebook document', async () => {
    const notebook = emptyNotebook('My Notebook')

    await saveNotebook(notebook)
    const restored = await loadNotebook()

    expect(restored).toEqual(notebook)
  })

  it('round-trips a dataset including its rows', async () => {
    const dataset = fakeDataset('ds-x')

    await saveDataset(dataset)
    const restored = await loadDataset('ds-x')

    expect(restored).toEqual(dataset)
  })

  it('loads multiple datasets by id and skips ids that were never saved', async () => {
    await saveDataset(fakeDataset('ds-a'))
    await saveDataset(fakeDataset('ds-b'))

    const restored = await loadDatasets(['ds-a', 'ds-b', 'missing'])

    expect(Object.keys(restored).sort()).toEqual(['ds-a', 'ds-b'])
  })

  it('deletes a dataset', async () => {
    await saveDataset(fakeDataset('ds-del'))

    await deleteDataset('ds-del')
    const restored = await loadDataset('ds-del')

    expect(restored).toBeUndefined()
  })
})
