import type { GenericNotebookCell, ModelCell, NotebookCell, NotebookDocument } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import type { ColumnRef, RelationshipDiagnostic, SemanticModel, TableRef } from '../../domain/model'
import { generateId } from '../../lib/ids'
import * as modelRuntime from '../model/modelRuntime'

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

  createRelationship(
    modelId: string,
    input: { one: ColumnRef; many: ColumnRef; active?: boolean },
  ): RelationshipDiagnostic[] {
    const model = this.getModel(modelId)
    if (!model) return []
    const result = modelRuntime.createRelationship(model, input, this.snapshot.datasets)
    this.commitModel(result.model)
    return result.diagnostics
  }

  removeRelationship(modelId: string, relationshipId: string): void {
    const model = this.getModel(modelId)
    if (!model) return
    this.commitModel(modelRuntime.removeRelationship(model, relationshipId))
  }

  setRelationshipActive(modelId: string, relationshipId: string, active: boolean): void {
    const model = this.getModel(modelId)
    if (!model) return
    this.commitModel(modelRuntime.setRelationshipActive(model, relationshipId, active))
  }
}
