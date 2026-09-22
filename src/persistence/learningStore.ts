import { createStore, del, get, set } from 'idb-keyval'
import type { LessonAttempt, LessonSession } from '../domain/learning'
import type { NotebookDocument } from '../domain/notebook'

const lessonNotebookStore = createStore('bi-notebook-lab-lesson-notebooks', 'lesson-notebooks')
const lessonSessionStore = createStore('bi-notebook-lab-lesson-sessions', 'lesson-sessions')
const lessonAttemptStore = createStore('bi-notebook-lab-lesson-attempts', 'lesson-attempts')

/**
 * The Sprint 13 persistence boundary. Persists exactly `LessonSession` and
 * `LessonAttempt[]` — never a live `ValidationRun`, query evaluation
 * output, measure/visual execution output, or context traces, all of which
 * remain recomputed runtime data (sprint brief "Persistence";
 * docs/VALIDATION_ENGINE.md "Persistence boundaries").
 *
 * A lesson's notebook document is persisted the same way the Free Lab
 * notebook is — structure + cell order only, via `notebookStore.ts`'s
 * pattern — just keyed by lesson id instead of one fixed key, so opening a
 * lesson never overwrites the Free Lab notebook and vice versa (sprint
 * brief "Free Lab Must Survive"). Datasets and models reuse the *existing*
 * `notebookStore.ts`/`modelStore.ts` stores as-is, since those are already
 * keyed by their own generated ids rather than by notebook.
 */
export async function saveLessonNotebook(lessonId: string, notebook: NotebookDocument): Promise<void> {
  await set(lessonId, notebook, lessonNotebookStore)
}

export async function loadLessonNotebook(lessonId: string): Promise<NotebookDocument | undefined> {
  return get<NotebookDocument>(lessonId, lessonNotebookStore)
}

export async function deleteLessonNotebook(lessonId: string): Promise<void> {
  await del(lessonId, lessonNotebookStore)
}

/** One active `LessonSession` per lesson, keyed by lesson id — mirrors the "one active notebook" simplicity of `notebookStore.ts`. */
export async function saveLessonSession(session: LessonSession): Promise<void> {
  await set(session.lessonId, session, lessonSessionStore)
}

export async function loadLessonSession(lessonId: string): Promise<LessonSession | undefined> {
  return get<LessonSession>(lessonId, lessonSessionStore)
}

export async function deleteLessonSession(lessonId: string): Promise<void> {
  await del(lessonId, lessonSessionStore)
}

export async function saveLessonAttempts(lessonId: string, attempts: LessonAttempt[]): Promise<void> {
  await set(lessonId, attempts, lessonAttemptStore)
}

export async function loadLessonAttempts(lessonId: string): Promise<LessonAttempt[]> {
  return (await get<LessonAttempt[]>(lessonId, lessonAttemptStore)) ?? []
}

/** Appends one attempt to a lesson's immutable history and persists the result — history is never rewritten or pruned (sprint brief "Historical Integrity"). */
export async function appendLessonAttempt(lessonId: string, attempt: LessonAttempt): Promise<LessonAttempt[]> {
  const existing = await loadLessonAttempts(lessonId)
  const updated = [...existing, attempt]
  await saveLessonAttempts(lessonId, updated)
  return updated
}

export async function loadAllLessonAttempts(lessonIds: string[]): Promise<Record<string, LessonAttempt[]>> {
  const entries = await Promise.all(lessonIds.map(async (lessonId): Promise<[string, LessonAttempt[]]> => [lessonId, await loadLessonAttempts(lessonId)]))
  return Object.fromEntries(entries)
}
