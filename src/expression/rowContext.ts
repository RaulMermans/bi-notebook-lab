/**
 * The explicit row context a calculated-column expression evaluates in:
 * exactly one row of exactly one table, at a time. Every column reference in
 * the bound expression reads from `row`; `RELATED` reaches out to a
 * different table's row through an active relationship but still resolves
 * to a single row (see docs/CALCULATED_COLUMNS.md).
 */
export interface RowContext {
  modelId: string
  modelTableId: string
  rowIndex: number
  row: Record<string, unknown>
}
