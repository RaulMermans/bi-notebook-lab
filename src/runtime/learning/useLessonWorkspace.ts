import { useCallback, useEffect, useMemo, useState } from 'react'
import type { BuiltInLesson, LessonAttempt, LessonHint, LessonSession } from '../../domain/learning'
import type { NotebookCell } from '../../domain/notebook'
import type { ValidationRun } from '../../domain/validation'
import { deleteModel } from '../../persistence/modelStore'
import { deleteDataset } from '../../persistence/notebookStore'
import {
  appendLessonAttempt,
  deleteLessonNotebook,
  deleteLessonSession,
  loadLessonAttempts,
  loadLessonNotebook,
  loadLessonSession,
  saveLessonNotebook,
  saveLessonSession,
} from '../../persistence/learningStore'
import { isValidationRunStale } from '../validation/fingerprint'
import { runValidation } from '../validation/validationEngine'
import { useNotebookRuntime } from '../notebook/useNotebookRuntime'
import { createLessonAttemptFromValidationRun, isLessonComplete, isStageComplete, summarizeLessonProgress } from './lessonProgress'
import { completeLessonSession, countRevealedHints, createLessonSession, markSolutionRevealed, revealNextHint, setCurrentStage } from './lessonSession'

export type LessonSessionHydrationStatus = 'loading' | 'ready'

/**
 * Orchestrates one lesson attempt: wires `useNotebookRuntime` to a
 * lesson-scoped persistence adapter (so the lesson's notebook never
 * collides with the Free Lab notebook — `persistence/learningStore.ts`),
 * loads/creates the `LessonSession` + `LessonAttempt` history, and derives
 * checkpoint/stage completion by calling the *existing* Validation Engine
 * (`runValidation`/`isValidationRunStale`) exactly like `App.tsx` does for
 * the Free Lab — this module never reimplements scoring
 * (docs/VALIDATION_ENGINE.md; sprint brief "Validation Integration").
 *
 * Callers should mount the component using this hook with
 * `key={lesson.definition.id}` (switching lessons) and bump a separate key
 * after `actions.resetLesson()`/`actions.startNewAttempt()` resolves — both
 * clear this lesson's persisted notebook/session so the next mount's
 * `useNotebookRuntime` hydration re-runs `lesson.initialize()` from
 * scratch. This hook cannot force its own remount; only re-mounting picks
 * up a fresh `NotebookRuntime` instance.
 */
