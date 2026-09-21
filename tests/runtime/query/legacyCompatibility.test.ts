import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { NotebookRuntime, emptyNotebook } from '../../../src/runtime/notebook/notebookRuntime'

function fakeDataset(id: string): Dataset {
  return { id, name: id, source: { type: 'sample', key: id }, tables: [{ id: `${id}-table`, name: id, columns: [], rows: [], rowCount: 0 }], createdAt: new Date().toISOString() }
}

describe('Sprint 1-11 notebooks remain compatible with Sprint 12 (brief §84)', () => {
  it('a legacy notebook (no QueryCells, empty query store) hydrates and behaves normally', () => {
    // Mirrors useNotebookRuntime.ts hydration: a pre-Sprint-12 persisted notebook has no
    // QueryCells, so `loadQueries([])` resolves `{}` — never `undefined` — before `replaceAll`.
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: {}, models: {}, queries: {}, queryEvaluations: {} })

    // refreshQueries (called once after every hydration) is a safe no-op for zero queries.
    expect(() => runtime.refreshQueries()).not.toThrow()
    expect(runtime.getSnapshot().queries).toEqual({})
    expect(runtime.getSnapshot().queryEvaluations).toEqual({})

    // Ordinary Sprint 1 actions still work untouched.
    const dataset = fakeDataset('legacy-ds')
    const cell = runtime.importDataset(dataset)
    expect(runtime.getSnapshot().notebook.cells).toContainEqual(cell)
  })

  it('a notebook with no QueryCells never invokes query-specific logic', () => {
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: { a: fakeDataset('a') }, models: {}, queries: {}, queryEvaluations: {} })
    runtime.importDataset(fakeDataset('b'))
    expect(runtime.getSnapshot().notebook.cells.every((c) => c.kind !== 'query')).toBe(true)
  })
})
