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

export type BoundTableExpression = BoundBaseTable | BoundFilterTable | BoundValuesTable | BoundDistinctTable

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
