import type { Dataset } from './data'
import type { SemanticModel } from './model'
import type { NotebookDocument } from './notebook'
import type { QueryDefinition } from './query'

/**
 * Sprint 16 Part B — a free-experimentation starting point, distinct from a
 * scored Learning System lesson (`domain/learning.ts`). Practice Projects
 * live under Free Lab's "Start" surface; lessons stay under Exercises. This
 * mirrors `LessonInitialState`/`BuiltInLesson` exactly on purpose — the
 * same "plain data object + one generic consuming component" pattern
 * AGENTS.md guardrail #8 requires of lessons applies here too, not a
 * JSON/DSL template format.
 */
export interface PracticeProjectInitialState {
  notebook: NotebookDocument
  datasets: Record<string, Dataset>
  models: Record<string, SemanticModel>
  queries?: Record<string, QueryDefinition>
}

/**
 * The immutable, code-owned definition of a practice project. `initialize()`
 * mints fresh runtime ids on every call (it drives the real
 * `NotebookRuntime`, same as a lesson's `initialize()`), so starting the
 * same template twice — or once after importing/discarding it — never
 * shares state with a previous attempt (brief Part B §13 "Template
 * Isolation").
 */
export interface PracticeProjectDefinition {
  id: string
  title: string
  description: string
  objectives: string[]
  initialize(): PracticeProjectInitialState
}
