import type { DataType } from './data'
import type { ExecutionTraceNode } from '../expression/trace'
import type { ColumnFilter } from '../runtime/measure/filterContext'

/**
 * Sprint 6 (Context Visualizer) presentation contract. Everything here is a
 * read-only adaptation of Sprint 4's own runtime output
 * (`ResolvedFilterState`, `MeasureExecution`) — see
 * `runtime/context/contextAnalysis.ts`. Nothing in this file or its runtime
 * computes filtering, propagation or aggregation; see docs/CONTEXT_VISUALIZER.md.
 */

export interface ContextFilterSummary {
  modelTableId: string
  tableName: string
  columnName: string
  operator: ColumnFilter['operator']
  values: unknown[]
  rowsBefore: number
  rowsAfter: number
}

export type ContextTableFilterState = 'unfiltered' | 'direct' | 'propagated' | 'direct+propagated'

export interface ContextTablePropagationSource {
  relationshipId: string
  oneModelTableId: string
  oneTableName: string
  oneKeyColumnName: string
  manyKeyColumnName: string
  manyRowsBefore: number
  manyRowsAfter: number
}

export interface ContextTableState {
  modelTableId: string
  tableName: string
  totalRows: number
  visibleRows: number
  percentVisible: number
  filterState: ContextTableFilterState
  directFilters: ContextFilterSummary[]
  incomingPropagation: ContextTablePropagationSource[]
  position?: { x: number; y: number }
}

export type RelationshipPropagationState = 'propagated' | 'active-no-effect' | 'inactive'

export interface ContextRelationshipState {
  relationshipId: string
  oneModelTableId: string
  manyModelTableId: string
  oneTableName: string
  manyTableName: string
  oneColumnName: string
  manyColumnName: string
  active: boolean
  /** Whether this relationship actually narrowed the many side under the current context. */
  propagated: boolean
  state: RelationshipPropagationState
  manyRowsBefore?: number
  manyRowsAfter?: number
  /** The number of distinct "1"-side keys still visible — equal to the one-side's visible row count, since a relationship's "1" side is always unique (enforced at creation). */
  allowedOneSideKeys?: number
}

export interface MeasureContextComparison {
  baselineValue: unknown
  currentValue: unknown
  bothNumeric: boolean
  absoluteDelta?: number
  relativeDelta?: number
}

export interface ContextFlowStep {
  order: number
  description: string
  metadata?: Record<string, unknown>
}

export interface ContextMeasureResult {
  measureId: string
  value: unknown
  dataType: DataType | 'unknown'
  trace?: ExecutionTraceNode
}

export interface ContextInvalidState {
  code: string
  message: string
}

/**
 * The full Context Explorer analysis for one measure under one learner-chosen
 * `FilterContext`. Composes `resolveFilterContext`/`evaluateMeasure` output —
 * see `analyzeMeasureContext` in `runtime/context/contextAnalysis.ts`.
 */
export interface ContextAnalysis {
  measureId: string
  measureName: string
  measureExpression: string

  filters: ColumnFilter[]

  /** Present only when the filter graph resolved successfully. */
  tables?: ContextTableState[]
  relationships?: ContextRelationshipState[]

  baseline: ContextMeasureResult
  current: ContextMeasureResult
  comparison: MeasureContextComparison

  narrative: ContextFlowStep[]
  beginnerExplanation: string

  /** Set instead of `tables`/`relationships` when the model's relationship graph is invalid (ACTIVE_CYCLE/AMBIGUOUS_PATH) — see docs/FILTER_CONTEXT.md "Invalid filter graphs". */
  invalid?: ContextInvalidState
}
