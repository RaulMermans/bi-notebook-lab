import type { DataType } from './data'

/**
 * Sprint 12 — Power Query domain. A `QueryDefinition` is the persisted,
 * authoritative description of a transformation pipeline; its evaluated
 * result (a `Dataset`) is always derived, never stored as authority (see
 * docs/POWER_QUERY_RUNTIME.md "Definitions vs. results"). This module
 * implements Power Query's Applied Steps workflow through typed steps — it
 * does not parse or execute arbitrary Power Query M (docs/POWER_QUERY_RUNTIME.md
 * "M-language boundary").
 */

export type QuerySource =
  | { kind: 'dataset-table'; datasetId: string; tableId: string }
  | { kind: 'query'; queryId: string }

export interface BaseQueryStep {
  id: string
  kind: QueryStepKind
  /** User-facing/editable label (e.g. "Filtered Rows"). Renaming a step never changes its semantic fingerprint — see queryFingerprint.ts. */
  name: string
}

export interface ColumnRename {
  columnId: string
  newName: string
}

export interface RenameColumnsStep extends BaseQueryStep {
  kind: 'rename-columns'
  renames: ColumnRename[]
}

export interface RemoveColumnsStep extends BaseQueryStep {
  kind: 'remove-columns'
  columnIds: string[]
}

export interface ReorderColumnsStep extends BaseQueryStep {
  kind: 'reorder-columns'
  /** The full column id order to apply. Columns not listed keep their relative order at the end. */
  columnOrder: string[]
}

export interface ColumnTypeChange {
  columnId: string
  dataType: DataType
}

export interface ChangeTypeStep extends BaseQueryStep {
  kind: 'change-type'
  changes: ColumnTypeChange[]
}

export type QueryFilterOperator =
  | 'equals'
  | 'not-equals'
  | 'greater-than'
  | 'greater-than-or-equal'
  | 'less-than'
  | 'less-than-or-equal'
  | 'contains'
  | 'starts-with'
  | 'ends-with'
  | 'is-blank'
  | 'is-not-blank'

export interface QueryFilterCondition {
  columnId: string
  operator: QueryFilterOperator
  /** Unused for `is-blank` / `is-not-blank`. */
  value?: unknown
}

export interface FilterRowsStep extends BaseQueryStep {
  kind: 'filter-rows'
  logic: 'and' | 'or'
  conditions: QueryFilterCondition[]
}

export interface QueryReplacement {
  columnId: string
  find: unknown
  replace: unknown
}

export interface ReplaceValuesStep extends BaseQueryStep {
  kind: 'replace-values'
  replacements: QueryReplacement[]
}

export interface RemoveDuplicatesStep extends BaseQueryStep {
  kind: 'remove-duplicates'
  /** Omitted/empty means "all columns". */
  columnIds?: string[]
}

export interface QuerySortKey {
  columnId: string
  direction: 'asc' | 'desc'
}

export interface SortRowsStep extends BaseQueryStep {
  kind: 'sort-rows'
  keys: QuerySortKey[]
}

export interface FillStep extends BaseQueryStep {
  kind: 'fill'
  direction: 'down' | 'up'
  columnIds: string[]
}

export interface SplitColumnStep extends BaseQueryStep {
  kind: 'split-column'
  columnId: string
  delimiter: string
  outputNames: [string, string]
  /** Generated once when the step is created — never regenerated during evaluation (docs/POWER_QUERY_RUNTIME.md "Stable identity"). */
  outputColumnIds: [string, string]
  removeSource: boolean
}

export interface MergeColumnsStep extends BaseQueryStep {
  kind: 'merge-columns'
  columnIds: string[]
  delimiter: string
  newColumnName: string
  outputColumnId: string
  removeSource: boolean
}

export type GroupByAggregationFunction = 'count-rows' | 'sum' | 'average' | 'min' | 'max'

export interface GroupByAggregation {
  outputColumnId: string
  outputName: string
  function: GroupByAggregationFunction
  /** Unused for `count-rows`. */
  sourceColumnId?: string
}

