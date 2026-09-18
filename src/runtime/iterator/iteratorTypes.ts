import type { ColumnRef } from '../../domain/model'
import type { BinaryOperator, ComparisonOperator, LogicalOperator, SourceSpan, UnaryOperator } from '../../expression/ast'
import type { LogicalColumnRef } from '../measure/logicalColumn'
import type { BoundTableExpression } from '../tableExpression/tableExpressionTypes'

export type IteratorFunction = 'SUMX' | 'AVERAGEX' | 'MINX' | 'MAXX' | 'COUNTX'

/**
 * The Row Context an iterator creates per visible row of its table
 * expression (sprint brief §17-§21). Column reads, RELATED and measure
 * references inside an iterator's second argument bind against this — a
 * deliberately separate tree from `BoundMeasureExpression` (no row context in
 * plain measures) and from `BoundExpression` (calculated columns bind against
 * exactly one fixed table, never a table expression). See docs/ITERATORS.md.
 */
export interface BoundIteratorLiteral {
  kind: 'Literal'
  value: number | string | boolean
  span: SourceSpan
}

/** A physical/calculated column read on the iterator's current model-table row (`Sales[Revenue]`), or the current value-row's own source column (sprint brief §41 "VALUES/DISTINCT virtual row"). */
export interface BoundIteratorColumn {
  kind: 'Column'
  column: LogicalColumnRef
  label: string
  span: SourceSpan
}

export interface BoundIteratorUnary {
  kind: 'Unary'
  operator: UnaryOperator
  operand: BoundIteratorExpression
  span: SourceSpan
}

export interface BoundIteratorBinary {
  kind: 'Binary'
  operator: BinaryOperator
  left: BoundIteratorExpression
  right: BoundIteratorExpression
  span: SourceSpan
}

export interface BoundIteratorComparison {
  kind: 'Comparison'
  operator: ComparisonOperator
  left: BoundIteratorExpression
  right: BoundIteratorExpression
  span: SourceSpan
}

export interface BoundIteratorLogical {
  kind: 'Logical'
  operator: LogicalOperator
  left: BoundIteratorExpression
  right: BoundIteratorExpression
  span: SourceSpan
}

export interface BoundIteratorRelated {
  kind: 'Related'
  relationshipId: string
  targetColumnRef: ColumnRef
  /** The iterator's own table's foreign-key column name — resolved once at bind time so the per-row evaluator never needs `model`/`datasets` (sprint brief §69). */
  manyColumnName: string
  /** The one-side target column's name, read off the matched related row. */
  targetColumnName: string
  label: string
  span: SourceSpan
}

/** `[Measure Name]` inside an iterator's row expression — requires the bounded, documented context transition (sprint brief §40-§42). */
export interface BoundIteratorMeasureReference {
  kind: 'MeasureReference'
  measureId: string
  measureName: string
  span: SourceSpan
}

export interface BoundIteratorIf {
  kind: 'If'
  condition: BoundIteratorExpression
  whenTrue: BoundIteratorExpression
  whenFalse?: BoundIteratorExpression
  span: SourceSpan
}

export interface BoundIteratorSwitchCase {
  value: BoundIteratorExpression
  result: BoundIteratorExpression
}

export interface BoundIteratorSwitch {
  kind: 'Switch'
  expression: BoundIteratorExpression
  cases: BoundIteratorSwitchCase[]
  defaultResult?: BoundIteratorExpression
  span: SourceSpan
}

export interface BoundIteratorBlank {
  kind: 'Blank'
  span: SourceSpan
}

export type BoundIteratorExpression =
  | BoundIteratorLiteral
  | BoundIteratorColumn
  | BoundIteratorUnary
  | BoundIteratorBinary
  | BoundIteratorComparison
  | BoundIteratorLogical
  | BoundIteratorRelated
  | BoundIteratorMeasureReference
  | BoundIteratorIf
  | BoundIteratorSwitch
  | BoundIteratorBlank

/**
 * The top-level bound form of `SUMX(table, rowExpression)` etc. — one of
 * `BoundMeasureExpression`'s node kinds (`expression/measureBinder.ts`).
 * `table` is a `BoundTableExpression` (sprint brief §15 "First argument:
 * BoundTableExpression"); `rowExpression` binds once here and is evaluated
 * once per visible row, never re-parsed/re-bound per row (sprint brief §69).
 */
export interface BoundIteratorCall {
  kind: 'Iterator'
  function: IteratorFunction
  table: BoundTableExpression
  rowExpression: BoundIteratorExpression
  /** For a model-table-rooted table expression, the row context's own table; for VALUES/DISTINCT, the source column's owning table — needed to scope `Column`/`RELATED`/context-transition. */
  rowKind: 'model' | 'value'
  sourceColumn?: ColumnRef
  label: string
  span: SourceSpan
}
