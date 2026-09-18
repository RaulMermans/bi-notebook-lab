/**
 * Reusable execution-trace nodes. Sprint 3 emits `literal`, `column-read`,
 * `unary-operation`, `binary-operation`, `related-lookup` and `result`.
 * Sprint 4 (Measures) adds `measure-reference`, `aggregation`,
 * `filter-context` and `relationship-propagation` on top of this same shape
 * rather than a parallel trace type — see docs/MEASURES.md and
 * docs/FILTER_CONTEXT.md. Sprint 8 (CALCULATE) adds `calculate`,
 * `filter-modifier`, `boolean-filter`, `table-filter` and `remove-filters` —
 * see docs/CALCULATE.md "Execution trace". Sprint 9 (Iterators / Table
 * Expressions / Conditional Logic) adds `iterator`, `table-expression`,
 * `context-transition`, `conditional` and `switch-case` — see
 * docs/ITERATORS.md and docs/TABLE_EXPRESSIONS.md "Execution trace".
 */
export type TraceNodeKind =
  | 'literal'
  | 'column-read'
  | 'unary-operation'
  | 'binary-operation'
  | 'related-lookup'
  | 'result'
  | 'measure-reference'
  | 'aggregation'
  | 'filter-context'
  | 'relationship-propagation'
  | 'calculate'
  | 'filter-modifier'
  | 'boolean-filter'
  | 'table-filter'
  | 'remove-filters'
  | 'iterator'
  | 'table-expression'
  | 'context-transition'
  | 'conditional'
  | 'switch-case'

export interface ExecutionTraceNode {
  kind: TraceNodeKind
  label: string
  value?: unknown
  children?: ExecutionTraceNode[]
  metadata?: Record<string, unknown>
}
