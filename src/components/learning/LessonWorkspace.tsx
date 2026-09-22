import { useMemo, useState } from 'react'
import type { BuiltInLesson, LessonStage } from '../../domain/learning'
import type { NotebookCell as NotebookCellModel } from '../../domain/notebook'
import type { ValidationRun } from '../../domain/validation'
import { NotebookBody } from '../notebook/NotebookBody'
import { useLessonWorkspace } from '../../runtime/learning/useLessonWorkspace'
import { useNotebookVisualContext } from '../../runtime/notebook/useNotebookVisualContext'
import { isValidationRunStale } from '../../runtime/validation/fingerprint'
import { buildSlicerFilter } from '../../runtime/visual/visualRuntime'

interface LessonWorkspaceProps {
  lesson: BuiltInLesson
  onExit: () => void
}

/**
 * Owns the "which attempt am I looking at" remount key. Resetting or
 * starting a new attempt clears this lesson's persisted notebook/session
 * (`useLessonWorkspace`'s `resetLesson`/`startNewAttempt`), then bumps this
 * key so the inner component — and the `useNotebookRuntime` instance it
 * owns — remounts from scratch and re-runs the lesson's deterministic
 * initializer (see `useLessonWorkspace`'s doc comment).
 */
export function LessonWorkspace({ lesson, onExit }: LessonWorkspaceProps) {
  const [attemptKey, setAttemptKey] = useState(0)
  return (
    <LessonWorkspaceInner
      key={`${lesson.definition.id}:${attemptKey}`}
      lesson={lesson}
      onExit={onExit}
      onRestart={() => setAttemptKey((key) => key + 1)}
    />
  )
}

function stageStatusLabel(isCurrent: boolean, isComplete: boolean): string {
  if (isComplete) return 'Completed'
  if (isCurrent) return 'In progress'
  return 'Not started'
}

