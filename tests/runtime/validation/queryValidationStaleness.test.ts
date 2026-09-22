import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { TestCell } from '../../../src/domain/notebook'
import type { ValidationSpec } from '../../../src/domain/validation'
import { NotebookRuntime, emptyNotebook } from '../../../src/runtime/notebook/notebookRuntime'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel } from '../../../src/runtime/model/modelRuntime'
import { isValidationRunStale } from '../../../src/runtime/validation/fingerprint'
import { runValidation } from '../../../src/runtime/validation/validationEngine'

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
          { OrderID: 2, Revenue: 1000 },
        ],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

describe('Validation staleness after a Power Query row-only edit (brief §106, mandatory)', () => {
  it('a PASS becomes STALE the moment a Filter Rows threshold changes, with the schema untouched', () => {
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: { 'sales-ds': salesDataset() }, models: {}, queries: {}, queryEvaluations: {} })
    const { query } = runtime.createQueryFromDataset('sales-ds', 'sales-table', 'SalesClean')
    runtime.addQueryStep(query.id, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: 'sales-revenue', operator: 'greater-than', value: 0 }] })

    const derivedDataset = runtime.getSnapshot().datasets[query.outputDatasetId]
    let model = createModel('Query Model')
    model = addTable(model, { datasetId: derivedDataset.id, tableId: query.outputTableId })
    const modelTableId = model.tables[0].id

    const measureResult = createMeasure(model, runtime.getSnapshot().datasets, {
      homeModelTableId: modelTableId,
      name: 'Total Revenue',
      expression: 'SUM(SalesClean[Revenue])',
    })
    model = measureResult.model
    expect(measureResult.execution?.value).toBe(1100)

    const spec: ValidationSpec = {
      id: 'spec-1',
      title: 'Revenue check',
      passingPercentage: 100,
      rules: [
        {
          id: 'rule-1',
          type: 'measure-result',
          points: 100,
          title: 'Total Revenue',
          measure: { name: 'Total Revenue' },
          cases: [{ id: 'case-1', title: 'Unfiltered', filters: [], expected: 1100 }],
        },
      ],
    }
    const cell: TestCell = { id: 'test-1', kind: 'test', title: 'Checkpoint', scope: { kind: 'model', modelId: model.id }, validation: spec }

    const snapshotBefore = { datasets: runtime.getSnapshot().datasets, models: { [model.id]: model }, queries: runtime.getSnapshot().queries, queryEvaluations: runtime.getSnapshot().queryEvaluations }
    const run = runValidation(snapshotBefore, cell)
    expect(run.passed).toBe(true)
    expect(isValidationRunStale(run, snapshotBefore, cell)).toBe(false)

    // Edit ONLY the Power Query filter threshold — no schema change at all.
    const filterStepId = runtime.getQuery(query.id)!.steps[0].id
    runtime.updateQueryStep(query.id, filterStepId, { conditions: [{ columnId: 'sales-revenue', operator: 'greater-than', value: 500 }] })

    const snapshotAfter = { datasets: runtime.getSnapshot().datasets, models: { [model.id]: model }, queries: runtime.getSnapshot().queries, queryEvaluations: runtime.getSnapshot().queryEvaluations }
    expect(isValidationRunStale(run, snapshotAfter, cell)).toBe(true)
  })
})
