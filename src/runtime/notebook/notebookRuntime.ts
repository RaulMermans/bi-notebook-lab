import type { NotebookCell, NotebookDocument } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import { generateId } from '../../lib/ids'

export interface NotebookRuntimeSnapshot {
  notebook: NotebookDocument
  datasets: Record<string, Dataset>
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

  private commit(notebook: NotebookDocument, datasets: Record<string, Dataset> = this.snapshot.datasets): void {
    this.snapshot = { notebook, datasets }
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

  updateCell(id: string, patch: Partial<NotebookCell>): void {
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
    const cells = this.snapshot.notebook.cells.filter((cell) => cell.datasetId !== datasetId)
    const datasets = { ...this.snapshot.datasets }
    delete datasets[datasetId]
    this.commit({ ...this.snapshot.notebook, cells }, datasets)
  }
}
