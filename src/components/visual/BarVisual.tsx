import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatContextValue } from '../../lib/format/formatValue'
import type { VisualQueryResult } from '../../runtime/visual/types'

interface BarVisualProps {
  result: VisualQueryResult
  measureId: string
  measureName: string
}

/**
 * Grouped measure results as a horizontal-reading bar chart (brief §6/§30).
 * The chart itself is decorative — `visual__summary` carries the same
 * information as text so the visual isn't graphical-only (brief §55/§56).
 * The visual's title is rendered once, by `VisualCellCard`'s cell header.
 */
export function BarVisual({ result, measureId, measureName }: BarVisualProps) {
  if (result.status === 'error') {
    return (
      <div className="visual visual--bar visual--error">
        <p className="visual__error">{result.diagnostics[0]?.message ?? 'This bar chart could not be rendered.'}</p>
      </div>
    )
  }

  if (result.rows.length === 0) {
    return (
      <div className="visual visual--bar">
        <p className="visual__empty">No categories are visible in the current filter context.</p>
      </div>
    )
  }

  const chartData = result.rows.map((row) => ({
    label: row.dimensionLabel,
    value: typeof row.measureValues[measureId] === 'number' ? (row.measureValues[measureId] as number) : 0,
  }))

  let highest = chartData[0]
  let lowest = chartData[0]
  for (const point of chartData) {
    if (point.value > highest.value) highest = point
    if (point.value < lowest.value) lowest = point
  }

  return (
    <div className="visual visual--bar">
      {result.truncated && <p className="visual__notice">{result.diagnostics.find((d) => d.code === 'VISUAL_HIGH_CARDINALITY')?.message}</p>}
      <div className="visual-chart" style={{ height: Math.max(220, chartData.length * 32) }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" tickFormatter={(v) => formatContextValue(v)} />
            <YAxis type="category" dataKey="label" width={120} />
            <Tooltip formatter={(value: number) => [formatContextValue(value), measureName]} />
            <Bar dataKey="value" fill="#4a5568" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="visual__summary">
        {measureName} by category. {chartData.length} categor{chartData.length === 1 ? 'y' : 'ies'} displayed. Highest: {highest.label},{' '}
        {formatContextValue(highest.value)}. Lowest: {lowest.label}, {formatContextValue(lowest.value)}.
      </p>
    </div>
  )
}
