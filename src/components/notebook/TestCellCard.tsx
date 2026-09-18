import { useState } from 'react'
import type { TestCell } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { ValidationRuleResult, ValidationRuleStatus, ValidationRun } from '../../domain/validation'

interface TestCellCardProps {
  cell: TestCell
  model: SemanticModel | undefined
  datasets: Record<string, Dataset>
  /** The current (non-stale) run for this cell, if one exists — see docs/VALIDATION_ENGINE.md "Staleness". */
  run: ValidationRun | undefined
  /** True when a run exists in memory but is no longer current (the model changed since it ran). */
  hasStaleRun: boolean
  onRun: () => void
  onRemove: () => void
}

const STATUS_ICON: Record<ValidationRuleStatus, string> = {
  passed: '✓',
  partial: '◐',
  failed: '✗',
  error: '⚠',
}

function groupByCategory(ruleResults: ValidationRuleResult[]): { category: string; results: ValidationRuleResult[] }[] {
  const order: string[] = []
  const groups = new Map<string, ValidationRuleResult[]>()
  for (const result of ruleResults) {
    const category = result.category ?? 'Other'
    if (!groups.has(category)) {
      groups.set(category, [])
      order.push(category)
    }
    groups.get(category)!.push(result)
  }
  return order.map((category) => ({ category, results: groups.get(category)! }))
}

function categoryTotals(results: ValidationRuleResult[]): { earned: number; possible: number } {
  return results.reduce(
    (totals, r) => ({ earned: totals.earned + r.pointsEarned, possible: totals.possible + r.pointsPossible }),
    { earned: 0, possible: 0 },
  )
}

/**
 * A scored checkpoint: runs `runValidation()` against the current notebook
 * state and shows a per-rule breakdown, never comparing exact expression
 * text (docs/VALIDATION_ENGINE.md). Score/feedback live entirely in the
 * caller's state — nothing here is persisted (Sprint 5 brief §37).
 */
export function TestCellCard({ cell, model, run, hasStaleRun, onRun, onRemove }: TestCellCardProps) {
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null)

  if (!model) {
    return (
      <article className="cell cell--missing">
        <div className="cell__rail">
          <span>✓ CHECKPOINT</span>
        </div>
        <div className="cell__body">
          <p>Model for &quot;{cell.title}&quot; is missing. It may still be loading.</p>
        </div>
      </article>
    )
  }

  const groups = run ? groupByCategory(run.ruleResults) : []

  return (
    <article className="cell cell--test">
      <div className="cell__rail">
        <span>✓ CHECKPOINT</span>
      </div>
      <div className="cell__body">
        <div className="cell__header">
          <div>
            <h2>{cell.validation.title}</h2>
            {cell.prompt && <p className="cell__meta">{cell.prompt}</p>}
          </div>
          <div className="cell__header-actions">
            <button type="button" className="primary-button" onClick={onRun}>
              Check solution
            </button>
            <button type="button" className="text-button" onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>

        {hasStaleRun && (
          <p className="test-cell-stale">Result outdated — the model has changed since this checkpoint last ran. Run it again.</p>
        )}

        {!run && !hasStaleRun && <p className="model-panel__empty">Not run yet. Click &quot;Check solution&quot; to grade your work.</p>}

        {run && (
          <div className="test-cell-score">
            <div className="test-cell-score__header">
              <span className="test-cell-score__points">
                {round(run.pointsEarned)} / {run.pointsPossible}
              </span>
              <span className={`test-cell-score__badge test-cell-score__badge--${run.passed ? 'pass' : 'fail'}`}>
                {run.passed ? 'PASS' : 'NOT PASSED'}
              </span>
            </div>
            <div className="test-cell-score__bar">
              <div className="test-cell-score__bar-fill" style={{ width: `${Math.min(100, Math.max(0, run.percentage))}%` }} />
            </div>

            <div className="test-rule-groups">
              {groups.map(({ category, results }) => {
                const totals = categoryTotals(results)
                return (
                  <div key={category} className="test-rule-group">
                    <div className="test-rule-group__header">
                      <span>{category}</span>
                      <span>
                        {round(totals.earned)} / {totals.possible}
                      </span>
                    </div>
                    <ul className="test-rule-list">
                      {results.map((result) => (
                        <li key={result.ruleId} className={`test-rule test-rule--${result.status}`}>
                          <button
                            type="button"
                            className="test-rule__header"
                            onClick={() => setExpandedRuleId((id) => (id === result.ruleId ? null : result.ruleId))}
                          >
                            <span className={`test-rule__icon test-rule__icon--${result.status}`}>{STATUS_ICON[result.status]}</span>
                            <span className="test-rule__title">
                              {result.title}
                              {result.required && <span className="test-rule__required-badge">required</span>}
                            </span>
                            <span className="test-rule__points">
                              {round(result.pointsEarned)} / {result.pointsPossible}
                            </span>
                          </button>
                          {expandedRuleId === result.ruleId && (
                            <ul className="test-rule__feedback">
                              {result.feedback.map((f, index) => (
                                <li key={index} className={`diagnostic diagnostic--${f.severity === 'success' ? 'info' : f.severity}`}>
                                  {f.message}
                                  {f.hint && <div className="test-rule__hint">{f.hint}</div>}
                                  {f.code === 'HINT_FILTER_CONTEXT' && (
                                    <div className="test-rule__hint">
                                      Explore context: open this checkpoint&apos;s Model cell → Context Explorer tab to see how filters
                                      propagate to this measure&apos;s table.
                                    </div>
                                  )}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}
