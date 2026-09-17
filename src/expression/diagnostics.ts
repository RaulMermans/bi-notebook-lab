import type { SourceSpan } from './ast'

export type ExpressionDiagnosticSeverity = 'error' | 'warning'

export type ExpressionDiagnosticCode =
  | 'SYNTAX_ERROR'
  | 'UNKNOWN_TABLE'
  | 'UNKNOWN_COLUMN'
  | 'COLUMN_OUTSIDE_ROW_CONTEXT'
  | 'TYPE_MISMATCH'
  | 'DIVISION_ERROR'
  | 'COLUMN_NAME_CONFLICT'
  | 'DUPLICATE_CALCULATED_COLUMN'
  | 'UNSUPPORTED_FUNCTION'
  | 'INVALID_FUNCTION_ARGUMENT'
  | 'RELATED_NO_RELATIONSHIP'
  | 'RELATED_INACTIVE_RELATIONSHIP'
  | 'RELATED_WRONG_DIRECTION'
  | 'RELATED_AMBIGUOUS_RELATIONSHIP'
  // Sprint 4 (Measures / FilterContext) — see docs/MEASURES.md and docs/FILTER_CONTEXT.md.
  | 'BARE_TABLE_REFERENCE'
  | 'UNKNOWN_MEASURE'
  | 'DUPLICATE_MEASURE'
  | 'MEASURE_DEPENDENCY_CYCLE'
  | 'COLUMN_REQUIRES_AGGREGATION'
  | 'INVALID_AGGREGATION_ARGUMENT'
  | 'NON_NUMERIC_AGGREGATION'
  | 'FILTER_GRAPH_INVALID'
  | 'INVALID_FILTER_VALUE'
  | 'RELATED_REQUIRES_ROW_CONTEXT'

export interface ExpressionDiagnostic {
  severity: ExpressionDiagnosticSeverity
  code: ExpressionDiagnosticCode
  message: string
  span?: SourceSpan
  details?: Record<string, unknown>
}

export function diagnostic(
  severity: ExpressionDiagnosticSeverity,
  code: ExpressionDiagnosticCode,
  message: string,
  span?: SourceSpan,
  details?: Record<string, unknown>,
): ExpressionDiagnostic {
  return { severity, code, message, span, details }
}

export function hasError(diagnostics: ExpressionDiagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'error')
}
