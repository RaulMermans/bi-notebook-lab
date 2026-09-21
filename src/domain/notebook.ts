import type { ValidationSpec } from './validation'
import type { VisualSpec } from './visual'

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
 * A Power Query transformation cell — Sprint 12's counterpart to `DataCell`.
 * Like `ModelCell`, it stores a reference only: the actual `QueryDefinition`
 * (source, Applied Steps, load state) lives in the notebook runtime's query
 * store, mirroring how a `ModelCell` references a `SemanticModel`
 * (docs/POWER_QUERY_RUNTIME.md "QueryCell"). A `DataCell` stays the raw
 * source; a `QueryCell` is always a transformation of one (docs/CELL_SPEC.md
 * "DataCell vs QueryCell").
 */
export interface QueryCell extends BaseNotebookCell {
  kind: 'query'
  queryId: string
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
 * A measure cell stores references only — the actual `Measure` definition
 * (expression, home table, data type) lives in the `SemanticModel` named by
 * `modelId`, mirroring `CalculatedColumnCell` exactly. There is no "draft"
 * MeasureCell: an expression that fails to validate never becomes a cell
 * (see docs/MEASURES.md).
 */
export interface MeasureCell extends BaseNotebookCell {
  kind: 'measure'
  modelId: string
  measureId: string
}

/**
 * Runs one or more validation assertions against current notebook state —
 * the Sprint 5 counterpart to `MeasureCell`/`CalculatedColumnCell`. Only
 * the `ValidationSpec` (rules, targets, expected outcomes) is persisted;
 * a run's score/feedback is always recomputed, never stored (see
 * docs/VALIDATION_ENGINE.md "Persistence boundaries").
 */
export interface TestCell extends BaseNotebookCell {
  kind: 'test'
  modelId: string
  prompt?: string
  validation: ValidationSpec
}

/**
 * A visual cell owns visualization configuration only — the actual
 * `VisualSpec` (field mapping) lives on the cell itself rather than on the
 * `SemanticModel`, since a visual is notebook output, not a model artifact
 * (docs/VISUAL_CELLS.md). `modelId` names the model the visual reads from.
 * There is no "draft" VisualCell distinct from this: an unmapped/invalid
 * visual still exists as a cell and fails safely at render time (see
 * `runtime/visual/*` diagnostics) rather than being blocked from creation
 * the way an invalid expression blocks a MeasureCell.
 */
export interface VisualCell extends BaseNotebookCell {
  kind: 'visual'
  modelId: string
  visual: VisualSpec
}

/**
 * Cell kinds not yet backed by a runtime (Phase 8+). Kept as one loose
 * shape rather than a fully-typed member per kind until each one gets a
 * real domain/execution contract (AGENTS.md: "New cell types require a
 * domain contract and execution contract first").
 */
export type GenericCellKind = 'markdown' | 'question'

export interface GenericNotebookCell extends BaseNotebookCell {
  kind: GenericCellKind
  prompt?: string
  source?: string
  meta?: Record<string, unknown>
}

export type NotebookCell =
  | DataCell
  | ModelCell
  | QueryCell
  | CalculatedColumnCell
  | MeasureCell
  | TestCell
  | VisualCell
  | GenericNotebookCell
export type CellKind = NotebookCell['kind']

export interface NotebookDocument {
  id: string
  title: string
  description: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  cells: NotebookCell[]
}