export interface GroupByStep extends BaseQueryStep {
  kind: 'group-by'
  groupColumnIds: string[]
  aggregations: GroupByAggregation[]
}

export type MergeJoinKind = 'left-outer' | 'right-outer' | 'full-outer' | 'inner' | 'left-anti' | 'right-anti'

export interface MergeExpandColumn {
  /** Column id on the right source's output schema. */
  rightColumnId: string
  outputColumnId: string
  outputName: string
}

export interface MergeQueriesStep extends BaseQueryStep {
  kind: 'merge-queries'
  right: QuerySource
  joinKind: MergeJoinKind
  leftKeys: string[]
  rightKeys: string[]
  expand: MergeExpandColumn[]
}

export interface AppendColumnMapping {
  name: string
  outputColumnId: string
}

export interface AppendQueriesStep extends BaseQueryStep {
  kind: 'append-queries'
  sources: QuerySource[]
  /** The output schema, generated once when the step is created (docs/POWER_QUERY_RUNTIME.md "Append identity"). */
  columns: AppendColumnMapping[]
}

export type QueryStep =
  | RenameColumnsStep
  | RemoveColumnsStep
  | ReorderColumnsStep
  | ChangeTypeStep
  | FilterRowsStep
  | ReplaceValuesStep
  | RemoveDuplicatesStep
  | SortRowsStep
  | FillStep
  | SplitColumnStep
  | MergeColumnsStep
  | GroupByStep
  | MergeQueriesStep
  | AppendQueriesStep

export type QueryStepKind = QueryStep['kind']

export interface QueryDefinition {
  id: string
  name: string
  source: QuerySource
  steps: QueryStep[]
  /** Stable across re-evaluation — see docs/POWER_QUERY_RUNTIME.md "Stable output identity". */
  outputDatasetId: string
  outputTableId: string
  loadEnabled: boolean
  createdAt: string
  updatedAt: string
}

export type QueryDiagnosticCode =
  | 'QUERY_SOURCE_NOT_FOUND'
  | 'QUERY_DEPENDENCY_NOT_FOUND'
  | 'QUERY_DEPENDENCY_CYCLE'
  | 'QUERY_COLUMN_NOT_FOUND'
  | 'QUERY_DUPLICATE_COLUMN_NAME'
  | 'QUERY_TYPE_CONVERSION_FAILED'
  | 'QUERY_INVALID_FILTER'
  | 'QUERY_INVALID_STEP_CONFIG'
  | 'QUERY_DEPENDENCY_SCHEMA_CHANGED'
  | 'QUERY_JOIN_KEY_TYPE_MISMATCH'
  | 'QUERY_MERGE_COLUMN_COLLISION'
  | 'QUERY_ROW_LIMIT_EXCEEDED'
  | 'QUERY_COLUMN_LIMIT_EXCEEDED'
  | 'QUERY_STEP_FAILED'
  | 'QUERY_NOT_LOADED'
  | 'QUERY_NO_COLUMNS'

export interface QueryDiagnostic {
  severity: 'error' | 'warning' | 'info'
  code: QueryDiagnosticCode
  message: string
  stepId?: string
  details?: Record<string, unknown>
}

/** A step that never ran because an earlier step in the pipeline failed (brief §16) is `'skipped'` — distinct from a step that ran and failed. */
export type QueryStepStatus = 'success' | 'error' | 'skipped'

export interface QueryStepResult {
  stepId: string
  status: QueryStepStatus
  inputRows: number
  outputRows: number
  outputColumns: number
  diagnostics: QueryDiagnostic[]
}

export interface QueryEvaluation {
  queryId: string
  status: 'success' | 'error'
  /**
   * The dataset produced by the pipeline. Always present unless the very
   * source can't be resolved — even a mid-pipeline failure still yields the
   * output of the last successfully-executed step, so dependents and the
   * Semantic Model never lose their reference (docs/POWER_QUERY_RUNTIME.md
   * "Evaluation never removes a prior good output").
   */
  output?: import('./data').Dataset
  stepResults: QueryStepResult[]
  diagnostics: QueryDiagnostic[]
  fingerprint: string
}
