import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../src/domain/data'
import { NotebookRuntime, emptyNotebook } from '../../src/runtime/notebook/notebookRuntime'
import { createMeasure, evaluateMeasure } from '../../src/runtime/measure/measureRuntime'
import { addTable, createModel } from '../../src/runtime/model/modelRuntime'

function salesDataset(): Dataset {
  return {
    id: 'sales-ds',
    name: 'Sales',
    source: { type: 'sample', key: 'sales' },
    tables: [
      {
        id: 'sales-table',
        name: 'Sales',
        columns: [
          { id: 'sales-orderid', name: 'OrderID', dataType: 'integer', nullable: false },
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
        ],
        rows: [
          { OrderID: 1, Revenue: 100 },
          { OrderID: 2, Revenue: 0 },
          { OrderID: 3, Revenue: 500 },
        ],
        rowCount: 3,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function freshRuntime(datasets: Record<string, Dataset> = {}) {
  return new NotebookRuntime({ notebook: emptyNotebook(), datasets, models: {}, queries: {}, queryEvaluations: {} })
}

describe('NotebookRuntime query integration', () => {
  it('creates a QueryCell from a DataCell and evaluates immediately', () => {
    const rawDataset = salesDataset()
    const runtime = freshRuntime({ 'sales-ds': rawDataset })
    const { cell, query } = runtime.createQueryFromDataset('sales-ds', 'sales-table')

    const snapshot = runtime.getSnapshot()
    expect(snapshot.notebook.cells).toContainEqual(cell)
    expect(snapshot.queries[query.id]).toBeDefined()
    expect(snapshot.datasets[query.outputDatasetId]).toBeDefined()
    expect(snapshot.queryEvaluations[query.id].status).toBe('success')
    // The raw DataCell dataset is untouched.
    expect(snapshot.datasets['sales-ds']).toEqual(rawDataset)
  })

  it('re-evaluates and updates the derived dataset in place when a step is added', () => {
    const runtime = freshRuntime({ 'sales-ds': salesDataset() })
    const { query } = runtime.createQueryFromDataset('sales-ds', 'sales-table')

    runtime.addQueryStep(query.id, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: 'sales-revenue', operator: 'greater-than', value: 0 }] })

    const snapshot = runtime.getSnapshot()
    const derived = snapshot.datasets[query.outputDatasetId]
    expect(derived.tables[0].rowCount).toBe(2)
    expect(derived.id).toBe(query.outputDatasetId) // stable identity across re-evaluation
  })

  it('surfaces a broken downstream step without crashing, and recovers once the offending step is removed', () => {
    const runtime = freshRuntime({ 'sales-ds': salesDataset() })
    const { query } = runtime.createQueryFromDataset('sales-ds', 'sales-table')
    // Removing the column (not renaming — renames preserve the id, brief §7) breaks the later step
    // that still references it by id.
    runtime.addQueryStep(query.id, { kind: 'remove-columns', columnIds: ['sales-orderid'] })
    runtime.addQueryStep(query.id, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: 'sales-orderid', operator: 'greater-than', value: 1 }] })

    const broken = runtime.getSnapshot().queryEvaluations[query.id]
    expect(broken.status).toBe('error')

    const brokenStepId = runtime.getQuery(query.id)!.steps[1].id
    runtime.removeQueryStep(query.id, brokenStepId)

    const recovered = runtime.getSnapshot().queryEvaluations[query.id]
    expect(recovered.status).toBe('success')
  })

  it('removes the derived dataset from the model-visible registry when load is disabled, and restores it when re-enabled', () => {
    const runtime = freshRuntime({ 'sales-ds': salesDataset() })
    const { query } = runtime.createQueryFromDataset('sales-ds', 'sales-table')
    expect(runtime.getSnapshot().datasets[query.outputDatasetId]).toBeDefined()

    runtime.setQueryLoadEnabled(query.id, false)
    expect(runtime.getSnapshot().datasets[query.outputDatasetId]).toBeUndefined()

    runtime.setQueryLoadEnabled(query.id, true)
    expect(runtime.getSnapshot().datasets[query.outputDatasetId]).toBeDefined()
  })

  it('a disabled (staging) query still feeds a sibling query that references it', () => {
    const runtime = freshRuntime({ 'sales-ds': salesDataset() })
    const { query: base } = runtime.createQueryFromDataset('sales-ds', 'sales-table')
    runtime.setQueryLoadEnabled(base.id, false)

    const referenced = runtime.createQueryFromQuery(base.id)!
    const derivedEvaluation = runtime.getSnapshot().queryEvaluations[referenced.query.id]
    expect(derivedEvaluation.status).toBe('success')
    expect(derivedEvaluation.output?.tables[0].rowCount).toBe(3)
  })

  it('blocks deleting a query that another query still depends on', () => {
    const runtime = freshRuntime({ 'sales-ds': salesDataset() })
    const { query: base } = runtime.createQueryFromDataset('sales-ds', 'sales-table')
    const referenced = runtime.createQueryFromQuery(base.id)!

    const result = runtime.deleteQuery(base.id)

    expect(result.deleted).toBe(false)
    expect(result.blockedByQueries).toEqual([referenced.query.id])
    expect(runtime.getQuery(base.id)).toBeDefined()
  })

  it('deletes an unreferenced query and its derived dataset/cell', () => {
    const runtime = freshRuntime({ 'sales-ds': salesDataset() })
    const { query, cell } = runtime.createQueryFromDataset('sales-ds', 'sales-table')

    const result = runtime.deleteQuery(query.id)

    expect(result.deleted).toBe(true)
    expect(runtime.getQuery(query.id)).toBeUndefined()
    expect(runtime.getSnapshot().datasets[query.outputDatasetId]).toBeUndefined()
    expect(runtime.getSnapshot().notebook.cells.find((c) => c.id === cell.id)).toBeUndefined()
  })

  it('a query edit updates a downstream measure automatically, without rebuilding the model', () => {
    const runtime = freshRuntime({ 'sales-ds': salesDataset() })
    const { query } = runtime.createQueryFromDataset('sales-ds', 'sales-table', 'SalesClean')
    runtime.addQueryStep(query.id, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: 'sales-revenue', operator: 'greater-than', value: 0 }] })

    const derivedDataset = runtime.getSnapshot().datasets[query.outputDatasetId]
    let model = createModel()
    model = addTable(model, { datasetId: derivedDataset.id, tableId: query.outputTableId })
    const modelTableId = model.tables[0].id
    const measureResult = createMeasure(model, runtime.getSnapshot().datasets, {
      homeModelTableId: modelTableId,
      name: 'Total Revenue',
      expression: 'SUM(SalesClean[Revenue])',
    })
    model = measureResult.model
    expect(measureResult.execution?.value).toBe(600) // 100 + 500, the 0-revenue row filtered out

    // Tighten the filter — no model rebuild, just re-read `datasets` after the query re-evaluates.
    const filterStepId = runtime.getQuery(query.id)!.steps[0].id
    runtime.updateQueryStep(query.id, filterStepId, { conditions: [{ columnId: 'sales-revenue', operator: 'greater-than', value: 100 }] })

    const measure = model.measures[0]
    const rerun = evaluateMeasure(model, runtime.getSnapshot().datasets, measure.id)
    expect(rerun.value).toBe(500)
  })
})
