import type { CalculatedColumnCell, GenericNotebookCell, MeasureCell, ModelCell, NotebookCell, NotebookDocument, TestCell, VisualCell } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import type { CalculatedColumn, ColumnRef, Measure, RelationshipDiagnostic, SemanticModel, TableRef } from '../../domain/model'
import type { ValidationSpec } from '../../domain/validation'
import type { VisualSpec } from '../../domain/visual'
import type { ExpressionDiagnostic } from '../../expression/diagnostics'
import { generateId } from '../../lib/ids'
import * as calculatedColumnRuntime from '../calculatedColumn/calculatedColumnRuntime'
import type { CalculatedColumnExecution, CalculatedColumnInput } from '../calculatedColumn/calculatedColumnRuntime'
import * as measureRuntime from '../measure/measureRuntime'
import type { MeasureExecution, MeasureInput } from '../measure/measureRuntime'
import * as modelRuntime from '../model/modelRuntime'
import * as dateTableRuntime from '../dateTable/dateTableRuntime'
import type { DateTableDiagnostic } from '../dateTable/dateTableTypes'

export interface NotebookRuntimeSnapshot {
  notebook: NotebookDocument
  datasets: Record<string, Dataset>
  models: Record<string, SemanticModel>
}

export function emptyNotebook(title = 'Untitled Notebook'): NotebookDocument {
  return {
    id: generateId('notebook'),
    title,
    description: '',
    difficulty: 'beginner',
    cells: [],
  }
}

function datasetCellTitle(dataset: Dataset): string {
  const table = dataset.tables[0]
  return table ? table.name : dataset.name
}

/**
 * Owns notebook structure and the in-memory dataset registry. Pure and
 * framework-free per AGENTS.md ("keep BI semantics outside React
 * components", "every execution result should be testable headlessly") —
 * persistence and React wiring both live outside this class.
 */
export class NotebookRuntime {
  private snapshot: NotebookRuntimeSnapshot
  private readonly listeners = new Set<() => void>()

  constructor(initial: NotebookRuntimeSnapshot) {
    this.snapshot = initial
  }

  getSnapshot = (): NotebookRuntimeSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private commit(
    notebook: NotebookDocument,
    datasets: Record<string, Dataset> = this.snapshot.datasets,
    models: Record<string, SemanticModel> = this.snapshot.models,
  ): void {
    this.snapshot = { notebook, datasets, models }
    this.listeners.forEach((listener) => listener())
  }

  replaceAll(next: NotebookRuntimeSnapshot): void {
    this.snapshot = next
    this.listeners.forEach((listener) => listener())
  }

  renameNotebook(title: string): void {
    this.commit({ ...this.snapshot.notebook, title })
  }

  addCell(cell: NotebookCell, index?: number): void {
    const cells = [...this.snapshot.notebook.cells]
    const insertAt = index === undefined ? cells.length : Math.max(0, Math.min(index, cells.length))
    cells.splice(insertAt, 0, cell)
    this.commit({ ...this.snapshot.notebook, cells })
  }

  removeCell(id: string): void {
    const cells = this.snapshot.notebook.cells.filter((cell) => cell.id !== id)
    this.commit({ ...this.snapshot.notebook, cells })
  }

  moveCell(id: string, toIndex: number): void {
    const cells = [...this.snapshot.notebook.cells]
    const fromIndex = cells.findIndex((cell) => cell.id === id)
    if (fromIndex === -1) return

    const [cell] = cells.splice(fromIndex, 1)
    const clampedIndex = Math.max(0, Math.min(toIndex, cells.length))
    cells.splice(clampedIndex, 0, cell)
    this.commit({ ...this.snapshot.notebook, cells })
  }

