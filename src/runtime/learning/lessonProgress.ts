import type { LessonAttempt, LessonProgressSummary, LessonStage } from '../../domain/learning'
import type { ValidationRun } from '../../domain/validation'
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
 * A lesson is complete once every checkpoint stage it defines is complete.
 * All three built-in lessons define exactly one checkpoint stage (their
 * last), so this reduces to "did the final checkpoint pass" for Sprint 13
 * — a lesson with multiple independent checkpoints would need a
 * `Record<validationId, ValidationRun>` instead of a single `run`, which is
 * out of scope until a built-in lesson actually needs it.
 */
export function isLessonComplete(stages: LessonStage[], run: ValidationRun | undefined, isStale: boolean): boolean {
  const checkpointStages = stages.filter((stage) => stage.checkpointValidationId)
  if (checkpointStages.length === 0) return false
  return checkpointStages.every((stage) => isStageComplete(stage, run, isStale))
}

export function createLessonAttemptFromValidationRun(params: {
  lessonId: string
  lessonVersion: number
  startedAt: string
  run: ValidationRun
  hintsUsed: number
}): LessonAttempt {
  return {
    id: generateId('lesson-attempt'),
    lessonId: params.lessonId,
    lessonVersion: params.lessonVersion,
    startedAt: params.startedAt,
    completedAt: new Date().toISOString(),
    passed: params.run.passed,
    pointsEarned: params.run.pointsEarned,
    pointsPossible: params.run.pointsPossible,
    percentage: params.run.percentage,
    validationFingerprint: params.run.fingerprint,
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
