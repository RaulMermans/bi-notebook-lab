import type { QueryDiagnosticCode } from '../../../domain/query'

/** Thrown by the evaluator for a runtime failure on a specific row — caught by `steps/customColumn.ts` and turned into a `QueryDiagnostic` that fails the whole step (Step Failure Boundary, docs/POWER_QUERY_RUNTIME.md). */
export class ExpressionEvalError extends Error {
  constructor(
    public code: Extract<QueryDiagnosticCode, 'QUERY_CUSTOM_TYPE_ERROR' | 'QUERY_CUSTOM_DIVIDE_BY_ZERO'>,
    message: string,
  ) {
    super(message)
  }
}
