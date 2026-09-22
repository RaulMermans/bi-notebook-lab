import type { Dataset } from './data'
import type { SemanticModel } from './model'
import type { NotebookDocument } from './notebook'
import type { QueryDefinition } from './query'

export type LessonDifficulty = 'beginner' | 'intermediate' | 'advanced'

export interface LessonHint {
  id: string
  text: string
}

/**
 * Educational content shown on demand — never applied to the learner's
 * model automatically. Revealing a solution is a read action; it must never
 * mutate `LessonSession`/notebook state (sprint brief "Solution Reveal").
 */
export interface LessonSolution {
  explanation: string
  keyPoints?: string[]
  exampleExpressions?: string[]
}

/**
 * A pedagogical grouping of notebook work, not a clone of a notebook cell —
 * a stage describes *what to accomplish*, and points at an existing
 * `ValidationSpec.id` (never a generated `TestCell.id`, which is minted
 * fresh every time a lesson is initialized) for the checkpoint that proves
 * it's done. A stage with no `checkpointValidationId` completes simply by
 * being visited; a stage with one only completes via a current,
 * non-stale, passing `ValidationRun` (see docs/LEARNING_SYSTEM.md
 * "Validation integration").
 */
export interface LessonStage {
  id: string
  title: string
  instructions: string
  learningObjective?: string
  checkpointValidationId?: string
  hints?: LessonHint[]
}

/**
 * The immutable, code-owned definition of a lesson. Never contains a
 * generated runtime id (no dataset/model/cell id) — those are minted fresh
 * every time `BuiltInLesson.initialize()` runs (sprint brief "Lesson
 * Bootstrap Boundary", mirroring the Sprint 5 author-selector principle in
 * `domain/validation.ts`).
 */
export interface LessonDefinition {
  id: string
  version: number

  title: string
  description: string

  difficulty: LessonDifficulty
  estimatedMinutes?: number

  objectives: string[]
  prerequisites?: string[]
  tags?: string[]

  stages: LessonStage[]

  solution?: LessonSolution
}

/**
 * The deterministic starting runtime state for a lesson attempt — exactly
 * the shape `NotebookRuntime`/`useNotebookRuntime` already consume, so the
 * Learning System never invents a parallel notebook representation.
 * `queries`/`queryEvaluations` default to `{}` for lessons that don't use
 * Power Query.
 */
export interface LessonInitialState {
  notebook: NotebookDocument
  datasets: Record<string, Dataset>
  models: Record<string, SemanticModel>
  queries?: Record<string, QueryDefinition>
}

/**
 * Pairs an immutable `LessonDefinition` with the deterministic factory that
 * builds its starting notebook state. `initialize()` may mint fresh runtime
 * ids and drive the real notebook/model runtimes (never a parallel data
 * structure) — see `src/data/lessons/support/`. Factory functions
 * themselves are never persisted; only their *output* (a `NotebookDocument`
 * + datasets/models) is.
 */
export interface BuiltInLesson {
  definition: LessonDefinition
  initialize(): LessonInitialState
}

export type LessonSessionStatus = 'not-started' | 'in-progress' | 'completed'

/**
 * A learner's current attempt at a lesson — mutable, and entirely separate
 * from the immutable `LessonDefinition` it points at. "Raul's current
 * attempt at Retail Foundations v1," not the lesson itself.
 */
export interface LessonSession {
  id: string

  lessonId: string
  lessonVersion: number

  notebookId: string

  status: LessonSessionStatus

  startedAt: string
  updatedAt: string
  completedAt?: string

  currentStageId?: string

  /** Hint ids revealed so far, keyed by stage id. Never auto-populated — see "Hints" (sprint brief). */
  revealedHints: Record<string, string[]>

  /** Whether the stage-level solution was revealed at least once, keyed by stage id — analytics only; never mutates learner state. */
  revealedSolutionStageIds?: string[]
}

/**
 * A historical record of what happened at a specific point in time. Never
 * treated as proof that the *current* notebook is still valid — that
 * question is always answered fresh by `runValidation()`
 * (docs/VALIDATION_ENGINE.md "Persistence boundaries"; sprint brief
 * "Preserve Sprint 5 Validation Truth").
 */
export interface LessonAttempt {
  id: string

  lessonId: string
  lessonVersion: number

  startedAt: string
  completedAt?: string

  passed: boolean

  pointsEarned: number
  pointsPossible: number
  percentage: number

  validationFingerprint?: string

  hintsUsed: number
}

/** Aggregated view of a single lesson's history — derived from `LessonAttempt[]`, never stored directly. */
export interface LessonProgressSummary {
  lessonId: string
  lessonVersion: number
  attemptCount: number
  bestPercentage?: number
  bestPassed: boolean
  latestAttempt?: LessonAttempt
  lastAttemptedAt?: string
}
