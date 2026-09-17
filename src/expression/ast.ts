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

/** Sprint 3 supports exactly one function: `RELATED(Table[Column])`. */
export interface FunctionCallNode {
  kind: 'FunctionCall'
  name: string
  nameSpan: SourceSpan
  args: Expression[]
  span: SourceSpan
}

export type Expression = LiteralNode | ColumnReferenceNode | UnaryExpressionNode | BinaryExpressionNode | FunctionCallNode
