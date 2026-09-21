import type { ColumnRef } from '../../domain/model'
import type { SourceSpan } from '../../expression/ast'
import type { BoundPredicateNode } from '../measure/booleanFilter'

/**
 * Sprint 9's canonical table-expression abstraction (sprint brief §2-§3):
 * every DAX construct that produces "a set of rows" — a bare model table,
 * `FILTER(...)`, `VALUES(...)`, `DISTINCT(...)` — binds to one of these
 * instead of being encoded as an ad hoc array. `CALCULATE`'s `FILTER`
 * modifier (`contextModifier.ts`) and the iterator functions (`SUMX`, etc.)
 * both consume the *same* `BoundTableExpression` + evaluator
 * (`tableExpressionEvaluator.ts`) — see docs/TABLE_EXPRESSIONS.md.
 */
export interface BoundBaseTable {
  kind: 'BaseTable'
  modelTableId: string
  tableName: string
  span: SourceSpan
}

export interface BoundFilterTable {
  kind: 'FilterTable'
  input: BoundTableExpression
  /** The single model table every column in `predicate` resolves to — always equal to `input`'s own model table (sprint brief §9: FILTER is only supported rooted at a model table for Sprint 9). */
  modelTableId: string
  predicate: BoundPredicateNode
  referencedColumns: ColumnRef[]
  label: string
  span: SourceSpan
}

/** `VALUES(Table[Column])` / `DISTINCT(Table[Column])` — a one-column virtual table (sprint brief §10-§13). */
export interface BoundValuesTable {
  kind: 'ValuesTable'
  column: ColumnRef
  modelTableId: string
  columnName: string
  tableName: string
  span: SourceSpan
}

export interface BoundDistinctTable {
  kind: 'DistinctTable'
  column: ColumnRef
  modelTableId: string
  columnName: string
  tableName: string
  span: SourceSpan
}

export type TimeIntelligenceOperation = 'same-period-last-year' | 'date-add' | 'previous-month' | 'previous-year' | 'dates-ytd'

/**
 * Sprint 10's canonical time-intelligence table (sprint brief §14):
 * `SAMEPERIODLASTYEAR`, `DATEADD`, `PREVIOUSMONTH`, `PREVIOUSYEAR` and
 * `DATESYTD` all bind to this one variant — never a second "table-returning
 * function" abstraction — distinguished only by `operation` and its
 * operation-specific args. `modelTableId`/`dateColumn` always name the
 * *marked* Date Table column the operation reads/replaces (sprint brief §16);
 * `DATEADD`'s interval is the only operation with extra args. See
 * docs/TIME_INTELLIGENCE.md.
 */
export interface BoundTimeIntelligenceTable {
  kind: 'TimeIntelligenceTable'
  operation: TimeIntelligenceOperation
  modelTableId: string
  dateColumn: ColumnRef
  dateColumnName: string
  tableName: string
  label: string
  span: SourceSpan
  /** `DATEADD` only. */
  intervalUnit?: 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY'
  intervalCount?: number
}

export type BoundTableExpression = BoundBaseTable | BoundFilterTable | BoundValuesTable | BoundDistinctTable | BoundTimeIntelligenceTable

/**
 * A row of an `EvaluatedTableExpression`, carrying enough lineage to
 * establish Row Context (and, for a measure reference inside an iterator,
 * the context transition — sprint brief §4/§41). A `model-row` is one
 * physical row of a model table; a `value-row` is a virtual one-column row
 * produced by `VALUES`/`DISTINCT`, identified only by its source column and
 * the distinct value it carries.
 */
export interface ModelTableExpressionRow {
  kind: 'model-row'
  modelTableId: string
  rowIndex: number
  row: Record<string, unknown>
}

export interface ValueTableExpressionRow {
  kind: 'value-row'
  sourceColumn: ColumnRef
  sourceModelTableId: string
  value: unknown
}

export type TableExpressionRow = ModelTableExpressionRow | ValueTableExpressionRow
