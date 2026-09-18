import type { ExecutionTraceNode } from '../../expression/trace'
import type { AggregationFunction } from '../../expression/measureBinder'
import type { IteratorFunction } from '../iterator/iteratorTypes'
import { diagnostic, type ExpressionDiagnostic } from '../../expression/diagnostics'

export interface AggregationResult {
  value: unknown
  trace: ExecutionTraceNode
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined
}

/**
 * Applies one Sprint 4 aggregation function over a column's values,
 * restricted to the rows currently visible under a `FilterContext`. Blank
 * values are always excluded from the computation (docs/MEASURES.md
 * "Aggregation semantics" documents this per-function).
 */
export function computeAggregation(
  fn: AggregationFunction,
  label: string,
  values: unknown[],
  visibleRowIndices: number[],
  totalRows: number,
): AggregationResult {
  const nonBlank: unknown[] = []
  for (const rowIndex of visibleRowIndices) {
    const value = values[rowIndex]
    if (!isBlank(value)) nonBlank.push(value)
  }

  let value: unknown = null
  switch (fn) {
    case 'SUM':
      value = nonBlank.length === 0 ? null : (nonBlank as number[]).reduce((a, b) => a + b, 0)
      break
    case 'AVERAGE':
      value = nonBlank.length === 0 ? null : (nonBlank as number[]).reduce((a, b) => a + b, 0) / nonBlank.length
      break
    case 'MIN':
      value = nonBlank.length === 0 ? null : nonBlank.reduce((a, b) => ((b as number | string) < (a as number | string) ? b : a))
      break
    case 'MAX':
      value = nonBlank.length === 0 ? null : nonBlank.reduce((a, b) => ((b as number | string) > (a as number | string) ? b : a))
      break
    case 'COUNT':
      value = nonBlank.length
      break
    case 'DISTINCTCOUNT':
      // Sprint 4 excludes blanks from the distinct set (unlike real DAX DISTINCTCOUNT, which counts blank as one
      // distinct value — see docs/MEASURES.md "Known limitations").
      value = new Set(nonBlank).size
      break
  }

  return {
    value,
    trace: {
      kind: 'aggregation',
      label,
      value,
      metadata: { visibleRows: visibleRowIndices.length, totalRows, nonBlankValues: nonBlank.length },
    },
  }
}

export function computeCountRows(label: string, visibleRowCount: number, totalRows: number): AggregationResult {
  return {
    value: visibleRowCount,
    trace: { kind: 'aggregation', label, value: visibleRowCount, metadata: { visibleRows: visibleRowCount, totalRows } },
  }
}

export interface IteratorAggregationResult {
  value: unknown
  diagnostics: ExpressionDiagnostic[]
  trace: ExecutionTraceNode
}

const NUMERIC_ONLY_ITERATORS = new Set<IteratorFunction>(['SUMX', 'AVERAGEX'])
const ORDERABLE_ITERATORS = new Set<IteratorFunction>(['MINX', 'MAXX'])

function isOrderable(value: unknown): value is number | string {
  return typeof value === 'number' || typeof value === 'string'
}

function isSupportedScalar(value: unknown): boolean {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
}

/**
 * Folds an iterator function's per-row results (sprint brief §22-§25). Blank
 * ({@link isBlank}) results never contribute — zero is a real value, blank is
 * not (sprint brief §23). Unsupported result types are reported as a
 * structured `ITERATOR_EXPRESSION_TYPE_ERROR` diagnostic instead of
 * JavaScript coercion (sprint brief §22 "Reject unsupported result types").
 */
export function computeIteratorAggregation(fn: IteratorFunction, label: string, rowValues: unknown[], totalVisited: number): IteratorAggregationResult {
  const nonBlank: unknown[] = []
  for (const value of rowValues) {
    if (isBlank(value)) continue

    if (NUMERIC_ONLY_ITERATORS.has(fn) && typeof value !== 'number') {
      return {
        value: null,
        diagnostics: [diagnostic('error', 'ITERATOR_EXPRESSION_TYPE_ERROR', `${fn} requires a numeric row expression result, but got a ${typeof value} value.`)],
        trace: { kind: 'iterator', label, value: null, metadata: { visited: totalVisited, error: true } },
      }
    }
    if (ORDERABLE_ITERATORS.has(fn) && !isOrderable(value)) {
      return {
        value: null,
        diagnostics: [diagnostic('error', 'ITERATOR_EXPRESSION_TYPE_ERROR', `${fn} requires a numeric or comparable row expression result, but got a ${typeof value} value.`)],
        trace: { kind: 'iterator', label, value: null, metadata: { visited: totalVisited, error: true } },
      }
    }
    if (fn === 'COUNTX' && !isSupportedScalar(value)) {
      return {
        value: null,
        diagnostics: [diagnostic('error', 'ITERATOR_EXPRESSION_TYPE_ERROR', `COUNTX requires a number, string or boolean row expression result, but got a ${typeof value} value.`)],
        trace: { kind: 'iterator', label, value: null, metadata: { visited: totalVisited, error: true } },
      }
    }

    nonBlank.push(value)
  }

  let value: unknown = null
  switch (fn) {
    case 'SUMX':
      value = nonBlank.length === 0 ? null : (nonBlank as number[]).reduce((a, b) => a + b, 0)
      break
    case 'AVERAGEX':
      value = nonBlank.length === 0 ? null : (nonBlank as number[]).reduce((a, b) => a + b, 0) / nonBlank.length
      break
    case 'MINX':
      value = nonBlank.length === 0 ? null : nonBlank.reduce((a, b) => ((b as number | string) < (a as number | string) ? b : a))
      break
    case 'MAXX':
      value = nonBlank.length === 0 ? null : nonBlank.reduce((a, b) => ((b as number | string) > (a as number | string) ? b : a))
      break
    case 'COUNTX':
      value = nonBlank.length
      break
  }

  return {
    value,
    diagnostics: [],
    trace: { kind: 'iterator', label, value, metadata: { visited: totalVisited, evaluated: rowValues.length, nonBlankValues: nonBlank.length } },
  }
}
