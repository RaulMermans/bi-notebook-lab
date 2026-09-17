import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../src/domain/data'
import { NotebookRuntime, emptyNotebook } from '../../src/runtime/notebook/notebookRuntime'

function fakeDataset(id: string, name: string): Dataset {
  return {
    id,
    name,
    source: { type: 'sample', key: id },
    tables: [{ id: `${id}-table`, name, columns: [], rows: [], rowCount: 0 }],
    createdAt: new Date().toISOString(),
  }
}

describe('NotebookRuntime', () => {
  it('adds a DataCell and registers its dataset when importing', () => {
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: {}, models: {} })
    const dataset = fakeDataset('ds1', 'Sales')

    const cell = runtime.importDataset(dataset)
    const snapshot = runtime.getSnapshot()

    expect(snapshot.notebook.cells).toHaveLength(1)
    expect(snapshot.notebook.cells[0].id).toBe(cell.id)
    expect(snapshot.notebook.cells[0].datasetId).toBe('ds1')
    expect(snapshot.datasets.ds1).toEqual(dataset)
  })

  it('removes a dataset and its DataCell together', () => {
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: {}, models: {} })
    runtime.importDataset(fakeDataset('ds1', 'Sales'))

    runtime.removeDataset('ds1')
    const snapshot = runtime.getSnapshot()

    expect(snapshot.notebook.cells).toHaveLength(0)
    expect(snapshot.datasets.ds1).toBeUndefined()
  })

  it('preserves cell ordering when moving a cell', () => {
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: {}, models: {} })
    runtime.importDataset(fakeDataset('a', 'A'))
    runtime.importDataset(fakeDataset('b', 'B'))
    runtime.importDataset(fakeDataset('c', 'C'))

    const [first] = runtime.getSnapshot().notebook.cells
    runtime.moveCell(first.id, 2)

    const order = runtime.getSnapshot().notebook.cells.map((cell) => cell.title)
    expect(order).toEqual(['B', 'C', 'A'])
  })

  it('removeCell drops only the targeted cell and keeps ordering of the rest', () => {
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: {}, models: {} })
    runtime.importDataset(fakeDataset('a', 'A'))
    const [, second] = (() => {
      runtime.importDataset(fakeDataset('b', 'B'))
      return runtime.getSnapshot().notebook.cells
    })()
    runtime.importDataset(fakeDataset('c', 'C'))

    runtime.removeCell(second.id)

    const order = runtime.getSnapshot().notebook.cells.map((cell) => cell.title)
    expect(order).toEqual(['A', 'C'])
  })

  it('notifies subscribers on mutation and stops after unsubscribing', () => {
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: {}, models: {} })
    let calls = 0
    const unsubscribe = runtime.subscribe(() => {
      calls += 1
    })

    runtime.importDataset(fakeDataset('a', 'A'))
    expect(calls).toBe(1)

    unsubscribe()
    runtime.importDataset(fakeDataset('b', 'B'))
    expect(calls).toBe(1)
  })

  it('creates a ModelCell and registers an empty model when createModelCell is called', () => {
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: {}, models: {} })

    const { cell, model } = runtime.createModelCell('Retail Model')
    const snapshot = runtime.getSnapshot()

    expect(snapshot.notebook.cells).toHaveLength(1)
    expect(snapshot.notebook.cells[0]).toMatchObject({ id: cell.id, kind: 'model', modelId: model.id })
    expect(snapshot.models[model.id]).toEqual(model)
    expect(model.name).toBe('Retail Model')
  })

  it('removes a model and its ModelCell together', () => {
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: {}, models: {} })
    const { model } = runtime.createModelCell()

    runtime.removeModel(model.id)
    const snapshot = runtime.getSnapshot()

    expect(snapshot.notebook.cells).toHaveLength(0)
    expect(snapshot.models[model.id]).toBeUndefined()
  })
})
