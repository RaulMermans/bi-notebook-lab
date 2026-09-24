import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { NotebookRuntime, emptyNotebook } from '../../../src/runtime/notebook/notebookRuntime'
import {
  analyzeDeleteCalculatedColumn,
  analyzeDeleteDataset,
  analyzeDeleteMeasure,
  analyzeDeleteModel,
  analyzeDisableQueryLoad,
  analyzeRemoveModelTable,
} from '../../../src/runtime/integrity/mutationImpact'

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
          { id: 'revenue-col', name: 'Revenue', dataType: 'integer', nullable: false },
          { id: 'cost-col', name: 'Cost', dataType: 'integer', nullable: false },
        ],
        rows: [{ Revenue: 120, Cost: 80 }],
        rowCount: 1,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function freshRuntime() {
  return new NotebookRuntime({ notebook: emptyNotebook(), datasets: {}, models: {}, queries: {}, queryEvaluations: {} })
}

function withSalesModel() {
  const runtime = freshRuntime()
  const dataset = salesDataset()
  runtime.importDataset(dataset)
  const { model } = runtime.createModelCell('Retail')
  runtime.addTableToModel(model.id, { datasetId: dataset.id, tableId: dataset.tables[0].id })
  const salesTableId = runtime.getModel(model.id)!.tables[0].id
  return { runtime, salesTableId }
}

