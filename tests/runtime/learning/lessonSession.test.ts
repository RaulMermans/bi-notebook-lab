import { describe, expect, it } from 'vitest'
import type { LessonStage } from '../../../src/domain/learning'
import {
  completeLessonSession,
  countRevealedHints,
  createLessonSession,
  markSolutionRevealed,
  revealNextHint,
  setCurrentStage,
} from '../../../src/runtime/learning/lessonSession'

const stage: LessonStage = {
  id: 'stage-1',
  title: 'Stage 1',
  instructions: 'Do the thing.',
  hints: [
    { id: 'h1', text: 'first' },
    { id: 'h2', text: 'second' },
    { id: 'h3', text: 'third' },
  ],
}

describe('createLessonSession', () => {
  it('creates a fresh in-progress session with no revealed hints', () => {
    const session = createLessonSession('lesson-a', 1, 'notebook-1')
    expect(session.status).toBe('in-progress')
    expect(session.lessonId).toBe('lesson-a')
    expect(session.lessonVersion).toBe(1)
    expect(session.notebookId).toBe('notebook-1')
    expect(session.revealedHints).toEqual({})
    expect(session.completedAt).toBeUndefined()
  })

  it('mints a distinct session id every call', () => {
    const a = createLessonSession('lesson-a', 1, 'nb')
    const b = createLessonSession('lesson-a', 1, 'nb')
    expect(a.id).not.toBe(b.id)
  })
})

describe('revealNextHint', () => {
  it('reveals hints one at a time, in authored order', () => {
    let session = createLessonSession('lesson-a', 1, 'nb')

    const first = revealNextHint(session, stage)
    expect(first.hint?.id).toBe('h1')
    session = first.session
    expect(session.revealedHints[stage.id]).toEqual(['h1'])

    const second = revealNextHint(session, stage)
    expect(second.hint?.id).toBe('h2')
    session = second.session
    expect(session.revealedHints[stage.id]).toEqual(['h1', 'h2'])

    const third = revealNextHint(session, stage)
    expect(third.hint?.id).toBe('h3')
    session = third.session
  })

  it('never exposes every hint at once — a no-op once every hint is revealed', () => {
    let session = createLessonSession('lesson-a', 1, 'nb')
    for (let i = 0; i < stage.hints!.length; i += 1) {
      session = revealNextHint(session, stage).session
    }
    expect(countRevealedHints(session)).toBe(3)

    const exhausted = revealNextHint(session, stage)
    expect(exhausted.hint).toBeUndefined()
    expect(exhausted.session).toBe(session)
  })

  it('a stage with no hints never reveals anything', () => {
    const noHintStage: LessonStage = { id: 'no-hints', title: 'x', instructions: 'x' }
    const session = createLessonSession('lesson-a', 1, 'nb')
    const result = revealNextHint(session, noHintStage)
    expect(result.hint).toBeUndefined()
    expect(result.session).toBe(session)
  })
})

describe('setCurrentStage / markSolutionRevealed / completeLessonSession', () => {
  it('setCurrentStage updates immutably and is a no-op when already on that stage', () => {
    const session = createLessonSession('lesson-a', 1, 'nb')
    const moved = setCurrentStage(session, 'stage-2')
    expect(moved).not.toBe(session)
    expect(moved.currentStageId).toBe('stage-2')
    expect(setCurrentStage(moved, 'stage-2')).toBe(moved)
  })

  it('markSolutionRevealed records the stage id once, idempotently', () => {
    const session = createLessonSession('lesson-a', 1, 'nb')
    const revealed = markSolutionRevealed(session, 'stage-2')
    expect(revealed.revealedSolutionStageIds).toEqual(['stage-2'])
    expect(markSolutionRevealed(revealed, 'stage-2')).toBe(revealed)
  })

  it('completeLessonSession marks status completed with a completedAt timestamp', () => {
    const session = createLessonSession('lesson-a', 1, 'nb')
    const completed = completeLessonSession(session)
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).toBeDefined()
  })
})

describe('countRevealedHints', () => {
  it('sums revealed hints across every stage', () => {
    let session = createLessonSession('lesson-a', 1, 'nb')
    session = revealNextHint(session, stage).session
    session = revealNextHint(session, { ...stage, id: 'stage-2' }).session
    expect(countRevealedHints(session)).toBe(2)
  })
})
