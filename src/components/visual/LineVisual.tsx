import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatContextValue } from '../../lib/format/formatValue'
import type { VisualQueryResult } from '../../runtime/visual/types'

interface LineVisualProps {
  result: VisualQueryResult
  measureId: string
  measureName: string
}

/**
 * Grouped measure results as a chronologically/numerically sorted line
 * chart (brief §7/§31). No zoom/drill/hierarchy. The visual's title is
 * rendered once, by `VisualCellCard`'s cell header.
 */
export function LineVisual({ result, measureId, measureName }: LineVisualProps) {
  if (result.status === 'error') {
    return (
      <div className="visual visual--line visual--error">
        <p className="visual__error">{result.diagnostics[0]?.message ?? 'This line chart could not be rendered.'}</p>
      </div>
    )
  }

  if (result.rows.length === 0) {
    return (
      <div className="visual visual--line">
        <p className="visual__empty">No points to display.</p>
      </div>
    )
  }

  const chartData = result.rows.map((row) => ({
    label: row.dimensionLabel,
    value: typeof row.measureValues[measureId] === 'number' ? (row.measureValues[measureId] as number) : null,
  }))

  return (
    <div className="visual visual--line">
      {result.truncated && <p className="visual__notice">{result.diagnostics.find((d) => d.code === 'VISUAL_HIGH_CARDINALITY')?.message}</p>}
      <div className="visual-chart" style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis tickFormatter={(v) => formatContextValue(v)} />
            <Tooltip formatter={(value: number) => [formatContextValue(value), measureName]} />
            <Line type="monotone" dataKey="value" stroke="#4a5568" dot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="visual__summary">
        {measureName} by {result.rows.length} point{result.rows.length === 1 ? '' : 's'}, from {chartData[0].label} to{' '}
        {chartData[chartData.length - 1].label}.
      </p>
    </div>
  )
}