export function useLessonWorkspace(lesson: BuiltInLesson) {
  const { definition } = lesson
  const lessonId = definition.id

  const persistence = useMemo(
    () => ({
      load: () => loadLessonNotebook(lessonId),
      save: (notebook: import('../../domain/notebook').NotebookDocument) => saveLessonNotebook(lessonId, notebook),
    }),
    [lessonId],
  )

  const {
    notebook,
    datasets,
    models,
    queries,
    queryEvaluations,
    status: notebookStatus,
    actions: notebookActions,
  } = useNotebookRuntime({ persistence, createInitialSnapshot: lesson.initialize })

  const [session, setSession] = useState<LessonSession | undefined>(undefined)
  const [attempts, setAttempts] = useState<LessonAttempt[]>([])
  const [sessionStatus, setSessionStatus] = useState<LessonSessionHydrationStatus>('loading')
  // Never persisted — a reload must never resurrect a stale ValidationRun as current truth (sprint brief "Reload never restores a ValidationRun as current truth"; mirrors App.tsx's `validationRuns` state exactly).
  const [validationRuns, setValidationRuns] = useState<Record<string, ValidationRun>>({})

  useEffect(() => {
    let cancelled = false
    setSessionStatus('loading')
    setValidationRuns({})

    async function hydrate() {
      const [persistedSession, persistedAttempts] = await Promise.all([loadLessonSession(lessonId), loadLessonAttempts(lessonId)])
      if (cancelled) return

      if (persistedSession && persistedSession.lessonVersion === definition.version) {
        setSession(persistedSession)
      } else {
        const fresh = createLessonSession(lessonId, definition.version, lessonId)
        await saveLessonSession(fresh)
        if (cancelled) return
        setSession(fresh)
      }
      setAttempts(persistedAttempts)
      setSessionStatus('ready')
    }

    hydrate()
    return () => {
      cancelled = true
    }
  }, [lessonId, definition.version])

  const persistSession = useCallback((next: LessonSession) => {
    setSession(next)
    void saveLessonSession(next)
  }, [])

  const testCells = useMemo(
    () => notebook.cells.filter((cell): cell is Extract<NotebookCell, { kind: 'test' }> => cell.kind === 'test'),
    [notebook.cells],
  )

  const checkpointStage = useMemo(() => definition.stages.find((stage) => stage.checkpointValidationId), [definition])
  const checkpointTestCell = useMemo(
    () => (checkpointStage ? testCells.find((cell) => cell.validation.id === checkpointStage.checkpointValidationId) : undefined),
    [testCells, checkpointStage],
  )

  const checkpointRun = checkpointTestCell ? validationRuns[checkpointTestCell.id] : undefined
  const checkpointStale = useMemo(() => {
    if (!checkpointRun || !checkpointTestCell) return true
    const model = models[checkpointTestCell.modelId]
    if (!model) return true
    return isValidationRunStale(checkpointRun, model, datasets, checkpointTestCell.validation)
  }, [checkpointRun, checkpointTestCell, models, datasets])

  const stageCompletion = useMemo(() => {
    const completion: Record<string, boolean> = {}
    for (const stage of definition.stages) {
      const isCheckpointStage = checkpointStage !== undefined && stage.id === checkpointStage.id
      completion[stage.id] = isCheckpointStage ? isStageComplete(stage, checkpointRun, checkpointStale) : isStageComplete(stage, undefined, true)
    }
    return completion
  }, [definition.stages, checkpointStage, checkpointRun, checkpointStale])

  const lessonComplete = isLessonComplete(definition.stages, checkpointRun, checkpointStale)

  const progress = useMemo(() => summarizeLessonProgress(lessonId, definition.version, attempts), [lessonId, definition.version, attempts])

  const goToStage = useCallback(
    (stageId: string) => {
      if (!session) return
      persistSession(setCurrentStage(session, stageId))
    },
    [session, persistSession],
  )

  const revealHint = useCallback(
    (stageId: string): LessonHint | undefined => {
      if (!session) return undefined
      const stage = definition.stages.find((s) => s.id === stageId)
      if (!stage) return undefined
      const { session: next, hint } = revealNextHint(session, stage)
      if (next !== session) persistSession(next)
      return hint
    },
    [session, definition.stages, persistSession],
  )

  const revealSolution = useCallback(
    (stageId: string) => {
      if (!session) return
      persistSession(markSolutionRevealed(session, stageId))
    },
    [session, persistSession],
  )

  const checkCheckpoint = useCallback((): ValidationRun | undefined => {
    if (!checkpointTestCell) return undefined
    const run = runValidation({ datasets, models }, checkpointTestCell)
    setValidationRuns((runs) => ({ ...runs, [checkpointTestCell.id]: run }))

    if (run.passed && session) {
      const attempt = createLessonAttemptFromValidationRun({
        lessonId,
        lessonVersion: definition.version,
        startedAt: session.startedAt,
        run,
        hintsUsed: countRevealedHints(session),
      })
      void appendLessonAttempt(lessonId, attempt).then((updated) => setAttempts(updated))
      persistSession(completeLessonSession(session))
    }

    return run
  }, [checkpointTestCell, datasets, models, session, lessonId, definition.version, persistSession])

  /**
   * Clears this lesson's persisted notebook/session (and the dataset/model
   * records the *current* notebook referenced, so they don't linger as
   * orphaned IndexedDB rows) without touching attempt history. The next
   * time this lesson is mounted, `useNotebookRuntime` finds nothing
   * persisted and re-runs `lesson.initialize()` from scratch — the same
   * mechanism backs both "Reset lesson" and "Start new attempt" (sprint
   * brief: both produce a fresh `LessonSession`; neither touches history).
   * The caller must remount (bump a `key`) after this resolves — see this
   * module's doc comment.
   */
  const clearPersistedAttempt = useCallback(async () => {
    const oldDatasetIds = notebook.cells.filter((cell): cell is Extract<NotebookCell, { kind: 'data' }> => cell.kind === 'data').map((cell) => cell.datasetId)
    const oldModelIds = notebook.cells.filter((cell): cell is Extract<NotebookCell, { kind: 'model' }> => cell.kind === 'model').map((cell) => cell.modelId)
    await Promise.all([
      deleteLessonNotebook(lessonId),
      deleteLessonSession(lessonId),
      ...oldDatasetIds.map((id) => deleteDataset(id)),
      ...oldModelIds.map((id) => deleteModel(id)),
    ])
  }, [lessonId, notebook.cells])

  return {
    definition,
    notebook,
    datasets,
    models,
    queries,
    queryEvaluations,
    notebookActions,
    status: notebookStatus === 'ready' && sessionStatus === 'ready' ? ('ready' as const) : ('loading' as const),
    session,
    attempts,
    progress,
    stageCompletion,
    lessonComplete,
    checkpointTestCell,
    checkpointRun,
    checkpointStale,
    validationRuns,
    actions: {
      goToStage,
      revealHint,
      revealSolution,
      checkCheckpoint,
      resetLesson: clearPersistedAttempt,
      startNewAttempt: clearPersistedAttempt,
    },
  }
}
