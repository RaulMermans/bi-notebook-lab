import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { Measure } from '../../../src/domain/model'
import { emptyNotebook, NotebookRuntime } from '../../../src/runtime/notebook/notebookRuntime'
import type { NotebookRuntimeSnapshot } from '../../../src/runtime/notebook/notebookRuntime'
import { createModel, addTable } from '../../../src/runtime/model/modelRuntime'
import { createQueryDefinition } from '../../../src/runtime/query/queryRuntime'
import { exportProjectBundle, loadProjectBundle, serializeProjectBundle } from '../../../src/runtime/bundle/bundleCodec'
import { BUNDLE_FORMAT, BUNDLE_SCHEMA_VERSION } from '../../../src/domain/bundle'

function fakeDataset(id: string): Dataset {
  return {
    id,
    name: id,
    source: { type: 'csv', fileName: `${id}.csv` },
    tables: [
      {
        id: `${id}-table`,
        name: id,
        columns: [{ id: `${id}-col`, name: 'Amount', dataType: 'decimal', nullable: false }],
        rows: [{ [`${id}-col`]: 10 }],
        rowCount: 1,
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
  }
}

/** A full-ish workspace exercising every entity kind the bundle format carries (brief Part A §2 "Stable Identity"). */
function buildFullSnapshot(): NotebookRuntimeSnapshot {
  const dataset = fakeDataset('sales')
  let model = createModel('Retail')
  model = addTable(model, { datasetId: dataset.id, tableId: dataset.tables[0].id })
  const modelTableId = model.tables[0].id

  const measure: Measure = {
    id: 'measure-total',
    homeModelTableId: modelTableId,
    name: 'Total Amount',
    expression: 'SUM(sales[Amount])',
    dataType: 'unknown',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
  model = { ...model, measures: [measure] }

  const query = createQueryDefinition('Sales Query', { kind: 'dataset-table', datasetId: dataset.id, tableId: dataset.tables[0].id })

  const notebook = emptyNotebook('Round Trip Project')
  notebook.cells.push(
    { id: 'cell-data', kind: 'data', title: dataset.name, datasetId: dataset.id, status: 'idle' },
    { id: 'cell-model', kind: 'model', title: model.name, modelId: model.id, status: 'idle' },
    { id: 'cell-measure', kind: 'measure', title: measure.name, modelId: model.id, measureId: measure.id, status: 'idle' },
    { id: 'cell-query', kind: 'query', title: query.name, queryId: query.id, status: 'idle' },
  )

  return {
    notebook,
    datasets: { [dataset.id]: dataset },
    models: { [model.id]: model },
    queries: { [query.id]: query },
    queryEvaluations: {},
  }
}

const EXPORT_OPTIONS = { projectId: 'project-1', title: 'Retail Practice', description: 'A round-trip test project', createdAt: '2026-01-01T00:00:00.000Z' }

describe('bundleCodec', () => {
  it('round-trips a full workspace: export -> import -> export is equal except exportedAt', () => {
    const snapshot = buildFullSnapshot()
    const firstBundle = exportProjectBundle(snapshot, EXPORT_OPTIONS)
    const text = serializeProjectBundle(firstBundle)

    const loaded = loadProjectBundle(text)
    expect(loaded.ok).toBe(true)
    if (!loaded.ok) return

    const secondBundle = exportProjectBundle(loaded.snapshot, EXPORT_OPTIONS)

    const { exportedAt: firstExportedAt, ...firstRest } = firstBundle.metadata
    const { exportedAt: secondExportedAt, ...secondRest } = secondBundle.metadata
    expect(firstExportedAt).toBeTruthy()
    expect(secondExportedAt).toBeTruthy()
    expect(firstRest).toEqual(secondRest)
    expect(secondBundle.notebook).toEqual(firstBundle.notebook)
    expect(secondBundle.datasets).toEqual(firstBundle.datasets)
    expect(secondBundle.queries).toEqual(firstBundle.queries)
    expect(secondBundle.models).toEqual(firstBundle.models)
  })

  it('excludes query-output datasets from the export payload (they are re-derived, not duplicated)', () => {
    const snapshot = buildFullSnapshot()
    const derived: Dataset = { id: 'derived-1', name: 'Derived', source: { type: 'query', queryId: 'q1', revision: 'r1' }, tables: [], createdAt: '2026-01-01T00:00:00.000Z' }
    snapshot.datasets[derived.id] = derived

    const bundle = exportProjectBundle(snapshot, EXPORT_OPTIONS)
    expect(bundle.datasets.some((d) => d.id === derived.id)).toBe(false)
  })

  it('rejects a file that is not valid JSON with a readable message', () => {
    const result = loadProjectBundle('{not json')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('invalid-json')
    expect(result.error.message).toBe('This file is not a BI Notebook Lab project.')
  })

  it('rejects a JSON file that is not a BI Notebook Lab bundle', () => {
    const result = loadProjectBundle(JSON.stringify({ hello: 'world' }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('not-a-project')
  })

  it('rejects an unsupported schema version with the version numbers in the message', () => {
    const snapshot = buildFullSnapshot()
    const bundle = exportProjectBundle(snapshot, EXPORT_OPTIONS)
    const future = { ...bundle, schemaVersion: 99 }

    const result = loadProjectBundle(JSON.stringify(future))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('unsupported-schema-version')
    expect(result.error.message).toContain('version 99')
    expect(result.error.message).toContain(`version ${BUNDLE_SCHEMA_VERSION}`)
  })

  it('rejects a structurally incomplete bundle', () => {
    const malformed = { format: BUNDLE_FORMAT, schemaVersion: BUNDLE_SCHEMA_VERSION, metadata: {}, notebook: { cells: [] } }
    const result = loadProjectBundle(JSON.stringify(malformed))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('structurally-invalid')
  })

  it('rejects a bundle with an integrity violation and names the offending cell', () => {
    const snapshot = buildFullSnapshot()
    // Corrupt the measure cell to point at a measure id that doesn't exist.
    snapshot.notebook.cells = snapshot.notebook.cells.map((cell) => (cell.id === 'cell-measure' && cell.kind === 'measure' ? { ...cell, measureId: 'missing-measure' } : cell))

    const bundle = exportProjectBundle(snapshot, EXPORT_OPTIONS)
    const result = loadProjectBundle(serializeProjectBundle(bundle))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('integrity-violation')
    expect(result.error.message).toContain('Total Amount')
  })

  it('NotebookRuntime.importSnapshot never swaps state when the incoming snapshot fails integrity validation', () => {
    const original = buildFullSnapshot()
    const runtime = new NotebookRuntime(original)

    const broken: NotebookRuntimeSnapshot = {
      ...original,
      notebook: { ...original.notebook, cells: [{ id: 'orphan', kind: 'model', title: 'Orphan', modelId: 'missing', status: 'idle' }] },
    }

    const outcome = runtime.importSnapshot(broken)
    expect(outcome.imported).toBe(false)
    expect(outcome.report.valid).toBe(false)
    expect(runtime.getSnapshot()).toBe(original)
  })

  it('NotebookRuntime.importSnapshot swaps state when the incoming snapshot is valid', () => {
    const original = buildFullSnapshot()
    const runtime = new NotebookRuntime(original)
    const next = buildFullSnapshot()
    next.notebook.title = 'A Different Project'

    const outcome = runtime.importSnapshot(next)
    expect(outcome.imported).toBe(true)
    expect(runtime.getSnapshot().notebook.title).toBe('A Different Project')
  })
})
