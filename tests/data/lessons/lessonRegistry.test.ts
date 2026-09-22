import { describe, expect, it } from 'vitest'
import { getBuiltInLesson, listBuiltInLessons } from '../../../src/data/lessons/lessonRegistry'

describe('lessonRegistry', () => {
  it('registers the four built-in lessons (Sprint 13 + Sprint 14 Power Query) with unique ids', () => {
    const ids = listBuiltInLessons().map((lesson) => lesson.definition.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['retail-foundations', 'filter-context-calculate', 'time-intelligence', 'power-query-cleaning-reshaping'])
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

  it('every lesson defines at least one checkpoint stage, each pointing at a stable ValidationSpec id (never a generated cell id)', () => {
    for (const lesson of listBuiltInLessons()) {
      const checkpointStages = lesson.definition.stages.filter((stage) => stage.checkpointValidationId)
      expect(checkpointStages.length).toBeGreaterThanOrEqual(1)
      for (const stage of checkpointStages) {
        expect(stage.checkpointValidationId).not.toMatch(/^cell_/)
      }
    }
  })

  it('the Sprint 14 Power Query lesson defines multiple independent checkpoint stages, each with a distinct ValidationSpec id', () => {
    const lesson = getBuiltInLesson('power-query-cleaning-reshaping')!
    const checkpointStages = lesson.definition.stages.filter((stage) => stage.checkpointValidationId)
    expect(checkpointStages.length).toBe(4)
    const validationIds = checkpointStages.map((stage) => stage.checkpointValidationId)
    expect(new Set(validationIds).size).toBe(validationIds.length)
  })
})