  /**
   * Patches generic cell fields (title/status/prompt/source/meta). Do not
   * use this to change `kind`, `datasetId`, or `modelId` — construct or
   * replace the cell via the dedicated action (`importDataset`,
   * `createModelCell`, etc.) instead.
   */
  updateCell(id: string, patch: Partial<Pick<GenericNotebookCell, 'title' | 'status' | 'prompt' | 'source' | 'meta'>>): void {
    const cells = this.snapshot.notebook.cells.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell))
    this.commit({ ...this.snapshot.notebook, cells })
  }

  getDataset(datasetId: string): Dataset | undefined {
    return this.snapshot.datasets[datasetId]
  }

  /** Registers a dataset and appends a DataCell that represents it. */
  importDataset(dataset: Dataset): NotebookCell {
    const cell: NotebookCell = {
      id: generateId('cell'),
      kind: 'data',
      title: datasetCellTitle(dataset),
      datasetId: dataset.id,
      status: 'idle',
    }
    const cells = [...this.snapshot.notebook.cells, cell]
    const datasets = { ...this.snapshot.datasets, [dataset.id]: dataset }
    this.commit({ ...this.snapshot.notebook, cells }, datasets)
    return cell
  }

  /** Removes a dataset and any DataCells that reference it. */
  removeDataset(datasetId: string): void {
    const cells = this.snapshot.notebook.cells.filter((cell) => !(cell.kind === 'data' && cell.datasetId === datasetId))
    const datasets = { ...this.snapshot.datasets }
    delete datasets[datasetId]
    this.commit({ ...this.snapshot.notebook, cells }, datasets)
  }

  getModel(modelId: string): SemanticModel | undefined {
    return this.snapshot.models[modelId]
  }

  private commitModel(model: SemanticModel): void {
    const models = { ...this.snapshot.models, [model.id]: model }
    this.commit(this.snapshot.notebook, this.snapshot.datasets, models)
  }

  /** Creates an empty SemanticModel and appends a ModelCell that represents it. */
  createModelCell(name?: string): { cell: ModelCell; model: SemanticModel } {
    const model = modelRuntime.createModel(name)
    const cell: ModelCell = {
      id: generateId('cell'),
      kind: 'model',
      title: model.name,
      modelId: model.id,
      status: 'idle',
    }
    const cells = [...this.snapshot.notebook.cells, cell]
    const models = { ...this.snapshot.models, [model.id]: model }
    this.commit({ ...this.snapshot.notebook, cells }, this.snapshot.datasets, models)
    return { cell, model }
  }

  /** Removes a model and any ModelCells that reference it. */
  removeModel(modelId: string): void {
    const cells = this.snapshot.notebook.cells.filter((cell) => !(cell.kind === 'model' && cell.modelId === modelId))
    const models = { ...this.snapshot.models }
    delete models[modelId]
    this.commit({ ...this.snapshot.notebook, cells }, this.snapshot.datasets, models)
  }

  addTableToModel(modelId: string, ref: TableRef): void {
    const model = this.getModel(modelId)
    if (!model) return
    this.commitModel(modelRuntime.addTable(model, ref))
  }

  removeTableFromModel(modelId: string, modelTableId: string): void {
    const model = this.getModel(modelId)
    if (!model) return
    this.commitModel(modelRuntime.removeTable(model, modelTableId))
  }

  moveModelTable(modelId: string, modelTableId: string, position: { x: number; y: number }): void {
    const model = this.getModel(modelId)
    if (!model) return
    this.commitModel(modelRuntime.moveTable(model, modelTableId, position))
  }

  createRelationship(modelId: string, input: modelRuntime.RelationshipConfigInput): RelationshipDiagnostic[] {
    const model = this.getModel(modelId)
    if (!model) return []
    const result = modelRuntime.createRelationshipConfig(model, input, this.snapshot.datasets)
    this.commitModel(result.model)
    return result.diagnostics
  }

  updateRelationship(modelId: string, relationshipId: string, changes: modelRuntime.RelationshipConfigInput): RelationshipDiagnostic[] {
    const model = this.getModel(modelId)
    if (!model) return []
    const result = modelRuntime.updateRelationship(model, relationshipId, changes, this.snapshot.datasets)
    this.commitModel(result.model)
    return result.diagnostics
  }

  removeRelationship(modelId: string, relationshipId: string): void {
    const model = this.getModel(modelId)
    if (!model) return
    this.commitModel(modelRuntime.removeRelationship(model, relationshipId))
  }

  setRelationshipActive(modelId: string, relationshipId: string, active: boolean): RelationshipDiagnostic[] {
    const model = this.getModel(modelId)
    if (!model) return []
    const result = modelRuntime.setRelationshipActive(model, relationshipId, active)
    this.commitModel(result.model)
    return result.diagnostics
  }

  /** Validates and, if valid, marks `modelTableId` as a Date Table (docs/DATE_TABLES.md) — never partially applies an invalid marking. */
  markDateTable(modelId: string, modelTableId: string, dateColumn: ColumnRef): DateTableDiagnostic[] {
    const model = this.getModel(modelId)
    if (!model) return []
    const result = dateTableRuntime.markDateTable(model, this.snapshot.datasets, modelTableId, dateColumn)
    this.commitModel(result.model)
    return result.diagnostics
  }

  unmarkDateTable(modelId: string, modelTableId: string): void {
    const model = this.getModel(modelId)
    if (!model) return
    this.commitModel(dateTableRuntime.unmarkDateTable(model, modelTableId))
  }

  /**
   * Creates a `CalculatedColumn` definition on the model and, only if it
   * validates (no error diagnostics), appends the `CalculatedColumnCell`
   * that references it. A syntax/binding failure leaves both the model and
   * the notebook unchanged — the diagnostics are returned so the caller
   * (the create panel) can show them without ever creating a cell.
   */
  createCalculatedColumnCell(
    modelId: string,
    input: CalculatedColumnInput,
  ): { cell?: CalculatedColumnCell; calculatedColumn?: CalculatedColumn; execution?: CalculatedColumnExecution; diagnostics: ExpressionDiagnostic[] } {
    const model = this.getModel(modelId)
    if (!model) return { diagnostics: [] }

    const result = calculatedColumnRuntime.createCalculatedColumn(model, this.snapshot.datasets, input)
    if (!result.calculatedColumn) {
      return { diagnostics: result.diagnostics }
    }

    const cell: CalculatedColumnCell = {
      id: generateId('cell'),
      kind: 'calculated-column',
      title: result.calculatedColumn.name,
      modelId,
      calculatedColumnId: result.calculatedColumn.id,
      status: 'idle',
    }
    const cells = [...this.snapshot.notebook.cells, cell]
    const models = { ...this.snapshot.models, [model.id]: result.model }
    this.commit({ ...this.snapshot.notebook, cells }, this.snapshot.datasets, models)

    return { cell, calculatedColumn: result.calculatedColumn, execution: result.execution, diagnostics: result.diagnostics }
  }

  /** Re-validates and re-evaluates an existing calculated column, updating its cell title if the name changed. */
  updateCalculatedColumn(
    modelId: string,
    calculatedColumnId: string,
    patch: { name?: string; expression?: string },
  ): { calculatedColumn?: CalculatedColumn; execution?: CalculatedColumnExecution; diagnostics: ExpressionDiagnostic[] } {
    const model = this.getModel(modelId)
    if (!model) return { diagnostics: [] }

    const result = calculatedColumnRuntime.updateCalculatedColumn(model, this.snapshot.datasets, calculatedColumnId, patch)
    if (!result.calculatedColumn) {
      return { diagnostics: result.diagnostics }
    }

    const cells = this.snapshot.notebook.cells.map((cell) =>
      cell.kind === 'calculated-column' && cell.calculatedColumnId === calculatedColumnId
        ? { ...cell, title: result.calculatedColumn!.name }
        : cell,
    )
    const models = { ...this.snapshot.models, [model.id]: result.model }
    this.commit({ ...this.snapshot.notebook, cells }, this.snapshot.datasets, models)

    return { calculatedColumn: result.calculatedColumn, execution: result.execution, diagnostics: result.diagnostics }
  }

  /** Removes a CalculatedColumnCell and its underlying definition together. */
  removeCalculatedColumnCell(cellId: string): void {
    const cell = this.snapshot.notebook.cells.find((c) => c.id === cellId)
    if (!cell || cell.kind !== 'calculated-column') return

    const model = this.getModel(cell.modelId)
    const cells = this.snapshot.notebook.cells.filter((c) => c.id !== cellId)
    const models = model
      ? { ...this.snapshot.models, [model.id]: calculatedColumnRuntime.removeCalculatedColumn(model, cell.calculatedColumnId) }
      : this.snapshot.models
    this.commit({ ...this.snapshot.notebook, cells }, this.snapshot.datasets, models)
  }

  /**
   * Creates a `Measure` definition on the model and, only if it validates
   * (no error diagnostics), appends the `MeasureCell` that references it —
   * mirrors `createCalculatedColumnCell` exactly (docs/MEASURES.md).
   */
  createMeasureCell(
    modelId: string,
    input: MeasureInput,
  ): { cell?: MeasureCell; measure?: Measure; execution?: MeasureExecution; diagnostics: ExpressionDiagnostic[] } {
    const model = this.getModel(modelId)
    if (!model) return { diagnostics: [] }

    const result = measureRuntime.createMeasure(model, this.snapshot.datasets, input)
    if (!result.measure) {
      return { diagnostics: result.diagnostics }
    }

    const cell: MeasureCell = {
      id: generateId('cell'),
      kind: 'measure',
      title: result.measure.name,
      modelId,
      measureId: result.measure.id,
      status: 'idle',
    }
    const cells = [...this.snapshot.notebook.cells, cell]
    const models = { ...this.snapshot.models, [model.id]: result.model }
    this.commit({ ...this.snapshot.notebook, cells }, this.snapshot.datasets, models)

    return { cell, measure: result.measure, execution: result.execution, diagnostics: result.diagnostics }
  }

  /** Re-validates and re-evaluates an existing measure, updating its cell title if the name changed. */
  updateMeasure(
    modelId: string,
    measureId: string,
    patch: { name?: string; expression?: string; homeModelTableId?: string },
  ): { measure?: Measure; execution?: MeasureExecution; diagnostics: ExpressionDiagnostic[] } {
    const model = this.getModel(modelId)
    if (!model) return { diagnostics: [] }

    const result = measureRuntime.updateMeasure(model, this.snapshot.datasets, measureId, patch)
    if (!result.measure) {
      return { diagnostics: result.diagnostics }
    }

    const cells = this.snapshot.notebook.cells.map((cell) =>
      cell.kind === 'measure' && cell.measureId === measureId ? { ...cell, title: result.measure!.name } : cell,
    )
    const models = { ...this.snapshot.models, [model.id]: result.model }
    this.commit({ ...this.snapshot.notebook, cells }, this.snapshot.datasets, models)

    return { measure: result.measure, execution: result.execution, diagnostics: result.diagnostics }
  }

  /** Removes a MeasureCell and its underlying definition together. */
  removeMeasureCell(cellId: string): void {
    const cell = this.snapshot.notebook.cells.find((c) => c.id === cellId)
    if (!cell || cell.kind !== 'measure') return

    const model = this.getModel(cell.modelId)
    const cells = this.snapshot.notebook.cells.filter((c) => c.id !== cellId)
    const models = model ? { ...this.snapshot.models, [model.id]: measureRuntime.removeMeasure(model, cell.measureId) } : this.snapshot.models
    this.commit({ ...this.snapshot.notebook, cells }, this.snapshot.datasets, models)
  }

  /**
   * Appends a `TestCell` referencing an existing model and a `ValidationSpec`
   * — there is no exercise-authoring UI yet (Sprint 5 brief §35), so this is
   * currently only used by the built-in "+ Add Retail checkpoint" action.
   * Unlike calculated columns/measures there is no validation step: a
   * `ValidationSpec` is just data, so any spec can be attached to any model.
   */
  createTestCell(modelId: string, validation: ValidationSpec, title?: string, prompt?: string): TestCell {
    const cell: TestCell = {
      id: generateId('cell'),
      kind: 'test',
      title: title ?? validation.title,
      modelId,
      prompt,
      validation,
      status: 'idle',
    }
    this.addCell(cell)
    return cell
  }

  /** Removes a TestCell. A ValidationSpec has no separate persisted state to clean up — it lives entirely on the cell. */
  removeTestCell(cellId: string): void {
    this.removeCell(cellId)
  }

  /**
   * Appends a `VisualCell`. Unlike `MeasureCell`/`CalculatedColumnCell`
   * there is no expression to validate at create time — a `VisualSpec` is
   * just field-mapping data, mirroring `TestCell`'s `ValidationSpec`
   * (docs/VISUAL_CELLS.md). A visual referencing a since-deleted
   * measure/column fails safely at render time instead (see
   * `runtime/visual/*` diagnostics).
   */
  createVisualCell(modelId: string, visual: VisualSpec, title?: string): VisualCell {
    const cell: VisualCell = {
      id: generateId('cell'),
      kind: 'visual',
      title: title ?? visual.title ?? visual.type,
      modelId,
      visual,
      status: 'idle',
    }
    this.addCell(cell)
    return cell
  }

  /** Replaces a VisualCell's field mapping in place, so editing a visual never requires deleting/recreating the cell (brief §44). */
  updateVisualCell(cellId: string, patch: Partial<VisualSpec>, title?: string): void {
    const cells = this.snapshot.notebook.cells.map((cell) => {
      if (cell.id !== cellId || cell.kind !== 'visual') return cell
      const visual = { ...cell.visual, ...patch } as VisualSpec
      return { ...cell, visual, title: title ?? cell.title }
    })
    this.commit({ ...this.snapshot.notebook, cells })
  }

  /** Removes a VisualCell. A VisualSpec has no separate persisted state to clean up — it lives entirely on the cell, mirroring TestCell. */
  removeVisualCell(cellId: string): void {
    this.removeCell(cellId)
  }
}
