import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { emptyNotebook } from '../../../src/runtime/notebook/notebookRuntime'
import type { NotebookRuntimeSnapshot } from '../../../src/runtime/notebook/notebookRuntime'
import { validateWorkspaceIntegrity } from '../../../src/runtime/integrity/workspaceIntegrity'
import { createModel, addTable } from '../../../src/runtime/model/modelRuntime'

function fakeDataset(id: string): Dataset {
  return {
    id,
    name: id,
    source: { type: 'sample', key: id },
    tables: [{ id: `${id}-table`, name: id, columns: [{ id: `${id}-col`, name: 'Key', dataType: 'integer', nullable: false }], rows: [], rowCount: 0 }],
    createdAt: new Date().toISOString(),
  }
}

function emptySnapshot(): NotebookRuntimeSnapshot {
  return { notebook: emptyNotebook(), datasets: {}, models: {}, queries: {}, queryEvaluations: {} }
}

describe('validateWorkspaceIntegrity', () => {
  it('is valid for an empty workspace', () => {
    expect(validateWorkspaceIntegrity(emptySnapshot()).valid).toBe(true)
  })

  it('flags a DataCell whose dataset is missing', () => {
    const snapshot = emptySnapshot()
    snapshot.notebook.cells.push({ id: 'cell1', kind: 'data', title: 'Orphan', datasetId: 'missing-ds', status: 'idle' })

    const report = validateWorkspaceIntegrity(snapshot)
    expect(report.valid).toBe(false)
    expect(report.issues).toContainEqual(expect.objectContaining({ referenceType: 'DATASET_NOT_FOUND' }))
  })

  it('flags a ModelCell whose model is missing', () => {
    const snapshot = emptySnapshot()
    snapshot.notebook.cells.push({ id: 'cell1', kind: 'model', title: 'Orphan', modelId: 'missing-model', status: 'idle' })

    const report = validateWorkspaceIntegrity(snapshot)
    expect(report.issues).toContainEqual(expect.objectContaining({ referenceType: 'MODEL_NOT_FOUND' }))
  })

  it('flags a MeasureCell whose measure no longer exists in its model', () => {
    const snapshot = emptySnapshot()
    const model = createModel('Retail')
    snapshot.models[model.id] = model
    snapshot.notebook.cells.push({ id: 'cell1', kind: 'measure', title: 'Orphan', modelId: model.id, measureId: 'missing-measure', status: 'idle' })

    const report = validateWorkspaceIntegrity(snapshot)
    expect(report.issues).toContainEqual(expect.objectContaining({ referenceType: 'MEASURE_NOT_FOUND' }))
  })

  it('flags a model-scoped TestCell whose model is missing', () => {
    const snapshot = emptySnapshot()
    snapshot.notebook.cells.push({
      id: 'cell1',
      kind: 'test',
      title: 'Orphan',
      scope: { kind: 'model', modelId: 'missing-model' },
      validation: { title: 'x', rules: [] },
      status: 'idle',
    })

    const report = validateWorkspaceIntegrity(snapshot)
    expect(report.issues).toContainEqual(expect.objectContaining({ referenceType: 'MODEL_NOT_FOUND' }))
  })

  it('does not flag a workspace-scoped TestCell (no model required)', () => {
    const snapshot = emptySnapshot()
    snapshot.notebook.cells.push({
      id: 'cell1',
      kind: 'test',
      title: 'Workspace check',
      scope: { kind: 'workspace' },
      validation: { title: 'x', rules: [] },
      status: 'idle',
    })

    expect(validateWorkspaceIntegrity(snapshot).valid).toBe(true)
  })

  it('flags a ModelTable whose dataset/table no longer exists', () => {
    const snapshot = emptySnapshot()
    let model = createModel('Retail')
    model = addTable(model, { datasetId: 'gone-ds', tableId: 'gone-table' })
    snapshot.models[model.id] = model

    const report = validateWorkspaceIntegrity(snapshot)
    expect(report.issues).toContainEqual(expect.objectContaining({ referenceType: 'DATASET_TABLE_NOT_FOUND' }))
  })

  it('is valid once a ModelTable resolves against a real dataset', () => {
    const snapshot = emptySnapshot()
    const dataset = fakeDataset('sales')
    snapshot.datasets[dataset.id] = dataset
    let model = createModel('Retail')
    model = addTable(model, { datasetId: dataset.id, tableId: dataset.tables[0].id })
    snapshot.models[model.id] = model

    expect(validateWorkspaceIntegrity(snapshot).valid).toBe(true)
  })

  it('flags a Query source that references a missing dataset/table', () => {
    const snapshot = emptySnapshot()
    snapshot.queries['q1'] = {
      id: 'q1',
      name: 'Q1',
      source: { kind: 'dataset-table', datasetId: 'gone-ds', tableId: 'gone-table' },
      steps: [],
      outputDatasetId: 'out-ds',
      outputTableId: 'out-table',
      loadEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const report = validateWorkspaceIntegrity(snapshot)
    expect(report.issues).toContainEqual(expect.objectContaining({ referenceType: 'DATASET_TABLE_NOT_FOUND' }))
  })

  it('flags a Query that Merges/Appends a missing query', () => {
    const snapshot = emptySnapshot()
    const dataset = fakeDataset('sales')
    snapshot.datasets[dataset.id] = dataset
    snapshot.queries['q1'] = {
      id: 'q1',
      name: 'Q1',
      source: { kind: 'dataset-table', datasetId: dataset.id, tableId: dataset.tables[0].id },
      steps: [
        {
          id: 'step1',
          kind: 'merge-queries',
          name: 'Merge',
          right: { kind: 'query', queryId: 'missing-query' },
          joinKind: 'inner',
          leftKeys: [],
          rightKeys: [],
          expand: [],
        },
      ],
      outputDatasetId: 'out-ds',
      outputTableId: 'out-table',
      loadEnabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    const report = validateWorkspaceIntegrity(snapshot)
    expect(report.issues).toContainEqual(expect.objectContaining({ referenceType: 'QUERY_NOT_FOUND' }))
  })
})
