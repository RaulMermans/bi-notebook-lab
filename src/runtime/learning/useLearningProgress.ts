import { useEffect, useState } from 'react'
import type { LessonAttempt } from '../../domain/learning'
import { listBuiltInLessons } from '../../data/lessons/lessonRegistry'
import { loadAllLessonAttempts } from '../../persistence/learningStore'
import { computeLearnerProgressTotals, summarizeAllLessonProgress } from './lessonProgress'

/**
 * Loads every built-in lesson's attempt history and derives the dashboard's
 * summaries/totals. Lesson metadata itself is free (in-memory, from the
 * code-owned registry) — only attempt history requires an async load
 * (sprint brief "Performance": "Load lesson metadata cheaply").
 */
export function useLearningProgress() {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading')
  const [attemptsByLesson, setAttemptsByLesson] = useState<Record<string, LessonAttempt[]>>({})

  const lessons = listBuiltInLessons()

  useEffect(() => {
    let cancelled = false

    async function load() {
      const result = await loadAllLessonAttempts(lessons.map((lesson) => lesson.definition.id))
      if (cancelled) return
      setAttemptsByLesson(result)
      setStatus('ready')
    }

    load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the built-in lesson list is a static, code-owned constant.
  }, [])

  const allAttempts = Object.values(attemptsByLesson).flat()
  const summaries = summarizeAllLessonProgress(
    lessons.map((lesson) => ({ id: lesson.definition.id, version: lesson.definition.version })),
    allAttempts,
  )
  const totals = computeLearnerProgressTotals(summaries)

  return { status, lessons, summaries, totals }
}
