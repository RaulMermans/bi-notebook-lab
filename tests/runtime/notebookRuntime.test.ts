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

  function withSalesModel() {
    const runtime = new NotebookRuntime({ notebook: emptyNotebook(), datasets: {}, models: {} })
    const sales = fakeDataset('sales-ds', 'Sales')
    sales.tables[0].columns = [
      { id: 'revenue-col', name: 'Revenue', dataType: 'integer', nullable: false },
      { id: 'cost-col', name: 'Cost', dataType: 'integer', nullable: false },
    ]
    sales.tables[0].rows = [{ Revenue: 120, Cost: 80 }]
    sales.tables[0].rowCount = 1
    runtime.importDataset(sales)

    const { model } = runtime.createModelCell('Retail')
    runtime.addTableToModel(model.id, { datasetId: sales.id, tableId: sales.tables[0].id })
    const salesTableId = runtime.getModel(model.id)!.tables[0].id
    return { runtime, model, salesTableId }
  }

  it('creates a CalculatedColumnCell only when the expression validates, and appends it to both notebook and model', () => {
    const { runtime, model, salesTableId } = withSalesModel()

    const result = runtime.createCalculatedColumnCell(model.id, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })

    expect(result.diagnostics).toEqual([])
    const snapshot = runtime.getSnapshot()
    // withSalesModel already produced a DataCell + a ModelCell before this call.
    expect(snapshot.notebook.cells).toHaveLength(3)
    expect(snapshot.notebook.cells[2]).toMatchObject({
      kind: 'calculated-column',
      modelId: model.id,
      calculatedColumnId: result.calculatedColumn!.id,
      title: 'Margin',
    })
    expect(snapshot.models[model.id].calculatedColumns).toHaveLength(1)
  })

  it('does not create a cell when the calculated column fails to validate', () => {
    const { runtime, model, salesTableId } = withSalesModel()

    const result = runtime.createCalculatedColumnCell(model.id, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Nope]',
    })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'UNKNOWN_COLUMN' })])
    const snapshot = runtime.getSnapshot()
    expect(snapshot.notebook.cells).toHaveLength(2) // just the DataCell + ModelCell
    expect(snapshot.models[model.id].calculatedColumns).toHaveLength(0)
  })

  it('updates a calculated column and renames its cell to match', () => {
    const { runtime, model, salesTableId } = withSalesModel()
    const created = runtime.createCalculatedColumnCell(model.id, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })

    const updated = runtime.updateCalculatedColumn(model.id, created.calculatedColumn!.id, { name: 'Profit' })

    expect(updated.diagnostics).toEqual([])
    const snapshot = runtime.getSnapshot()
    expect(snapshot.notebook.cells[2].title).toBe('Profit')
    expect(snapshot.models[model.id].calculatedColumns[0].name).toBe('Profit')
  })

  it('removes a CalculatedColumnCell and its definition together', () => {
    const { runtime, model, salesTableId } = withSalesModel()
    const created = runtime.createCalculatedColumnCell(model.id, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })

    runtime.removeCalculatedColumnCell(created.cell!.id)

    const snapshot = runtime.getSnapshot()
    expect(snapshot.notebook.cells).toHaveLength(2)
    expect(snapshot.models[model.id].calculatedColumns).toHaveLength(0)
  })

  it('creates a MeasureCell only when the expression validates, and appends it to both notebook and model', () => {
    const { runtime, model, salesTableId } = withSalesModel()

    const result = runtime.createMeasureCell(model.id, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue])',
    })

    expect(result.diagnostics).toEqual([])
    const snapshot = runtime.getSnapshot()
    expect(snapshot.notebook.cells).toHaveLength(3)
    expect(snapshot.notebook.cells[2]).toMatchObject({
      kind: 'measure',
      modelId: model.id,
      measureId: result.measure!.id,
      title: 'Total Revenue',
    })
    expect(snapshot.models[model.id].measures).toHaveLength(1)
    expect(result.execution?.value).toBe(120)
  })

  it('does not create a cell when the measure fails to validate', () => {
    const { runtime, model, salesTableId } = withSalesModel()

    const result = runtime.createMeasureCell(model.id, {
      homeModelTableId: salesTableId,
      name: 'Bad Measure',
      expression: 'Sales[Revenue]',
    })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'COLUMN_REQUIRES_AGGREGATION' })])
    const snapshot = runtime.getSnapshot()
    expect(snapshot.notebook.cells).toHaveLength(2) // just the DataCell + ModelCell
    expect(snapshot.models[model.id].measures).toHaveLength(0)
  })

  it('updates a measure and renames its cell to match', () => {
    const { runtime, model, salesTableId } = withSalesModel()
    const created = runtime.createMeasureCell(model.id, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue])',
    })

    const updated = runtime.updateMeasure(model.id, created.measure!.id, { name: 'Revenue Total' })

    expect(updated.diagnostics).toEqual([])
    const snapshot = runtime.getSnapshot()
    expect(snapshot.notebook.cells[2].title).toBe('Revenue Total')
    expect(snapshot.models[model.id].measures[0].name).toBe('Revenue Total')
  })

  it('removes a MeasureCell and its definition together', () => {
    const { runtime, model, salesTableId } = withSalesModel()
    const created = runtime.createMeasureCell(model.id, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue])',
    })

    runtime.removeMeasureCell(created.cell!.id)

    const snapshot = runtime.getSnapshot()
    expect(snapshot.notebook.cells).toHaveLength(2)
    expect(snapshot.models[model.id].measures).toHaveLength(0)
  })

  it('creates a VisualCell with no validation step (a VisualSpec is authored data, like a ValidationSpec)', () => {
    const { runtime, model, salesTableId } = withSalesModel()
    const measure = runtime.createMeasureCell(model.id, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue])',
    })

    const cell = runtime.createVisualCell(model.id, { id: 'v1', type: 'kpi', measureId: measure.measure!.id }, 'Total Revenue KPI')

    const snapshot = runtime.getSnapshot()
    expect(snapshot.notebook.cells).toHaveLength(4)
    expect(snapshot.notebook.cells[3]).toMatchObject({ id: cell.id, kind: 'visual', modelId: model.id, title: 'Total Revenue KPI' })
    expect((snapshot.notebook.cells[3] as typeof cell).visual).toEqual({ id: 'v1', type: 'kpi', measureId: measure.measure!.id })
  })

  it('updates a VisualCell field mapping in place, without deleting/recreating the cell', () => {
    const { runtime, model } = withSalesModel()
    const cell = runtime.createVisualCell(model.id, { id: 'v1', type: 'slicer', column: { datasetId: 'sales-ds', tableId: 'sales-ds-table', columnId: 'revenue-col' }, mode: 'single' })

    runtime.updateVisualCell(cell.id, { mode: 'multi' }, 'Renamed Slicer')

    const snapshot = runtime.getSnapshot()
    expect(snapshot.notebook.cells).toHaveLength(3)
    const updated = snapshot.notebook.cells.find((c) => c.id === cell.id)!
    expect(updated.title).toBe('Renamed Slicer')
    expect((updated as typeof cell).visual).toMatchObject({ mode: 'multi', column: cell.visual.column })
  })

  it('removes a VisualCell (a VisualSpec has no separate persisted state to clean up)', () => {
    const { runtime, model } = withSalesModel()
    const cell = runtime.createVisualCell(model.id, { id: 'v1', type: 'kpi', measureId: 'does-not-matter' })

    runtime.removeVisualCell(cell.id)

    const snapshot = runtime.getSnapshot()
    expect(snapshot.notebook.cells).toHaveLength(2)
  })
})
