import type { BuiltInLesson } from '../../domain/learning'
import { filterContextLesson } from './filterContextLesson'
import { powerQueryLesson } from './powerQueryLesson'
import { retailFoundationsLesson } from './retailFoundationsLesson'
import { timeIntelligenceLesson } from './timeIntelligenceLesson'

/**
 * The canonical, code-owned built-in lesson registry (sprint brief "Built-In
 * Lesson Registry"). Every lesson is a plain factory function returning a
 * `BuiltInLesson` — there is deliberately no JSON bundle format, import/
 * export format, lesson DSL, or remote registry yet. That belongs to the
 * future Authoring phase (ROADMAP.md Phase 10); see
 * docs/LEARNING_SYSTEM.md "Future authoring boundary".
 */
const BUILT_IN_LESSONS: BuiltInLesson[] = [retailFoundationsLesson, filterContextLesson, timeIntelligenceLesson, powerQueryLesson]

const duplicateIds = BUILT_IN_LESSONS.map((lesson) => lesson.definition.id).filter((id, index, ids) => ids.indexOf(id) !== index)
if (duplicateIds.length > 0) {
  throw new Error(`Duplicate lesson id(s) in the built-in lesson registry: ${duplicateIds.join(', ')}`)
}

export function listBuiltInLessons(): BuiltInLesson[] {
  return BUILT_IN_LESSONS
}

export function getBuiltInLesson(lessonId: string): BuiltInLesson | undefined {
  return BUILT_IN_LESSONS.find((lesson) => lesson.definition.id === lessonId)
}
