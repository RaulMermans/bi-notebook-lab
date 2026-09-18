import { useState } from 'react'
import type { ContextFlowStep } from '../../domain/context'

interface ContextFlowNarrativeProps {
  narrative: ContextFlowStep[]
  beginnerExplanation: string
}

/**
 * The human-readable "why did this happen" sequence (Sprint 6 brief §20),
 * with a beginner/technical toggle (brief §23). Both views are generated
 * from the same real filter/propagation/aggregation data in
 * `runtime/context/narrative.ts` — never a hardcoded, exercise-specific
 * string.
 */
export function ContextFlowNarrative({ narrative, beginnerExplanation }: ContextFlowNarrativeProps) {
  const [mode, setMode] = useState<'explanation' | 'sequence'>('explanation')

  return (
    <div className="context-flow-narrative">
      <div className="context-flow-narrative__header">
        <h4>What happened</h4>
        <div className="context-flow-narrative__toggle" role="group" aria-label="Explanation detail level">
          <button
            type="button"
            className={`text-button ${mode === 'explanation' ? 'text-button--active' : ''}`}
            aria-pressed={mode === 'explanation'}
            onClick={() => setMode('explanation')}
          >
            Explanation
          </button>
          <button
            type="button"
            className={`text-button ${mode === 'sequence' ? 'text-button--active' : ''}`}
            aria-pressed={mode === 'sequence'}
            onClick={() => setMode('sequence')}
          >
            Step by step
          </button>
        </div>
      </div>

      {mode === 'explanation' ? (
        <p className="context-flow-narrative__prose">{beginnerExplanation}</p>
      ) : (
        <ol className="context-flow-narrative__steps">
          {narrative.map((step) => (
            <li key={step.order}>{step.description}</li>
          ))}
        </ol>
      )}
    </div>
  )
}
