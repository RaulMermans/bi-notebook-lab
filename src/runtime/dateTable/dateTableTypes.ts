/**
 * Structured Date Table validation diagnostics (sprint brief §7) — a
 * separate, small diagnostic union from `ModelDiagnosticCode`
 * (domain/model.ts) and `ExpressionDiagnosticCode` (expression/diagnostics.ts):
 * Date Table marking is neither a relationship-graph concern nor a DAX
 * parse/bind concern, it's its own domain (docs/DATE_TABLES.md).
 */
export type DateTableDiagnosticCode =
  | 'DATE_TABLE_REQUIRED'
  | 'DATE_TABLE_NOT_FOUND'
  | 'DATE_COLUMN_NOT_FOUND'
  | 'DATE_TABLE_INVALID_TYPE'
  | 'DATE_TABLE_DATE_NOT_UNIQUE'
  | 'DATE_TABLE_DATE_HAS_BLANKS'
  | 'DATE_TABLE_NOT_CONTIGUOUS'
  | 'DATE_TABLE_INCONSISTENT_TIME'
  | 'DATE_TABLE_INVALID'

export interface DateTableDiagnostic {
  severity: 'error' | 'warning'
  code: DateTableDiagnosticCode
  message: string
  details?: Record<string, unknown>
}

export interface DateTableValidationResult {
  valid: boolean
  diagnostics: DateTableDiagnostic[]
  rowCount: number
  minDate?: string
  maxDate?: string
}
