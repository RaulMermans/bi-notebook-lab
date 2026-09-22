import type { Dataset } from '../../../domain/data'
import { generateRetailDataset } from '../../../lib/sample/generateRetailDataset'
import { NotebookRuntime, emptyNotebook } from '../../../runtime/notebook/notebookRuntime'

function findColumnId(dataset: Dataset, columnName: string): string {
  const column = dataset.tables[0].columns.find((c) => c.name === columnName)
  if (!column) throw new Error(`Column "${columnName}" not found on dataset "${dataset.name}"`)
  return column.id
}

export interface RetailModelBuildResult {
  modelId: string
  /** The Sales table's `ModelTable.id` (not the dataset table id) — the home table for every Retail measure/calculated column. */
  salesTableId: string
  customersDs: Dataset
  productsDs: Dataset
  salesDs: Dataset
  calendarDs: Dataset
}

/**
 * Drives the real `NotebookRuntime`/model runtime to build a fresh Retail
 * base: imports the four Retail datasets, creates a model, adds all four
 * tables (no relationships yet). Shared by every built-in Retail lesson so
 * each one starts from an identical, deterministic base — mirrors
 * `tests/runtime/validation/helpers.ts#buildRetailModel`, but lives in
 * `src/` since a lesson initializer is product code, not test code (sprint
 * brief "Lesson Bootstrap Boundary").
 */
export function buildRetailNotebookBase(runtime: NotebookRuntime): RetailModelBuildResult {
  const [customersDs, productsDs, salesDs, calendarDs] = generateRetailDataset()

  runtime.importDataset(customersDs)
  runtime.importDataset(productsDs)
  runtime.importDataset(salesDs)
  runtime.importDataset(calendarDs)

  const { model } = runtime.createModelCell('Retail Model')
  runtime.addTableToModel(model.id, { datasetId: customersDs.id, tableId: customersDs.tables[0].id })
  runtime.addTableToModel(model.id, { datasetId: productsDs.id, tableId: productsDs.tables[0].id })
  runtime.addTableToModel(model.id, { datasetId: salesDs.id, tableId: salesDs.tables[0].id })
  runtime.addTableToModel(model.id, { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id })

  const salesTableId = runtime.getModel(model.id)!.tables.find((t) => t.datasetId === salesDs.id)!.id

  return { modelId: model.id, salesTableId, customersDs, productsDs, salesDs, calendarDs }
}

/**
 * Wires the three star-schema relationships (Customers/Products/Calendar →
 * Sales) via the real relationship runtime. Throws if any relationship
 * fails validation — a lesson's starting state must always be internally
 * consistent, so a bootstrap failure is a bug, never a silent partial
 * model.
 */
export function connectRetailStarSchema(runtime: NotebookRuntime, base: RetailModelBuildResult): void {
  const { modelId, customersDs, productsDs, salesDs, calendarDs } = base

  const relationships: { left: Dataset; leftColumn: string; right: Dataset; rightColumn: string }[] = [
    { left: customersDs, leftColumn: 'CustomerID', right: salesDs, rightColumn: 'CustomerID' },
    { left: productsDs, leftColumn: 'ProductID', right: salesDs, rightColumn: 'ProductID' },
    { left: calendarDs, leftColumn: 'Date', right: salesDs, rightColumn: 'Date' },
  ]

  for (const rel of relationships) {
    const diagnostics = runtime.createRelationship(modelId, {
      left: { datasetId: rel.left.id, tableId: rel.left.tables[0].id, columnId: findColumnId(rel.left, rel.leftColumn) },
      right: { datasetId: rel.right.id, tableId: rel.right.tables[0].id, columnId: findColumnId(rel.right, rel.rightColumn) },
      cardinality: 'one-to-many',
      oneSide: 'left',
      crossFilterDirection: 'left-to-right',
      active: true,
    })
    const errors = diagnostics.filter((d) => d.severity === 'error')
    if (errors.length > 0) {
      throw new Error(`Lesson bootstrap failed to connect ${rel.left.name} → ${rel.right.name}: ${errors.map((e) => e.message).join('; ')}`)
    }
  }
}

/**
 * Adds the complete Retail Foundations solution (Margin + Total Revenue /
 * Total Cost / Gross Margin / Orders / Average Order Value) via the real
 * calculated-column/measure runtimes. Used by lessons that build *on top
 * of* a completed Retail Foundations model (Filter Context, Time
 * Intelligence) rather than teaching star-schema modeling again.
 */
export function addRetailFoundationsSolution(runtime: NotebookRuntime, base: RetailModelBuildResult): void {
  const { modelId, salesTableId } = base

  const columnResult = runtime.createCalculatedColumnCell(modelId, {
    modelTableId: salesTableId,
    name: 'Margin',
    expression: 'Sales[Revenue] - Sales[Cost]',
  })
  if (!columnResult.calculatedColumn) {
    throw new Error(`Lesson bootstrap failed to create Margin: ${columnResult.diagnostics.map((d) => d.message).join('; ')}`)
  }

  const measures: { name: string; expression: string }[] = [
    { name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' },
    { name: 'Total Cost', expression: 'SUM(Sales[Cost])' },
    { name: 'Gross Margin', expression: '[Total Revenue] - [Total Cost]' },
    { name: 'Orders', expression: 'DISTINCTCOUNT(Sales[OrderID])' },
    { name: 'Average Order Value', expression: 'DIVIDE([Total Revenue], [Orders])' },
  ]
  for (const measure of measures) {
    const result = runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: measure.name, expression: measure.expression })
    if (!result.measure) {
      throw new Error(`Lesson bootstrap failed to create measure "${measure.name}": ${result.diagnostics.map((d) => d.message).join('; ')}`)
    }
  }
}

/**
 * Marks Calendar as the model's Date Table using its `Date` column —
 * required before any lesson can exercise classic time intelligence
 * (docs/DATE_TABLES.md).
 */
export function markRetailCalendarDateTable(runtime: NotebookRuntime, base: RetailModelBuildResult): void {
  const { modelId, calendarDs } = base
  const model = runtime.getModel(modelId)!
  const calendarModelTable = model.tables.find((t) => t.datasetId === calendarDs.id)!
  const diagnostics = runtime.markDateTable(modelId, calendarModelTable.id, {
    datasetId: calendarDs.id,
    tableId: calendarDs.tables[0].id,
    columnId: findColumnId(calendarDs, 'Date'),
  })
  const errors = diagnostics.filter((d) => d.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`Lesson bootstrap failed to mark Calendar as a Date Table: ${errors.map((e) => e.message).join('; ')}`)
  }
}

export function createLessonRuntime(notebookTitle: string): NotebookRuntime {
  return new NotebookRuntime({ notebook: emptyNotebook(notebookTitle), datasets: {}, models: {}, queries: {}, queryEvaluations: {} })
}
