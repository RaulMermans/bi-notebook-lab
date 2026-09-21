import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { NotebookRuntime, emptyNotebook } from '../../../src/runtime/notebook/notebookRuntime'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel } from '../../../src/runtime/model/modelRuntime'

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
        rows: [{ OrderID: 1, Revenue: 100 }],
        rowCount: 1,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

describe('Schema breakage from an upstream Power Query edit (brief §55, §108)', () => {
  it('removing a column a Measure depends on surfaces a diagnostic instead of crashing, and removing the offending step recovers it', () => {
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: { 'sales-ds': salesDataset() }, models: {}, queries: {}, queryEvaluations: {} })
    const { query } = runtime.createQueryFromDataset('sales-ds', 'sales-table', 'SalesClean')

    const derivedDataset = runtime.getSnapshot().datasets[query.outputDatasetId]
    let model = createModel('Model')
    model = addTable(model, { datasetId: derivedDataset.id, tableId: query.outputTableId })
    const modelTableId = model.tables[0].id

    const measureResult = createMeasure(model, runtime.getSnapshot().datasets, {
      homeModelTableId: modelTableId,
      name: 'Total Revenue',
      expression: 'SUM(SalesClean[Revenue])',
    })
    model = measureResult.model
    expect(measureResult.execution?.value).toBe(100)

    // Upstream Power Query edit removes the Revenue column the measure depends on.
    runtime.addQueryStep(query.id, { kind: 'remove-columns', columnIds: ['sales-revenue'] })
    expect(runtime.getSnapshot().queryEvaluations[query.id].status).toBe('success') // the step itself is valid

    const measure = model.measures[0]
    const broken = evaluateMeasure(model, runtime.getSnapshot().datasets, measure.id)
    expect(broken.value).toBeNull()
    expect(broken.diagnostics.length).toBeGreaterThan(0)

    // Recovery: delete the offending step.
    const removeStepId = runtime.getQuery(query.id)!.steps[0].id
    runtime.removeQueryStep(query.id, removeStepId)

    const recovered = evaluateMeasure(model, runtime.getSnapshot().datasets, measure.id)
    expect(recovered.value).toBe(100)
    expect(recovered.diagnostics).toEqual([])
  })
})