describe('mutationImpact', () => {
  it('analyzeDeleteModel: cascades every cell owned by the model', () => {
    const { runtime, salesTableId } = withSalesModel()
    const model = runtime.getSnapshot().notebook.cells.find((c) => c.kind === 'model')!
    const modelId = (model as { modelId: string }).modelId
    const measure = runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    const calc = runtime.createCalculatedColumnCell(modelId, { modelTableId: salesTableId, name: 'Margin', expression: 'Sales[Revenue] - Sales[Cost]' })
    const visual = runtime.createVisualCell(modelId, { id: 'v1', type: 'kpi', measureId: measure.measure!.id })

    const impact = analyzeDeleteModel(runtime.getSnapshot(), modelId)

    expect(impact.allowed).toBe(true)
    expect(new Set(impact.cascadeCellIds)).toEqual(new Set([model.id, measure.cell!.id, calc.cell!.id, visual.id]))
  })

  it('analyzeDeleteDataset: blocked when a Query sources from it', () => {
    const runtime = freshRuntime()
    const dataset = salesDataset()
    runtime.importDataset(dataset)
    runtime.createQueryFromDataset(dataset.id, dataset.tables[0].id)

    const impact = analyzeDeleteDataset(runtime.getSnapshot(), dataset.id)
    expect(impact.allowed).toBe(false)
    expect(impact.blockers[0].referenceType).toBe('DATASET_IN_USE_BY_QUERY')
  })

  it('analyzeDeleteDataset: blocked when a model table references it directly', () => {
    const { runtime } = withSalesModel()
    const impact = analyzeDeleteDataset(runtime.getSnapshot(), 'sales-ds')
    expect(impact.allowed).toBe(false)
    expect(impact.blockers[0].referenceType).toBe('DATASET_IN_USE_BY_MODEL')
  })

  it('analyzeDeleteDataset: allowed when nothing references it', () => {
    const runtime = freshRuntime()
    runtime.importDataset(salesDataset())
    const impact = analyzeDeleteDataset(runtime.getSnapshot(), 'sales-ds')
    expect(impact.allowed).toBe(true)
  })

  it('analyzeDisableQueryLoad: blocked when a model uses the loaded output', () => {
    const runtime = freshRuntime()
    const dataset = salesDataset()
    runtime.importDataset(dataset)
    const { query } = runtime.createQueryFromDataset(dataset.id, dataset.tables[0].id)
    const { model } = runtime.createModelCell('Retail')
    runtime.addTableToModel(model.id, { datasetId: query.outputDatasetId, tableId: query.outputTableId })

    const impact = analyzeDisableQueryLoad(runtime.getSnapshot(), query.id)
    expect(impact.allowed).toBe(false)
    expect(impact.blockers[0].referenceType).toBe('QUERY_LOAD_IN_USE_BY_MODEL')
  })

  it('analyzeDisableQueryLoad: allowed when no model uses the output', () => {
    const runtime = freshRuntime()
    const dataset = salesDataset()
    runtime.importDataset(dataset)
    const { query } = runtime.createQueryFromDataset(dataset.id, dataset.tables[0].id)

    expect(analyzeDisableQueryLoad(runtime.getSnapshot(), query.id).allowed).toBe(true)
  })

  it('analyzeRemoveModelTable: cascades measures/cells homed on the removed table', () => {
    const { runtime, salesTableId } = withSalesModel()
    const modelCell = runtime.getSnapshot().notebook.cells.find((c) => c.kind === 'model')!
    const modelId = (modelCell as { modelId: string }).modelId
    const measure = runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    const visual = runtime.createVisualCell(modelId, { id: 'v1', type: 'kpi', measureId: measure.measure!.id })

    const impact = analyzeRemoveModelTable(runtime.getSnapshot(), modelId, salesTableId)

    expect(impact.cascadeMeasureIds).toEqual([measure.measure!.id])
    expect(new Set(impact.cascadeCellIds)).toEqual(new Set([measure.cell!.id, visual.id]))
  })

  it('analyzeDeleteMeasure: blocked when another measure depends on it', () => {
    const { runtime, salesTableId } = withSalesModel()
    const modelCell = runtime.getSnapshot().notebook.cells.find((c) => c.kind === 'model')!
    const modelId = (modelCell as { modelId: string }).modelId
    const base = runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: 'Revenue x2', expression: '[Total Revenue] * 2' })

    const impact = analyzeDeleteMeasure(runtime.getSnapshot(), modelId, base.measure!.id)
    expect(impact.allowed).toBe(false)
    expect(impact.blockers[0].referenceType).toBe('MEASURE_IN_USE_BY_MEASURE')
  })

  it('analyzeDeleteMeasure: blocked when a visual references it', () => {
    const { runtime, salesTableId } = withSalesModel()
    const modelCell = runtime.getSnapshot().notebook.cells.find((c) => c.kind === 'model')!
    const modelId = (modelCell as { modelId: string }).modelId
    const measure = runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    runtime.createVisualCell(modelId, { id: 'v1', type: 'kpi', measureId: measure.measure!.id })

    const impact = analyzeDeleteMeasure(runtime.getSnapshot(), modelId, measure.measure!.id)
    expect(impact.allowed).toBe(false)
    expect(impact.blockers[0].referenceType).toBe('MEASURE_IN_USE_BY_VISUAL')
  })

  it('analyzeDeleteMeasure: allowed when nothing depends on it', () => {
    const { runtime, salesTableId } = withSalesModel()
    const modelCell = runtime.getSnapshot().notebook.cells.find((c) => c.kind === 'model')!
    const modelId = (modelCell as { modelId: string }).modelId
    const measure = runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })

    expect(analyzeDeleteMeasure(runtime.getSnapshot(), modelId, measure.measure!.id).allowed).toBe(true)
  })

  it('analyzeDeleteCalculatedColumn: blocked when a measure references it by name', () => {
    const { runtime, salesTableId } = withSalesModel()
    const modelCell = runtime.getSnapshot().notebook.cells.find((c) => c.kind === 'model')!
    const modelId = (modelCell as { modelId: string }).modelId
    const calc = runtime.createCalculatedColumnCell(modelId, { modelTableId: salesTableId, name: 'Margin', expression: 'Sales[Revenue] - Sales[Cost]' })
    runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: 'Total Margin', expression: 'SUM(Sales[Margin])' })

    const impact = analyzeDeleteCalculatedColumn(runtime.getSnapshot(), modelId, calc.calculatedColumn!.id)
    expect(impact.allowed).toBe(false)
    expect(impact.blockers[0].referenceType).toBe('COLUMN_IN_USE_BY_MEASURE')
  })

  it('analyzeDeleteCalculatedColumn: allowed when nothing references it', () => {
    const { runtime, salesTableId } = withSalesModel()
    const modelCell = runtime.getSnapshot().notebook.cells.find((c) => c.kind === 'model')!
    const modelId = (modelCell as { modelId: string }).modelId
    const calc = runtime.createCalculatedColumnCell(modelId, { modelTableId: salesTableId, name: 'Margin', expression: 'Sales[Revenue] - Sales[Cost]' })

    expect(analyzeDeleteCalculatedColumn(runtime.getSnapshot(), modelId, calc.calculatedColumn!.id).allowed).toBe(true)
  })
})
