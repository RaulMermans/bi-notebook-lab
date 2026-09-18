/**
 * BI Notebook DAX Subset — Sprint 3
 *
 * AST contracts for the calculated-column expression grammar. The parser's
 * only job is `text -> syntax tree`: nodes here carry no execution
 * semantics (no resolved ids, no evaluated types) — see `binder.ts` for
 * semantic binding and `evaluator.ts` for execution. See
 * docs/EXPRESSION_ENGINE.md for the full grammar this AST represents.
 */

/** Half-open character offset range into the original source string, `[start, end)`. */
export interface SourceSpan {
  start: number
  end: number
}

export type LiteralValue = number | string | boolean

export interface NumberLiteralNode {
  kind: 'NumberLiteral'
  value: number
  span: SourceSpan
}

export interface StringLiteralNode {
  kind: 'StringLiteral'
  value: string
  span: SourceSpan
}

export interface BooleanLiteralNode {
  kind: 'BooleanLiteral'
  value: boolean
  span: SourceSpan
}

export type LiteralNode = NumberLiteralNode | StringLiteralNode | BooleanLiteralNode

/**
 * `Table[Column]` or the current-table shorthand `[Column]` (`table === null`).
 * Whether a non-null `table` must equal the calculated column's own table
 * (row-context scope rule) is a binder concern, not a parser concern.
 */
export interface ColumnReferenceNode {
  kind: 'ColumnReference'
  table: string | null
  column: string
  span: SourceSpan
  tableSpan?: SourceSpan
  columnSpan: SourceSpan
}

export type UnaryOperator = '-'

export interface UnaryExpressionNode {
  kind: 'UnaryExpression'
  operator: UnaryOperator
  operand: Expression
  span: SourceSpan
}

export type BinaryOperator = '+' | '-' | '*' | '/'

export interface BinaryExpressionNode {
  kind: 'BinaryExpression'
  operator: BinaryOperator
  left: Expression
  right: Expression
  span: SourceSpan
}

export interface FunctionCallNode {
  kind: 'FunctionCall'
  name: string
  nameSpan: SourceSpan
  args: Expression[]
  span: SourceSpan
}

/**
 * Sprint 8 (CALCULATE) addition. `=` inside an expression is always a
 * comparison, never assignment — measure-name assignment (`Spain Revenue =`)
 * is UI/domain metadata handled outside the parser (see docs/CALCULATE.md
 * "`=` is comparison, not assignment").
 */
export type ComparisonOperator = '=' | '<>' | '>' | '>=' | '<' | '<='

export interface ComparisonExpressionNode {
  kind: 'ComparisonExpression'
  operator: ComparisonOperator
  left: Expression
  right: Expression
  span: SourceSpan
}

/** Sprint 8 (CALCULATE) addition — `&&`/`||` boolean composition, e.g. inside `FILTER`'s predicate. */
export type LogicalOperator = '&&' | '||'

export interface LogicalExpressionNode {
  kind: 'LogicalExpression'
  operator: LogicalOperator
  left: Expression
  right: Expression
  span: SourceSpan
}

/**
 * A bare table name with no `[...]`/`(...)` following it, e.g. the `Sales`
 * in `COUNTROWS(Sales)`. Sprint 3 had no such node — every identifier had to
 * be followed by a bracket or a parenthesis. Sprint 4 measures need it for
 * table-scoped aggregations; the parser accepts it unconditionally, and
 * whether it's actually valid where it appears (only as a `COUNTROWS`
 * argument in measure mode) is decided by the binder, not the parser (see
 * docs/EXPRESSION_ENGINE.md).
 */
export interface TableReferenceNode {
  kind: 'TableReference'
  table: string
  span: SourceSpan
}

export type Expression =
  | LiteralNode
  | ColumnReferenceNode
  | UnaryExpressionNode
  | BinaryExpressionNode
  | FunctionCallNode
  | TableReferenceNode
  | ComparisonExpressionNode
  | LogicalExpressionNode
