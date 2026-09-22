import { describe, expect, it } from 'vitest'
import type { LessonAttempt, LessonStage } from '../../../src/domain/learning'
import type { ValidationRun } from '../../../src/domain/validation'
import {
  computeLearnerProgressTotals,
  createLessonAttemptFromValidationRun,
  isLessonComplete,
  isStageComplete,
  summarizeAllLessonProgress,
  summarizeLessonProgress,
} from '../../../src/runtime/learning/lessonProgress'

function fakeRun(overrides: Partial<ValidationRun> = {}): ValidationRun {
  return { testCellId: 't1', pointsEarned: 100, pointsPossible: 100, percentage: 100, passed: true, ruleResults: [], fingerprint: 'fp', ...overrides }
}

function fakeAttempt(overrides: Partial<LessonAttempt> & Pick<LessonAttempt, 'id' | 'lessonId' | 'lessonVersion'>): LessonAttempt {
  return {
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:10:00.000Z',
    passed: false,
    pointsEarned: 0,
    pointsPossible: 100,
    percentage: 0,
    hintsUsed: 0,
    ...overrides,
  }
}

describe('isStageComplete', () => {
  const guidanceStage: LessonStage = { id: 'g', title: 'Guidance', instructions: '...' }
  const checkpointStage: LessonStage = { id: 'c', title: 'Checkpoint', instructions: '...', checkpointValidationId: 'spec-1' }

  it('a guidance-only stage (no checkpoint) is always complete, regardless of any run', () => {
    expect(isStageComplete(guidanceStage, undefined, true)).toBe(true)
  })

  it('a checkpoint stage is incomplete with no run at all', () => {
    expect(isStageComplete(checkpointStage, undefined, true)).toBe(false)
  })

  it('a stale run can never complete a checkpoint stage, even if it previously passed', () => {
    expect(isStageComplete(checkpointStage, fakeRun({ passed: true }), true)).toBe(false)
  })

  it('a current but failing run does not complete a checkpoint stage', () => {
    expect(isStageComplete(checkpointStage, fakeRun({ passed: false }), false)).toBe(false)
  })

  it('a current, passing run completes a checkpoint stage', () => {
    expect(isStageComplete(checkpointStage, fakeRun({ passed: true }), false)).toBe(true)
  })
})

describe('isLessonComplete', () => {
  const guidanceStage: LessonStage = { id: 'g', title: 'Guidance', instructions: '...' }
  const checkpointStage: LessonStage = { id: 'c', title: 'Checkpoint', instructions: '...', checkpointValidationId: 'spec-1' }

  it('a lesson with no checkpoint stage is never complete', () => {
    expect(isLessonComplete([guidanceStage], fakeRun(), false)).toBe(false)
  })

  it('completes once its checkpoint stage is complete', () => {
    expect(isLessonComplete([guidanceStage, checkpointStage], fakeRun({ passed: true }), false)).toBe(true)
  })

  it('does not complete while the checkpoint run is stale', () => {
    expect(isLessonComplete([guidanceStage, checkpointStage], fakeRun({ passed: true }), true)).toBe(false)
  })
})

describe('createLessonAttemptFromValidationRun', () => {
  it('captures the run’s score/fingerprint and the caller-supplied hint count', () => {
    const attempt = createLessonAttemptFromValidationRun({
      lessonId: 'lesson-a',
      lessonVersion: 1,
      startedAt: '2026-01-01T00:00:00.000Z',
      run: fakeRun({ pointsEarned: 80, pointsPossible: 100, percentage: 80, passed: true, fingerprint: 'fp-1' }),
      hintsUsed: 2,
    })
    expect(attempt.lessonId).toBe('lesson-a')
    expect(attempt.lessonVersion).toBe(1)
    expect(attempt.passed).toBe(true)
    expect(attempt.percentage).toBe(80)
    expect(attempt.validationFingerprint).toBe('fp-1')
    expect(attempt.hintsUsed).toBe(2)
    expect(attempt.startedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(attempt.completedAt).toBeDefined()
  })
})

describe('summarizeLessonProgress', () => {
  it('computes attempt count, best percentage, and best-passed across multiple attempts', () => {
    const attempts: LessonAttempt[] = [
      fakeAttempt({ id: 'a1', lessonId: 'lesson-a', lessonVersion: 1, passed: false, percentage: 60, startedAt: 't0', completedAt: 't1' }),
      fakeAttempt({ id: 'a2', lessonId: 'lesson-a', lessonVersion: 1, passed: true, percentage: 90, startedAt: 't2', completedAt: 't3' }),
      fakeAttempt({ id: 'a3', lessonId: 'lesson-a', lessonVersion: 1, passed: true, percentage: 100, startedAt: 't4', completedAt: 't5' }),
    ]
    const summary = summarizeLessonProgress('lesson-a', 1, attempts)
    expect(summary.attemptCount).toBe(3)
    expect(summary.bestPercentage).toBe(100)
    expect(summary.bestPassed).toBe(true)
    expect(summary.latestAttempt?.id).toBe('a3')
    expect(summary.lastAttemptedAt).toBe('t5')
  })

  it('a lower-scoring later attempt does not lower the recorded best score', () => {
    const attempts: LessonAttempt[] = [
      fakeAttempt({ id: 'a1', lessonId: 'lesson-a', lessonVersion: 1, passed: true, percentage: 100, startedAt: 't0', completedAt: 't1' }),
      fakeAttempt({ id: 'a2', lessonId: 'lesson-a', lessonVersion: 1, passed: true, percentage: 80, startedAt: 't2', completedAt: 't3' }),
    ]
    const summary = summarizeLessonProgress('lesson-a', 1, attempts)
    expect(summary.bestPercentage).toBe(100)
    expect(summary.latestAttempt?.id).toBe('a2')
  })

  it('never counts an attempt recorded against a different lesson version', () => {
    const attempts: LessonAttempt[] = [fakeAttempt({ id: 'a1', lessonId: 'lesson-a', lessonVersion: 1, passed: true, percentage: 100 })]
    const summary = summarizeLessonProgress('lesson-a', 2, attempts)
    expect(summary.attemptCount).toBe(0)
    expect(summary.bestPassed).toBe(false)
    expect(summary.bestPercentage).toBeUndefined()
    expect(summary.latestAttempt).toBeUndefined()
  })

  it('with zero attempts, reports zero/undefined rather than throwing', () => {
    const summary = summarizeLessonProgress('lesson-a', 1, [])
    expect(summary.attemptCount).toBe(0)
    expect(summary.bestPercentage).toBeUndefined()
    expect(summary.bestPassed).toBe(false)
  })
})

describe('summarizeAllLessonProgress / computeLearnerProgressTotals', () => {
  it('aggregates lessons completed/started/total attempts across every lesson', () => {
    const summaries = summarizeAllLessonProgress(
      [
        { id: 'a', version: 1 },
        { id: 'b', version: 1 },
        { id: 'c', version: 1 },
      ],
      [
        fakeAttempt({ id: '1', lessonId: 'a', lessonVersion: 1, passed: true, percentage: 100 }),
        fakeAttempt({ id: '2', lessonId: 'b', lessonVersion: 1, passed: false, percentage: 50 }),
      ],
    )
    const totals = computeLearnerProgressTotals(summaries)
    expect(totals.lessonsCompleted).toBe(1)
    expect(totals.lessonsStarted).toBe(2)
    expect(totals.totalAttempts).toBe(2)
  })
})
