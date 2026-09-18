import { useMemo, useState } from 'react'
import { formatContextValue } from '../../lib/format/formatValue'
import type { VisualDataRow, VisualQueryResult } from '../../runtime/visual/types'

interface TableVisualProps {
  result: VisualQueryResult
  /** `undefined` when the table has no configured dimension — the brief §8 "Measure / Value" layout. */
  dimensionLabel?: string
  measureIds: string[]
  measureNames: Record<string, string>
}

type SortState = { key: string; direction: 'asc' | 'desc' } | null

function cellValue(row: VisualDataRow, measureId: string): unknown {
  return row.measureValues[measureId]
}

function compareCell(a: unknown, b: unknown): number {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
  if (b === null || b === undefined) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b))
}

/**
 * A semantic visual, not a raw Dataset preview (brief §8): `dimension +
 * measures`, or one row per measure when no dimension is configured.
 * Sortable columns are supported since it's straightforward on top of an
 * already-computed `VisualQueryResult` — no separate grid system.
 */
export function TableVisual({ result, dimensionLabel, measureIds, measureNames }: TableVisualProps) {
  const [sort, setSort] = useState<SortState>(null)

  const rows = useMemo(() => {
    if (!sort) return result.rows
    const sorted = [...result.rows]
    sorted.sort((a, b) => {
      const cmp = sort.key === '__dimension__' ? compareCell(a.dimensionValue ?? a.dimensionLabel, b.dimensionValue ?? b.dimensionLabel) : compareCell(cellValue(a, sort.key), cellValue(b, sort.key))
      return sort.direction === 'desc' ? -cmp : cmp
    })
    return sorted
  }, [result.rows, sort])

  function toggleSort(key: string) {
    setSort((prev) => (prev?.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }))
  }

  if (result.status === 'error') {
    return (
      <div className="visual visual--table visual--error">
        <p className="visual__error">{result.diagnostics[0]?.message ?? 'This table could not be rendered.'}</p>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="visual visual--table">
        <p className="visual__empty">No rows to display.</p>
      </div>
    )
  }

  const firstColumnLabel = dimensionLabel ?? 'Measure'

  return (
    <div className="visual visual--table">
      {result.truncated && <p className="visual__notice">{result.diagnostics.find((d) => d.code === 'VISUAL_HIGH_CARDINALITY')?.message}</p>}
      <div className="visual-table-scroll">
        <table className="visual-table">
          <thead>
            <tr>
              <th>
                <button type="button" className="visual-table__sort" onClick={() => toggleSort('__dimension__')}>
                  {firstColumnLabel}
                </button>
              </th>
              {dimensionLabel &&
                measureIds.map((measureId) => (
                  <th key={measureId}>
                    <button type="button" className="visual-table__sort" onClick={() => toggleSort(measureId)}>
                      {measureNames[measureId] ?? measureId}
                    </button>
                  </th>
                ))}
              {!dimensionLabel && <th>Value</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                <td>{row.dimensionLabel}</td>
                {dimensionLabel
                  ? measureIds.map((measureId) => <td key={measureId}>{formatContextValue(cellValue(row, measureId))}</td>)
                  : <td>{formatContextValue(Object.values(row.measureValues)[0])}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
