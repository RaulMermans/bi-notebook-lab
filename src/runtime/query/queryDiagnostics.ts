import type { QueryDiagnostic, QueryDiagnosticCode } from '../../domain/query'

/** Small factory so every step/evaluator constructs diagnostics the same shape — mirrors runtime/validation's feedback pattern. */
export function diagnostic(
  severity: QueryDiagnostic['severity'],
  code: QueryDiagnosticCode,
  message: string,
  extra?: { stepId?: string; details?: Record<string, unknown> },
): QueryDiagnostic {
  return { severity, code, message, stepId: extra?.stepId, details: extra?.details }
}

export function errorDiagnostic(code: QueryDiagnosticCode, message: string, extra?: { stepId?: string; details?: Record<string, unknown> }): QueryDiagnostic {
  return diagnostic('error', code, message, extra)
}

export function warningDiagnostic(code: QueryDiagnosticCode, message: string, extra?: { stepId?: string; details?: Record<string, unknown> }): QueryDiagnostic {
  return diagnostic('warning', code, message, extra)
}
