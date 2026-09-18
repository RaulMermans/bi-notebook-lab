import type { KpiQueryResult } from '../../runtime/visual/types'
import { formatContextValue } from '../../lib/format/formatValue'

interface KpiVisualProps {
  result: KpiQueryResult
}

/**
 * A single scalar result under the current shared `NotebookVisualContext`
 * (Sprint 7 brief §5/§23/§29). Blank (`null`) is a legitimate measure
 * result and renders as `—`, never a fabricated `0`; a diagnostic
 * (missing measure, invalid filter graph, ...) renders as an explicit error
 * instead of any number at all. The visual's title is rendered once, by
 * `VisualCellCard`'s cell header — not repeated here.
 */
export function KpiVisual({ result }: KpiVisualProps) {
  if (result.status === 'error') {
    return (
      <div className="visual visual--kpi visual--error">
        <p className="visual__error">Unable to render KPI. {result.diagnostics[0]?.message}</p>
      </div>
    )
  }

  const display = result.value === null ? '—' : result.value === undefined ? 'No result.' : formatContextValue(result.value)

  return (
    <div className="visual visual--kpi">
      <p className="visual__kpi-value">{display}</p>
      <p className="visual__caption">Current notebook context</p>
    </div>
  )
}
