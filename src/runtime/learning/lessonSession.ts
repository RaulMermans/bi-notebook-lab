import type { LessonHint, LessonSession, LessonStage } from '../../domain/learning'
import { generateId } from '../../lib/ids'

/**
 * Creates a fresh, in-progress `LessonSession` for a brand-new attempt.
 * Used both by "Start lesson" and "Start new attempt"/"Reset lesson" — all
 * three produce a new session id and empty hint/stage state; the only
 * difference between them is *when* the caller invokes this and whether it
 * re-runs the lesson's deterministic initializer first (see
 * `docs/LEARNING_SYSTEM.md` "Reset vs. new attempt").
 */
export function createLessonSession(lessonId: string, lessonVersion: number, notebookId: string): LessonSession {
  const now = new Date().toISOString()
  return {
    id: generateId('lesson-session'),
    lessonId,
    lessonVersion,
    notebookId,
    status: 'in-progress',
    startedAt: now,
    updatedAt: now,
    revealedHints: {},
  }
}

export function setCurrentStage(session: LessonSession, stageId: string): LessonSession {
  if (session.currentStageId === stageId) return session
  return { ...session, currentStageId: stageId, updatedAt: new Date().toISOString() }
}

/**
 * Reveals the next not-yet-revealed hint for `stage`, in authored order.
 * Returns the session unchanged (and no hint) once every hint for this
 * stage has already been revealed — hints are never exposed all at once
 * (sprint brief "Hints": "Reveal hints progressively... Do not automatically
 * expose every hint.").
 */
export function revealNextHint(session: LessonSession, stage: LessonStage): { session: LessonSession; hint?: LessonHint } {
  const hints = stage.hints ?? []
  const revealed = session.revealedHints[stage.id] ?? []
  const next = hints.find((hint) => !revealed.includes(hint.id))
  if (!next) return { session }

  return {
    session: {
      ...session,
      revealedHints: { ...session.revealedHints, [stage.id]: [...revealed, next.id] },
      updatedAt: new Date().toISOString(),
    },
    hint: next,
  }
}

/** Tracked for learning analytics only — revealing a solution never mutates learner/model state (sprint brief "Solution Reveal"). */
export function markSolutionRevealed(session: LessonSession, stageId: string): LessonSession {
  const revealed = session.revealedSolutionStageIds ?? []
  if (revealed.includes(stageId)) return session
  return { ...session, revealedSolutionStageIds: [...revealed, stageId], updatedAt: new Date().toISOString() }
}

export function countRevealedHints(session: LessonSession): number {
  return Object.values(session.revealedHints).reduce((total, hints) => total + hints.length, 0)
}

export function completeLessonSession(session: LessonSession): LessonSession {
  const now = new Date().toISOString()
  return { ...session, status: 'completed', completedAt: now, updatedAt: now }
}
