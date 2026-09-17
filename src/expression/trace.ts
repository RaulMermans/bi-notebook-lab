/**
 * Reusable execution-trace nodes. Sprint 3 emits `literal`, `column-read`,
 * `unary-operation`, `binary-operation`, `related-lookup` and `result`.
 * Sprint 4 (Measures) adds `measure-reference`, `aggregation`,
 * `filter-context` and `relationship-propagation` on top of this same shape
 * rather than a parallel trace type — see docs/MEASURES.md and
 * docs/FILTER_CONTEXT.md. (`calculate` is deferred with CALCULATE itself.)
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

export interface ExecutionTraceNode {
  kind: TraceNodeKind
  label: string
  value?: unknown
  children?: ExecutionTraceNode[]
  metadata?: Record<string, unknown>
}
