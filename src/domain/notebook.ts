export type CellStatus = 'idle' | 'running' | 'passed' | 'failed'

export interface BaseNotebookCell {
  id: string
  title: string
  status?: CellStatus
}

export interface DataCell extends BaseNotebookCell {
  kind: 'data'
  /** The Dataset this DataCell represents. Always required — a DataCell without one cannot exist. */
  datasetId: string
}

export interface ModelCell extends BaseNotebookCell {
  kind: 'model'
  /** The SemanticModel this ModelCell represents. Always required. */
  modelId: string
}

/**
 * Cell kinds not yet backed by a runtime (Sprint 3+). Kept as one loose
 * shape rather than a fully-typed member per kind until each one gets a
 * real domain/execution contract (AGENTS.md: "New cell types require a
 * domain contract and execution contract first").
 */
export type GenericCellKind = 'markdown' | 'calculated-column' | 'measure' | 'visual' | 'question' | 'test'

export interface GenericNotebookCell extends BaseNotebookCell {
  kind: GenericCellKind
  prompt?: string
  source?: string
  meta?: Record<string, unknown>
}

export type NotebookCell = DataCell | ModelCell | GenericNotebookCell
export type CellKind = NotebookCell['kind']

export interface NotebookDocument {
  id: string
  title: string
  description: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  cells: NotebookCell[]
}
