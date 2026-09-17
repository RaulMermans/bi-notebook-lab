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
 * A calculated column cell stores references only — the actual
 * `CalculatedColumn` definition (expression, target table, data type) lives
 * in the `SemanticModel` named by `modelId`. Both ids are always required:
 * there is no "draft" CalculatedColumnCell. An expression that fails to
 * parse/bind never becomes a cell — it stays in UI-only editor state until
 * it validates (see docs/CALCULATED_COLUMNS.md).
 */
export interface CalculatedColumnCell extends BaseNotebookCell {
  kind: 'calculated-column'
  modelId: string
  calculatedColumnId: string
}

/**
 * Cell kinds not yet backed by a runtime (Sprint 4+). Kept as one loose
 * shape rather than a fully-typed member per kind until each one gets a
 * real domain/execution contract (AGENTS.md: "New cell types require a
 * domain contract and execution contract first").
 */
export type GenericCellKind = 'markdown' | 'measure' | 'visual' | 'question' | 'test'

export interface GenericNotebookCell extends BaseNotebookCell {
  kind: GenericCellKind
  prompt?: string
  source?: string
  meta?: Record<string, unknown>
}

export type NotebookCell = DataCell | ModelCell | CalculatedColumnCell | GenericNotebookCell
export type CellKind = NotebookCell['kind']

export interface NotebookDocument {
  id: string
  title: string
  description: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  cells: NotebookCell[]
}
