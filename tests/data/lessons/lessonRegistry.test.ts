import { describe, expect, it } from 'vitest'
import { getBuiltInLesson, listBuiltInLessons } from '../../../src/data/lessons/lessonRegistry'

describe('lessonRegistry', () => {
  it('registers exactly the three built-in Sprint 13 lessons with unique ids', () => {
    const ids = listBuiltInLessons().map((lesson) => lesson.definition.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['retail-foundations', 'filter-context-calculate', 'time-intelligence'])
  })

  it('looks up a lesson by id, and returns undefined for an unknown id', () => {
    expect(getBuiltInLesson('retail-foundations')?.definition.title).toBe('Retail Foundations')
    expect(getBuiltInLesson('does-not-exist')).toBeUndefined()
  })

  it('every lesson has a positive version and every stage id is unique within the lesson', () => {
    for (const lesson of listBuiltInLessons()) {
      expect(lesson.definition.version).toBeGreaterThanOrEqual(1)
      const stageIds = lesson.definition.stages.map((stage) => stage.id)
      expect(new Set(stageIds).size).toBe(stageIds.length)
      expect(lesson.definition.stages.length).toBeGreaterThan(0)
    }
  })

  it('every lesson defines exactly one checkpoint stage, pointing at a stable ValidationSpec id (never a generated cell id)', () => {
    for (const lesson of listBuiltInLessons()) {
      const checkpointStages = lesson.definition.stages.filter((stage) => stage.checkpointValidationId)
      expect(checkpointStages).toHaveLength(1)
      expect(checkpointStages[0].checkpointValidationId).not.toMatch(/^cell_/)
    }
  })
})
