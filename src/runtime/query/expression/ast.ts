/**
 * The bounded Power Query scalar-expression subset (Custom Column / Sprint
 * 14). Deliberately not M — see docs/POWER_QUERY_EXPRESSIONS.md for the
 * exact supported grammar and function set. No `let/in`, records, lists,
 * `each`, custom functions, or external connectors.
 */

export type BinaryOperator = '+' | '-' | '*' | '/' | '&' | '=' | '<>' | '>' | '>=' | '<' | '<='

export type ExprNode =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'column'; name: string }
  | { kind: 'unary-minus'; operand: ExprNode }
  | { kind: 'binary'; operator: BinaryOperator; left: ExprNode; right: ExprNode }
  | { kind: 'conditional'; condition: ExprNode; whenTrue: ExprNode; whenFalse: ExprNode }
  | { kind: 'call'; functionName: string; args: ExprNode[] }

/** Produced by `binder.ts`: every `column` node now carries the resolved `DataColumn.id`. Rename-after-binding is safe because evaluation always looks the value up by id, never by the name text baked into the source. */
export type BoundColumnNode = { kind: 'column'; name: string; columnId: string }

export type BoundExprNode =
  | { kind: 'literal'; value: string | number | boolean | null }
  | BoundColumnNode
  | { kind: 'unary-minus'; operand: BoundExprNode }
  | { kind: 'binary'; operator: BinaryOperator; left: BoundExprNode; right: BoundExprNode }
  | { kind: 'conditional'; condition: BoundExprNode; whenTrue: BoundExprNode; whenFalse: BoundExprNode }
  | { kind: 'call'; functionName: string; args: BoundExprNode[] }
