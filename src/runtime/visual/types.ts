import type { DataType } from '../../domain/data'
import type { ExecutionTraceNode } from '../../expression/trace'

/**
 * Structured, human-readable failure/notice codes for the Visual Runtime —
 * the visual counterpart to `ExpressionDiagnostic` (Sprint 3/4) and
 * `RelationshipDiagnostic`/`ModelDiagnostic` (Sprint 2). Never let a chart
 * library receive invalid state silently (Sprint 7 brief §22).
 */
export type VisualDiagnosticSeverity = 'error' | 'warning' | 'info'

export type VisualDiagnosticCode =
  | 'VISUAL_MEASURE_NOT_FOUND'
  | 'VISUAL_COLUMN_NOT_FOUND'
  | 'VISUAL_MODEL_NOT_FOUND'
  | 'VISUAL_QUERY_FAILED'
  | 'VISUAL_HIGH_CARDINALITY'
  | 'VISUAL_NON_NUMERIC_MEASURE'
  | 'VISUAL_INVALID_AXIS_TYPE'
  | 'VISUAL_FILTER_GRAPH_INVALID'

export interface VisualDiagnostic {
  severity: VisualDiagnosticSeverity
  code: VisualDiagnosticCode
  message: string
}

export function visualDiagnostic(severity: VisualDiagnosticSeverity, code: VisualDiagnosticCode, message: string): VisualDiagnostic {
  return { severity, code, message }
}

export function hasVisualError(diagnostics: VisualDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error')
}

/**
 * One row of a grouped or scalar Visual query. `dimensionValue` is the raw
 * source value (used for sorting); `dimensionLabel` is always a display
 * string, with blank members rendered as `"(Blank)"` (Sprint 7 brief §53).
 * `measureValues` is keyed by `measureId` — never a positional array — so a
 * chart/table component never has to guess which column is which.
 */
export interface VisualDataRow {
  dimensionValue?: unknown
  dimensionLabel: string
  measureValues: Record<string, unknown>
}

/**
 * The one output shape every grouped/scalar Visual Runtime function
 * produces. Chart/table components consume only this — never raw
 * `SemanticModel`/`Dataset` internals (Sprint 7 brief §21/§27).
 */
export interface VisualQueryResult {
  status: 'success' | 'error'
  rows: VisualDataRow[]
  diagnostics: VisualDiagnostic[]
  /** Present when cardinality limits truncated the result (brief §18). */
  truncated?: { shown: number; total: number }
}

export interface KpiQueryResult {
  status: 'success' | 'error'
  value: unknown
  dataType: DataType | 'unknown'
  diagnostics: VisualDiagnostic[]
  trace?: ExecutionTraceNode
}
