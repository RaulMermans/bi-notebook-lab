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
