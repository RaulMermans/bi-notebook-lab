import type { LessonAttempt, LessonProgressSummary, LessonStage } from '../../domain/learning'
import type { ValidationRun } from '../../domain/validation'
import { hashString } from '../../lib/hash'
import { generateId } from '../../lib/ids'

/**
 * A stage with no `checkpointValidationId` is guidance-only and completes
 * simply by being reached — lessons "provide guidance, not a rigid workflow
 * engine" (sprint brief). A stage *with* a checkpoint completes only from a
 * current (non-stale) passing `ValidationRun`; the caller is responsible
 * for producing `run`/`isStale` via the existing `runValidation()` /
 * `isValidationRunStale()` (this module never reimplements scoring).
 */
export function isStageComplete(stage: LessonStage, run: ValidationRun | undefined, isStale: boolean): boolean {
  if (!stage.checkpointValidationId) return true
  if (!run || isStale) return false
  return run.passed
}

/**
 * Sprint 14: a lesson is complete once every checkpoint stage it defines is
 * independently complete — `runsByValidationId`/`staleByValidationId` are
 * keyed by `LessonStage.checkpointValidationId`, one entry per checkpoint,
 * so a 3-checkpoint lesson requires all 3 to currently pass, not just the
 * last. A single-checkpoint lesson (all of Sprint 13's built-ins) is just
 * the one-entry case of this — no special-casing needed.
 */
export function isLessonComplete(
  stages: LessonStage[],
  runsByValidationId: Record<string, ValidationRun | undefined>,
  staleByValidationId: Record<string, boolean>,
): boolean {
  const checkpointStages = stages.filter((stage) => stage.checkpointValidationId)
  if (checkpointStages.length === 0) return false
  return checkpointStages.every((stage) => {
    const validationId = stage.checkpointValidationId!
    return isStageComplete(stage, runsByValidationId[validationId], staleByValidationId[validationId] ?? true)
  })
}

/**
 * Sprint 14: one `LessonAttempt` aggregates points across every checkpoint
 * `ValidationRun` in a lesson (previously always exactly one run). The
 * composite `validationFingerprint` is a hash over every checkpoint's own
 * fingerprint, sorted by validation id, so it changes if any checkpoint's
 * semantics would have changed.
 */
export function createLessonAttemptFromCheckpointRuns(params: {
  lessonId: string
  lessonVersion: number
  startedAt: string
  runs: ValidationRun[]
  hintsUsed: number
}): LessonAttempt {
  const pointsEarned = params.runs.reduce((sum, run) => sum + run.pointsEarned, 0)
  const pointsPossible = params.runs.reduce((sum, run) => sum + run.pointsPossible, 0)
  const percentage = pointsPossible === 0 ? 0 : Math.round((pointsEarned / pointsPossible) * 10000) / 100
  const passed = params.runs.every((run) => run.passed)
  const compositeFingerprint = hashString(
    [...params.runs]
      .map((run) => ({ testCellId: run.testCellId, fingerprint: run.fingerprint }))
      .sort((a, b) => a.testCellId.localeCompare(b.testCellId))
      .map((r) => `${r.testCellId}:${r.fingerprint}`)
      .join('|'),
  )

  return {
    id: generateId('lesson-attempt'),
    lessonId: params.lessonId,
    lessonVersion: params.lessonVersion,
    startedAt: params.startedAt,
    completedAt: new Date().toISOString(),
    passed,
    pointsEarned,
    pointsPossible,
    percentage,
    validationFingerprint: compositeFingerprint,
    hintsUsed: params.hintsUsed,
  }
}

/**
 * Aggregates one lesson's historical attempts into a display-ready summary.
 * Scoped to an exact `(lessonId, lessonVersion)` match — an attempt against
 * an older version of the lesson never counts toward a newer version's best
 * score or completion state (sprint brief "Lesson Versioning").
 */
export function summarizeLessonProgress(lessonId: string, lessonVersion: number, attempts: LessonAttempt[]): LessonProgressSummary {
  const relevant = attempts.filter((attempt) => attempt.lessonId === lessonId && attempt.lessonVersion === lessonVersion)
  const sorted = [...relevant].sort((a, b) => (a.completedAt ?? a.startedAt).localeCompare(b.completedAt ?? b.startedAt))
  const latestAttempt = sorted[sorted.length - 1]

  return {
    lessonId,
    lessonVersion,
    attemptCount: relevant.length,
    bestPercentage: relevant.length > 0 ? Math.max(...relevant.map((attempt) => attempt.percentage)) : undefined,
    bestPassed: relevant.some((attempt) => attempt.passed),
    latestAttempt,
    lastAttemptedAt: latestAttempt ? (latestAttempt.completedAt ?? latestAttempt.startedAt) : undefined,
  }
}

export function summarizeAllLessonProgress(
  lessons: { id: string; version: number }[],
  attempts: LessonAttempt[],
): LessonProgressSummary[] {
  return lessons.map((lesson) => summarizeLessonProgress(lesson.id, lesson.version, attempts))
}

export interface LearnerProgressTotals {
  lessonsCompleted: number
  lessonsStarted: number
  totalAttempts: number
}

export function computeLearnerProgressTotals(summaries: LessonProgressSummary[]): LearnerProgressTotals {
  return {
    lessonsCompleted: summaries.filter((summary) => summary.bestPassed).length,
    lessonsStarted: summaries.filter((summary) => summary.attemptCount > 0).length,
    totalAttempts: summaries.reduce((total, summary) => total + summary.attemptCount, 0),
  }
}
