import type { DataColumn } from '../../domain/data'
import type { QueryDiagnostic, QuerySource } from '../../domain/query'

export interface ResolvedSource {
  columns: DataColumn[]
  rows: Record<string, unknown>[]
}

export type ResolveSourceResult = { ok: true; value: ResolvedSource } | { ok: false; diagnostic: QueryDiagnostic }

/**
 * What a step needs beyond its own frame: the ability to resolve another
 * `QuerySource` (used by Merge/Append) plus the shared row/column limits.
 * Implemented by `queryRuntime.ts`, which already knows how to resolve a
 * `dataset-table` source or a sibling query's already-evaluated output.
 */
export interface StepContext {
  resolveSource(source: QuerySource): ResolveSourceResult
  maxRows: number
  maxColumns: number
}

export interface StepEvalResult {
  frame?: import('./queryFrame').QueryFrame
  diagnostics: QueryDiagnostic[]
}
