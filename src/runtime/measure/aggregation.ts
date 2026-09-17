import type { ExecutionTraceNode } from '../../expression/trace'
import type { AggregationFunction } from '../../expression/measureBinder'

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
