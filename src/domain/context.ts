import type { DataType } from './data'
import type { ExecutionTraceNode } from '../expression/trace'
import type { CrossFilterDirection, RelationshipCardinality, RelationshipSide } from './model'
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

export type RelationshipPropagationDirection = 'left-to-right' | 'right-to-left'

/** One directed propagation hop that actually reached this table this resolution — generic replacement for the old one/many-specific shape (sprint brief §49, §53). */
export interface ContextTablePropagationSource {
  relationshipId: string
  sourceModelTableId: string
  sourceTableName: string
  sourceColumnName: string
  targetColumnName: string
  direction: RelationshipPropagationDirection
  targetRowsBefore: number
  targetRowsAfter: number
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

/** Why this resolution's effective active/direction state differs from the persisted model — surfaced from runtime truth (`ResolvedFilterState.relationshipOverrides`), never inferred from source text (sprint brief §50-51). */
export type RelationshipOverrideReason =
  | 'activated-by-userelationship'
  | 'suppressed-by-userelationship'
  | 'crossfilter-direction-override'
  | 'crossfilter-none'

export interface ContextRelationshipPropagationEntry {
  direction: RelationshipPropagationDirection
  targetModelTableId: string
  targetRowsBefore: number
  targetRowsAfter: number
}

/**
 * Sprint 11 generalization: `left`/`right` replace the hardcoded `one`/`many`
 * naming (a relationship no longer necessarily has a "1" side at all), and
 * `propagation` is a list (0-2 entries) rather than a single before/after
 * pair, since a bidirectional/1:1 relationship can propagate in both
 * directions in the same resolution.
 */
export interface ContextRelationshipState {
  relationshipId: string
  leftModelTableId: string
  rightModelTableId: string
  leftTableName: string
  rightTableName: string
  leftColumnName: string
  rightColumnName: string
  cardinality: RelationshipCardinality
  oneSide?: RelationshipSide
  crossFilterDirection: CrossFilterDirection
  /** The persisted model's own active flag — never the override. */
  active: boolean
  /** Whether this relationship actually participates in propagation edges for this resolution, folding in any USERELATIONSHIP/CROSSFILTER override. */
  effectiveActive: boolean
  overrideReason?: RelationshipOverrideReason
  propagation: ContextRelationshipPropagationEntry[]
  state: RelationshipPropagationState
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
