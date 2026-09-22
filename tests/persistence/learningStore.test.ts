import { describe, expect, it } from 'vitest'
import type { LessonAttempt } from '../../src/domain/learning'
import {
  appendLessonAttempt,
  deleteLessonNotebook,
  deleteLessonSession,
  loadAllLessonAttempts,
  loadLessonAttempts,
  loadLessonNotebook,
  loadLessonSession,
  saveLessonNotebook,
  saveLessonSession,
} from '../../src/persistence/learningStore'
import { emptyNotebook } from '../../src/runtime/notebook/notebookRuntime'
import { createLessonSession } from '../../src/runtime/learning/lessonSession'

function fakeAttempt(id: string, lessonId: string, percentage: number): LessonAttempt {
  return {
    id,
    lessonId,
    lessonVersion: 1,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    passed: percentage >= 70,
    pointsEarned: percentage,
    pointsPossible: 100,
    percentage,
    hintsUsed: 0,
  }
}

describe('learningStore persistence', () => {
  it('round-trips a lesson notebook under its own key, independent of the Free Lab store', async () => {
    const notebook = emptyNotebook('Retail Foundations')
    await saveLessonNotebook('lesson-x', notebook)

    const restored = await loadLessonNotebook('lesson-x')
    expect(restored).toEqual(notebook)

    // A different lesson id has never been saved.
    expect(await loadLessonNotebook('lesson-y')).toBeUndefined()
  })

  it('deletes a persisted lesson notebook', async () => {
    await saveLessonNotebook('lesson-del', emptyNotebook('t'))
    await deleteLessonNotebook('lesson-del')
    expect(await loadLessonNotebook('lesson-del')).toBeUndefined()
  })

  it('round-trips a lesson session, one active session per lesson', async () => {
    const session = createLessonSession('lesson-x', 1, 'notebook-1')
    await saveLessonSession(session)

    const restored = await loadLessonSession('lesson-x')
    expect(restored).toEqual(session)
  })

  it('deletes a persisted lesson session', async () => {
    await saveLessonSession(createLessonSession('lesson-del-session', 1, 'notebook-1'))
    await deleteLessonSession('lesson-del-session')
    expect(await loadLessonSession('lesson-del-session')).toBeUndefined()
  })

  it('appends attempts to an immutable history without overwriting earlier ones', async () => {
    await appendLessonAttempt('lesson-history', fakeAttempt('a1', 'lesson-history', 60))
    const afterSecond = await appendLessonAttempt('lesson-history', fakeAttempt('a2', 'lesson-history', 100))

    expect(afterSecond.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(await loadLessonAttempts('lesson-history')).toHaveLength(2)
  })

  it('loads attempts for multiple lessons keyed by lesson id', async () => {
    await appendLessonAttempt('lesson-multi-a', fakeAttempt('m1', 'lesson-multi-a', 100))
    await appendLessonAttempt('lesson-multi-b', fakeAttempt('m2', 'lesson-multi-b', 50))

    const all = await loadAllLessonAttempts(['lesson-multi-a', 'lesson-multi-b', 'lesson-multi-never-started'])
    expect(all['lesson-multi-a']).toHaveLength(1)
    expect(all['lesson-multi-b']).toHaveLength(1)
    expect(all['lesson-multi-never-started']).toEqual([])
  })

  it('never persists a ValidationRun-shaped field on a LessonAttempt', async () => {
    const attempt = fakeAttempt('shape-check', 'lesson-shape', 100)
    await appendLessonAttempt('lesson-shape', attempt)
    const [restored] = await loadLessonAttempts('lesson-shape')
    expect(restored).not.toHaveProperty('ruleResults')
    expect(restored).not.toHaveProperty('testCellId')
  })
})
