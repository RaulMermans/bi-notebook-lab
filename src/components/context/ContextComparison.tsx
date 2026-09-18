import type { MeasureContextComparison } from '../../domain/context'
import { formatContextValue, formatPercent, formatSignedNumber } from '../../lib/format/formatValue'

interface ContextComparisonProps {
  measureName: string
  comparison: MeasureContextComparison
  hasFilters: boolean
}

/**
 * Baseline (no filters) vs. current-context comparison — its own component
 * rather than embedded editor state (Sprint 6 brief §10), driven by two real
 * `evaluateMeasure` calls composed in `runtime/context/contextAnalysis.ts`.
 * Never computes a delta between two non-numeric results (brief §32).
 */
export function ContextComparison({ measureName, comparison, hasFilters }: ContextComparisonProps) {
  const { baselineValue, currentValue, bothNumeric, absoluteDelta, relativeDelta } = comparison

  return (
    <div className="context-comparison">
      <h4>{measureName}</h4>
      <div className="context-comparison__row">
        <span className="context-comparison__label">No filters</span>
        <span className="context-comparison__value">{formatContextValue(baselineValue)}</span>
      </div>

      {hasFilters && (
        <>
          <div className="context-comparison__row">
            <span className="context-comparison__label">Current context</span>
            <span className="context-comparison__value">{formatContextValue(currentValue)}</span>
          </div>

          {bothNumeric ? (
            <>
              <div className="context-comparison__row context-comparison__row--delta">
                <span className="context-comparison__label">Change</span>
                <span className="context-comparison__value">
                  {typeof absoluteDelta === 'number' ? formatSignedNumber(absoluteDelta) : '—'}
                </span>
              </div>
              <div className="context-comparison__row context-comparison__row--delta">
                <span className="context-comparison__label">Change %</span>
                <span className="context-comparison__value">{typeof relativeDelta === 'number' ? formatPercent(relativeDelta) : 'n/a (baseline is 0)'}</span>
              </div>
            </>
          ) : (
            <p className="context-comparison__note">
              This result isn't numeric, so no percentage change is shown — compare the two values directly.
            </p>
          )}
        </>
      )}
    </div>
  )
}
