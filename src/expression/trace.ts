/**
 * Reusable execution-trace nodes. Sprint 3 emits `literal`, `column-read`,
 * `unary-operation`, `binary-operation`, `related-lookup` and `result`.
 * Sprint 4 (Measures) is expected to add `aggregation`, `filter-context`,
 * `relationship-propagation` and `calculate` kinds on top of this same
 * shape rather than inventing a parallel trace type.
 */
export type TraceNodeKind =
  | 'literal'
  | 'column-read'
  | 'unary-operation'
  | 'binary-operation'
  | 'related-lookup'
  | 'result'

export interface ExecutionTraceNode {
  kind: TraceNodeKind
  label: string
  value?: unknown
  children?: ExecutionTraceNode[]
  metadata?: Record<string, unknown>
}
