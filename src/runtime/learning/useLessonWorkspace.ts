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
import { createLessonAttemptFromCheckpointRuns, isLessonComplete, isStageComplete, summarizeLessonProgress } from './lessonProgress'
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

  // Sprint 14: a lesson may define multiple independent checkpoint stages.
  // Everything below is keyed by `LessonStage.checkpointValidationId` (one
  // entry per checkpoint) rather than assuming there is exactly one — a
  // single-checkpoint lesson (every Sprint 13 built-in) is just the
  // one-entry case of the same maps.
  const checkpointStages = useMemo(() => definition.stages.filter((stage) => stage.checkpointValidationId), [definition])

  const checkpointTestCellsByValidationId = useMemo(() => {
    const map: Record<string, (typeof testCells)[number]> = {}
    for (const stage of checkpointStages) {
      const validationId = stage.checkpointValidationId!
      const cell = testCells.find((c) => c.validation.id === validationId)
      if (cell) map[validationId] = cell
    }
    return map
  }, [testCells, checkpointStages])

  const checkpointRunsByValidationId = useMemo(() => {
    const runs: Record<string, ValidationRun | undefined> = {}
    for (const stage of checkpointStages) {
      const validationId = stage.checkpointValidationId!
      const cell = checkpointTestCellsByValidationId[validationId]
      runs[validationId] = cell ? validationRuns[cell.id] : undefined
    }
    return runs
  }, [checkpointStages, checkpointTestCellsByValidationId, validationRuns])

  const checkpointStaleByValidationId = useMemo(() => {
    const stale: Record<string, boolean> = {}
    for (const stage of checkpointStages) {
      const validationId = stage.checkpointValidationId!
      const cell = checkpointTestCellsByValidationId[validationId]
      const run = checkpointRunsByValidationId[validationId]
      stale[validationId] = !cell || !run ? true : isValidationRunStale(run, { models, datasets, queries, queryEvaluations }, cell)
    }
    return stale
  }, [checkpointStages, checkpointTestCellsByValidationId, checkpointRunsByValidationId, models, datasets, queries, queryEvaluations])

  const stageCompletion = useMemo(() => {
    const completion: Record<string, boolean> = {}
    for (const stage of definition.stages) {
      if (stage.checkpointValidationId) {
        const validationId = stage.checkpointValidationId
        completion[stage.id] = isStageComplete(stage, checkpointRunsByValidationId[validationId], checkpointStaleByValidationId[validationId] ?? true)
      } else {
        completion[stage.id] = isStageComplete(stage, undefined, true)
      }
    }
    return completion
  }, [definition.stages, checkpointRunsByValidationId, checkpointStaleByValidationId])

  const lessonComplete = isLessonComplete(definition.stages, checkpointRunsByValidationId, checkpointStaleByValidationId)

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

  /**
   * Checks one checkpoint stage's `TestCell` and records the result. A
   * `LessonAttempt` is recorded only on the exact check that flips the
   * *whole lesson* from incomplete to complete — comparing
   * `wasComplete`/`isCompleteNow` computed from the pre- and post-update
   * checkpoint-run maps within this same callback avoids depending on
   * effect timing, and avoids recording a second attempt if the learner
   * re-checks an already-passing checkpoint afterwards (sprint brief
   * "Avoid double-counting the same checkpoint when it is re-run
   * repeatedly").
   */
  const checkCheckpoint = useCallback(
    (stageId: string): ValidationRun | undefined => {
      const stage = definition.stages.find((s) => s.id === stageId)
      const validationId = stage?.checkpointValidationId
      if (!validationId) return undefined
      const testCell = checkpointTestCellsByValidationId[validationId]
      if (!testCell) return undefined

      const run = runValidation({ datasets, models, queries, queryEvaluations }, testCell)
      const updatedRuns = { ...validationRuns, [testCell.id]: run }
      setValidationRuns(updatedRuns)

      const runByValidationId = (runs: Record<string, ValidationRun>): Record<string, ValidationRun | undefined> => {
        const map: Record<string, ValidationRun | undefined> = {}
        for (const s of checkpointStages) {
          const vId = s.checkpointValidationId!
          const cell = checkpointTestCellsByValidationId[vId]
          map[vId] = cell ? runs[cell.id] : undefined
        }
        return map
      }
      const staleByValidationId = (runsByValidationId: Record<string, ValidationRun | undefined>): Record<string, boolean> => {
        const map: Record<string, boolean> = {}
        for (const s of checkpointStages) {
          const vId = s.checkpointValidationId!
          const cell = checkpointTestCellsByValidationId[vId]
          const r = runsByValidationId[vId]
          map[vId] = !cell || !r ? true : isValidationRunStale(r, { models, datasets, queries, queryEvaluations }, cell)
        }
        return map
      }

      const previousRunsByValidationId = runByValidationId(validationRuns)
      const wasComplete = isLessonComplete(definition.stages, previousRunsByValidationId, staleByValidationId(previousRunsByValidationId))
      const updatedRunsByValidationId = runByValidationId(updatedRuns)
      const isCompleteNow = isLessonComplete(definition.stages, updatedRunsByValidationId, staleByValidationId(updatedRunsByValidationId))

      if (!wasComplete && isCompleteNow && session) {
        const checkpointRuns = checkpointStages.map((s) => updatedRunsByValidationId[s.checkpointValidationId!]).filter((r): r is ValidationRun => r !== undefined)
        const attempt = createLessonAttemptFromCheckpointRuns({
          lessonId,
          lessonVersion: definition.version,
          startedAt: session.startedAt,
          runs: checkpointRuns,
          hintsUsed: countRevealedHints(session),
        })
        void appendLessonAttempt(lessonId, attempt).then((updated) => setAttempts(updated))
        persistSession(completeLessonSession(session))
      }

      return run
    },
    [definition.stages, definition.version, checkpointStages, checkpointTestCellsByValidationId, validationRuns, datasets, models, queries, queryEvaluations, session, lessonId, persistSession],
  )

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
    checkpointTestCellsByValidationId,
    checkpointRunsByValidationId,
    checkpointStaleByValidationId,
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