function LessonWorkspaceInner({ lesson, onExit, onRestart }: LessonWorkspaceProps & { onRestart: () => void }) {
  const {
    definition,
    notebook,
    datasets,
    models,
    queries,
    queryEvaluations,
    notebookActions,
    status,
    session,
    progress,
    stageCompletion,
    lessonComplete,
    checkpointRunsByValidationId,
    checkpointStaleByValidationId,
    validationRuns,
    actions,
  } = useLessonWorkspace(lesson)

  const visualContext = useNotebookVisualContext()
  const [showSolution, setShowSolution] = useState(false)

  const slicerSelections = useMemo(() => {
    const selections: Record<string, unknown[]> = {}
    for (const [cellId, filter] of Object.entries(visualContext.bySlicer)) selections[cellId] = filter.values
    return selections
  }, [visualContext.bySlicer])

  function handleSlicerChange(cellId: string, values: unknown[]) {
    const cell = notebook.cells.find((c) => c.id === cellId)
    if (!cell || cell.kind !== 'visual' || cell.visual.type !== 'slicer') return
    visualContext.setSlicerFilter(cellId, buildSlicerFilter(cell.visual.column, values, cell.visual.mode))
  }

  /** Routes a "Run" click on a specific `TestCellCard` to the lesson stage whose checkpoint it belongs to — needed once a lesson can have more than one checkpoint TestCell in its notebook. */
  function handleRunValidation(cellId: string) {
    const cell = notebook.cells.find((c) => c.id === cellId)
    if (!cell || cell.kind !== 'test') return
    const stage = definition.stages.find((s) => s.checkpointValidationId === cell.validation.id)
    if (stage) actions.checkCheckpoint(stage.id)
  }

  const testCells = useMemo(
    () => notebook.cells.filter((cell): cell is Extract<NotebookCellModel, { kind: 'test' }> => cell.kind === 'test'),
    [notebook.cells],
  )

  // Mirrors NotebookWorkspace's staleness computation exactly — a stale run must never render as current on the cell itself, not just in the lesson header's checkpoint panel (docs/VALIDATION_ENGINE.md "Staleness").
  const { currentRuns, staleTestCellIds } = useMemo(() => {
    const current: Record<string, ValidationRun> = {}
    const stale = new Set<string>()
    for (const cell of testCells) {
      const run = validationRuns[cell.id]
      if (!run) continue
      if (!isValidationRunStale(run, { models, datasets, queries, queryEvaluations }, cell)) {
        current[cell.id] = run
      } else {
        stale.add(cell.id)
      }
    }
    return { currentRuns: current, staleTestCellIds: stale }
  }, [testCells, validationRuns, models, datasets, queries, queryEvaluations])

  const currentStageId = session?.currentStageId ?? definition.stages[0]?.id
  const currentStage: LessonStage | undefined = definition.stages.find((stage) => stage.id === currentStageId) ?? definition.stages[0]
  const currentStageIndex = definition.stages.findIndex((stage) => stage.id === currentStage?.id)

  const revealedHintsForStage = useMemo(() => {
    if (!currentStage || !session) return []
    const revealedIds = new Set(session.revealedHints[currentStage.id] ?? [])
    return (currentStage.hints ?? []).filter((hint) => revealedIds.has(hint.id))
  }, [currentStage, session])

  const hasMoreHints = currentStage ? (currentStage.hints?.length ?? 0) > revealedHintsForStage.length : false

  const isCheckpointStage = Boolean(currentStage?.checkpointValidationId)
  const checkpointRun = currentStage?.checkpointValidationId ? checkpointRunsByValidationId[currentStage.checkpointValidationId] : undefined
  const checkpointStale = currentStage?.checkpointValidationId ? (checkpointStaleByValidationId[currentStage.checkpointValidationId] ?? true) : true

  async function handleRestart(kind: 'reset' | 'new-attempt') {
    if (kind === 'reset') await actions.resetLesson()
    else await actions.startNewAttempt()
    onRestart()
  }

  if (status === 'loading' || !currentStage) {
    return (
      <section className="workspace">
        <p className="workspace__status">Loading lesson…</p>
      </section>
    )
  }

  return (
    <section className="workspace">
      <header className="lesson-header">
        <button type="button" className="link-button" onClick={onExit}>
          ← Back to Exercises
        </button>
        <div className="lesson-header__title-row">
          <span className={`difficulty-badge difficulty-badge--${definition.difficulty}`}>{definition.difficulty}</span>
          <h1>{definition.title}</h1>
        </div>
        <p className="lesson-header__stage-indicator">
          Stage {currentStageIndex + 1} of {definition.stages.length} · {currentStage.title}
        </p>

        <ol className="lesson-stage-nav">
          {definition.stages.map((stage, index) => {
            const isCurrent = stage.id === currentStage.id
            // A checkpoint stage's "complete" comes from the real ValidationRun. A guidance-only
            // stage has no such signal, so it's shown complete only once the learner has moved past
            // it — never eagerly on load, which would misrepresent stages nobody has visited yet.
            const isComplete = stage.checkpointValidationId ? stageCompletion[stage.id] : index < currentStageIndex
            return (
              <li key={stage.id}>
                <button
                  type="button"
                  className={`lesson-stage-nav__item${isCurrent ? ' lesson-stage-nav__item--current' : ''}${isComplete ? ' lesson-stage-nav__item--complete' : ''}`}
                  onClick={() => actions.goToStage(stage.id)}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  <span className="lesson-stage-nav__index">{index + 1}</span>
                  <span className="lesson-stage-nav__label">{stage.title}</span>
                  <span className="lesson-stage-nav__status">{stageStatusLabel(isCurrent, isComplete)}</span>
                </button>
              </li>
            )
          })}
        </ol>

        <div className="lesson-goal">
          {currentStage.learningObjective && <p className="lesson-goal__objective">Learn: {currentStage.learningObjective}</p>}
          <p className="lesson-goal__instructions">{currentStage.instructions}</p>
        </div>

        <div className="lesson-actions">
          {(currentStage.hints?.length ?? 0) > 0 && (
            <div className="hint-panel">
              {revealedHintsForStage.map((hint, index) => (
                <p key={hint.id} className="hint-panel__hint">
                  <strong>Hint {index + 1}</strong> {hint.text}
                </p>
              ))}
              {hasMoreHints && (
                <button type="button" className="secondary-button" onClick={() => actions.revealHint(currentStage.id)}>
                  {revealedHintsForStage.length === 0 ? 'Reveal Hint 1' : 'Reveal another hint'}
                </button>
              )}
            </div>
          )}

          {definition.solution && (
            <button type="button" className="secondary-button" onClick={() => setShowSolution((v) => !v)}>
              {showSolution ? 'Hide solution' : 'Reveal solution'}
            </button>
          )}

          {isCheckpointStage && currentStage && (
            <button type="button" className="primary-button" onClick={() => actions.checkCheckpoint(currentStage.id)}>
              Check progress
            </button>
          )}

          <button type="button" className="secondary-button" onClick={() => handleRestart('reset')}>
            Reset lesson
          </button>
          {lessonComplete && (
            <button type="button" className="secondary-button" onClick={() => handleRestart('new-attempt')}>
              Start new attempt
            </button>
          )}
        </div>

        {definition.solution && showSolution && (
          <div className="solution-panel">
            <p>{definition.solution.explanation}</p>
            {definition.solution.keyPoints && (
              <ul>
                {definition.solution.keyPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
            {definition.solution.exampleExpressions && (
              <pre className="solution-panel__expressions">{definition.solution.exampleExpressions.join('\n')}</pre>
            )}
          </div>
        )}

        {isCheckpointStage && (
          <div className="checkpoint-status" role="status">
            {!checkpointRun ? (
              <p>Checkpoint needs to be checked.</p>
            ) : checkpointStale ? (
              <p>Checkpoint needs to be checked again — the model has changed since the last check.</p>
            ) : checkpointRun.passed ? (
              <p className="checkpoint-status--passed">
                PASS — {Math.round(checkpointRun.pointsEarned)} / {checkpointRun.pointsPossible} ({Math.round(checkpointRun.percentage)}%)
              </p>
            ) : (
              <div>
                <p className="checkpoint-status--failed">
                  Not yet — {Math.round(checkpointRun.pointsEarned)} / {checkpointRun.pointsPossible} ({Math.round(checkpointRun.percentage)}%)
                </p>
                <ul className="checkpoint-status__rules">
                  {checkpointRun.ruleResults
                    .filter((rule) => rule.status !== 'passed')
                    .map((rule) => (
                      <li key={rule.ruleId}>{rule.title}</li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {progress.attemptCount > 0 && (
          <p className="lesson-progress-summary">
            Attempts: {progress.attemptCount} · Best: {progress.bestPercentage !== undefined ? `${Math.round(progress.bestPercentage)}%` : '—'}
            {progress.bestPassed ? ' · Completed' : ''}
          </p>
        )}
      </header>

      <NotebookBody
        notebook={notebook}
        datasets={datasets}
        models={models}
        queries={queries}
        queryEvaluations={queryEvaluations}
        actions={notebookActions}
        currentValidationRuns={currentRuns}
        staleTestCellIds={staleTestCellIds}
        onRunValidation={handleRunValidation}
        notebookVisualContext={visualContext.filterContext}
        slicerSelections={slicerSelections}
        onSlicerChange={handleSlicerChange}
      />
    </section>
  )
}
