# Learning System (Sprint 13)

```text
BI execution environment
        ↓
BI learning environment
```

Sprints 1–12 built an engine capable of teaching substantial Power BI
workflows. Sprint 13 does not add any DAX, Power Query, or model-object
capability — it organizes what already exists into a repeatable loop:

```text
Choose lesson → Understand objective → Work through notebook → Reach
checkpoint → Run real validation → Receive score + feedback → Use hint if
needed → Complete lesson → Record historical progress → Continue
```

## Architecture boundary

```text
┌──────────────────────────────┐
│       Learning System        │
│ Lessons / Sessions / Progress│
└──────────────┬───────────────┘
               │ orchestrates
               ▼
┌──────────────────────────────┐
│       Notebook Runtime       │
└──────────────┬───────────────┘
               │
               ├── Data
               ├── Power Query
               ├── Semantic Model
               ├── Calculated Columns
               ├── Measures
               ├── Visuals
               └── Validation
```

The Learning System **orchestrates** the existing runtimes. It never
reimplements them:

- Lesson checkpoints are graded by the existing `runValidation()`
  (`runtime/validation/validationEngine.ts`) — see "Validation integration"
  below.
- A lesson's starting notebook is built by driving the existing
  `NotebookRuntime` (`runtime/notebook/notebookRuntime.ts`) — see "Lesson
  bootstrap" below.
- The notebook cells a learner sees and edits inside a lesson are the exact
  same `<NotebookCell>` components the Free Lab renders (via the shared
  `<NotebookBody>`, `src/components/notebook/NotebookBody.tsx`) — there is
  no second execution UI.

## Domain contract (`src/domain/learning.ts`)

### `LessonDefinition`

The immutable, code-owned definition of a lesson:

```ts
interface LessonDefinition {
  id: string
  version: number
  title: string
  description: string
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  estimatedMinutes?: number
  objectives: string[]
  prerequisites?: string[]
  tags?: string[]
  stages: LessonStage[]
  solution?: LessonSolution
}
```

It never contains a generated runtime id (no dataset/model/cell id) — see
"Lesson bootstrap boundary" below, which mirrors the Sprint 5 author-selector
principle in `domain/validation.ts` ("Author selectors vs. runtime ids").

### `LessonStage`

A stage is pedagogical, not a clone of a notebook cell:

```ts
interface LessonStage {
  id: string
  title: string
  instructions: string
  learningObjective?: string
  checkpointValidationId?: string
  hints?: LessonHint[]
}
```

`checkpointValidationId` is a stable `ValidationSpec.id` (e.g.
`'retail-foundations-checkpoint'`) — **never** a generated `TestCell.id`.
Every built-in lesson's initializer creates the matching `TestCell` as part
of its starting notebook state; the Learning System locates it at runtime by
scanning `notebook.cells` for a `TestCell` whose `validation.id` matches the
stage's `checkpointValidationId` (`useLessonWorkspace.ts`). A stage with no
`checkpointValidationId` is guidance-only and completes simply by being
reached; it carries no scored truth of its own.

### `LessonHint` / `LessonSolution`

```ts
interface LessonHint { id: string; text: string }

interface LessonSolution {
  explanation: string
  keyPoints?: string[]
  exampleExpressions?: string[]
}
```

A `LessonSolution` is explanatory content only. Revealing it never mutates
the learner's model or notebook — see "Solution reveal" below.

## Built-in lesson registry

`src/data/lessons/lessonRegistry.ts` is the canonical, code-owned list of
built-in lessons:

```ts
export function listBuiltInLessons(): BuiltInLesson[]
export function getBuiltInLesson(lessonId: string): BuiltInLesson | undefined
```

It throws at import time if two lessons share an `id` — a load-bearing
invariant covered by `tests/data/lessons/lessonRegistry.test.ts`.

This is deliberately code, not data: **no JSON lesson bundle format, no
import/export format, no lesson DSL, no generic authoring UI, no remote
registry.** That belongs to the future Authoring phase (ROADMAP.md Phase
10) — see "Future authoring boundary" below.

## Lesson bootstrap boundary

```ts
interface BuiltInLesson {
  definition: LessonDefinition
  initialize(): LessonInitialState
}

interface LessonInitialState {
  notebook: NotebookDocument
  datasets: Record<string, Dataset>
  models: Record<string, SemanticModel>
  queries?: Record<string, QueryDefinition>
}
```

`initialize()` mints fresh runtime ids every call (`generateId()`,
`crypto.randomUUID()`) by driving a fresh `NotebookRuntime` instance through
its real public API — `importDataset`, `createModelCell`,
`addTableToModel`, `createRelationship`, `createCalculatedColumnCell`,
`createMeasureCell`, `createTestCell`, `markDateTable` — never a parallel,
hand-rolled data structure. `src/data/lessons/support/retailModelBuilder.ts`
holds the shared Retail-specific steps (`buildRetailNotebookBase`,
`connectRetailStarSchema`, `addRetailFoundationsSolution`,
`markRetailCalendarDateTable`) that each built-in Retail lesson composes
differently:

| Lesson | Starting state |
|---|---|
| Retail Foundations | 4 datasets imported, an empty model with all 4 tables added, **no** relationships/calculations yet |
| Filter Context & CALCULATE | The *completed* Retail Foundations solution (relationships + Margin + the 4 base measures already exist) |
| Time Intelligence | The completed Retail Foundations solution **plus** Calendar already marked as a Date Table |

`LessonDefinition` itself stores none of these ids — only `initialize()`'s
*output* (a fresh `NotebookDocument` + datasets/models) is ever persisted.
Factory functions themselves are never persisted.

## Lesson session

```ts
type LessonSessionStatus = 'not-started' | 'in-progress' | 'completed'

interface LessonSession {
  id: string
  lessonId: string
  lessonVersion: number
  notebookId: string
  status: LessonSessionStatus
  startedAt: string
  updatedAt: string
  completedAt?: string
  currentStageId?: string
  revealedHints: Record<string, string[]>
  revealedSolutionStageIds?: string[]
}
```

A session is "Raul's current attempt at this lesson" — mutable, and
entirely separate from the immutable `LessonDefinition`. `src/runtime/
learning/lessonSession.ts` holds the pure, framework-free functions that
create and evolve one: `createLessonSession`, `setCurrentStage`,
`revealNextHint`, `markSolutionRevealed`, `completeLessonSession`,
`countRevealedHints`.

There is exactly one active `LessonSession` per lesson at a time
(`persistence/learningStore.ts` keys the session store by `lessonId`),
mirroring the simplicity of the Free Lab's single active notebook
(`notebookStore.ts`).

## Lesson attempt (historical record)

```ts
interface LessonAttempt {
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
```

A `LessonAttempt` is a record of what happened at a point in time. **It is
never treated as proof that the current notebook is still valid** — that
question is always answered fresh by `runValidation()`. `src/runtime/
learning/lessonProgress.ts` holds the pure aggregation functions:
`createLessonAttemptFromValidationRun`, `summarizeLessonProgress`,
`summarizeAllLessonProgress`, `computeLearnerProgressTotals`.

## Lesson versioning

Every lesson definition carries a `version`. `summarizeLessonProgress`
(and every completion/best-score computation) filters attempts by an
**exact** `(lessonId, lessonVersion)` match. If `retail-foundations` becomes
version 2, a version-1 attempt:

- remains in history, untouched (`LessonAttempt` records are immutable —
  nothing ever rewrites one after the fact);
- never counts toward version 2's attempt count, best score, or completion
  state.

This prevents a future content edit from silently crediting (or
discrediting) a learner for a lesson they never actually completed in its
current form.

## Validation integration — current truth vs. historical progress

```text
Lesson System
      ↓
existing TestCell
      ↓
runValidation()
      ↓
existing Validation Engine
```

`useLessonWorkspace.checkCheckpoint()` calls `runValidation({ datasets,
models }, checkpointTestCell)` exactly like `NotebookWorkspace` does for the
Free Lab — the Learning System implements **zero** scoring logic of its own.
A stage with a `checkpointValidationId` completes only when:

```ts
isStageComplete(stage, run, isStale) // src/runtime/learning/lessonProgress.ts
// → run !== undefined && !isStale && run.passed
```

`isStale` comes from the pre-existing `isValidationRunStale()`
(`runtime/validation/fingerprint.ts`) — the same fingerprint mechanism the
Free Lab uses. If the semantic state changes after a PASS, the stage is
never shown as complete again until the checkpoint is re-run and re-passes.

**`ValidationRun` is never persisted** — Sprint 5's invariant
(docs/VALIDATION_ENGINE.md "Persistence boundaries") is preserved exactly.
`useLessonWorkspace` keeps `validationRuns` as in-memory React state only
(mirroring `NotebookWorkspace`'s own `validationRuns` state), so a reload
always starts with *no* current run — the UI correctly shows "Checkpoint
needs to be checked again" until the learner clicks "Check progress", even
if they passed with 100% in a previous browser session.

A `LessonAttempt`, by contrast, **is** persisted, and represents:

```text
Attempt 2
Score: 90/100
Completed: 2026-03-14
```

clearly as *historical* fact — never re-displayed as if it were today's
live validation state.

## Hints

Authored, deterministic, revealed progressively —
`revealNextHint(session, stage)` reveals exactly the next hint in
`stage.hints` order and is a no-op once every hint for that stage has been
revealed. Revealed-hint ids are tracked per stage
(`LessonSession.revealedHints: Record<stageId, hintId[]>`) and persisted, so
a reload keeps the same hints visible. There is no AI tutor and no
LLM-generated hint content (out of scope).

## Solution reveal

`LessonDefinition.solution` is educational content (an explanation, key
points, example expressions) shown on demand by the UI
(`LessonWorkspace`'s "Reveal solution" toggle). It is read-only — revealing
it never calls into `NotebookRuntime` or otherwise mutates the learner's
model. `LessonSession.revealedSolutionStageIds` records that it was viewed,
for analytics only.

## Reset vs. new attempt

Both "Reset lesson" and "Start new attempt" are the same operation at the
runtime layer (`useLessonWorkspace`'s `resetLesson`/`startNewAttempt`, both
aliasing `clearPersistedAttempt`): delete this lesson's persisted notebook
and session (`persistence/learningStore.ts`'s `deleteLessonNotebook` /
`deleteLessonSession`), and delete the dataset/model records the *current*
notebook referenced (so re-initializing doesn't leak IndexedDB rows). The
caller (`LessonWorkspace` component) then bumps a remount key, which
re-mounts the inner workspace, giving `useNotebookRuntime` a fresh instance
whose hydration effect finds nothing persisted and re-runs
`lesson.initialize()` from scratch.

**Attempt history is never touched by either action** — only the *current*
session/notebook state is cleared. The distinction between the two actions
is purely about *when* a learner invokes them (mid-lesson vs. after already
completing it) and what label the UI shows; the effect on persisted state is
identical.

## Persistence boundary

`src/persistence/learningStore.ts` persists exactly:

```text
LessonSession   (one per lesson, keyed by lessonId)
LessonAttempt[] (one array per lesson, keyed by lessonId)
NotebookDocument (one per lesson, keyed by lessonId — structure/cell order only)
```

It never persists:

```text
live ValidationRun
query evaluation output
measure/calculated-column execution output
visual execution output
context traces
```

Those remain recomputed runtime data, exactly as Sprint 1–12 established.
Datasets and models referenced by a lesson's notebook reuse the *existing*
`persistence/notebookStore.ts` (dataset store) and `persistence/
modelStore.ts` — both already keyed by their own generated ids rather than
by notebook, so no new dataset/model persistence mechanism was needed.

## Free Lab boundary

The Free Lab (`src/components/NotebookWorkspace.tsx`) is unchanged in
behavior — it still calls `useNotebookRuntime()` with no arguments, which
defaults to the exact same fixed-key `notebookStore.ts` persistence it
always used. `useNotebookRuntime` was extended (not replaced) with an
optional `{ persistence, createInitialSnapshot }` pair so a lesson can
supply its own lesson-scoped adapter
(`persistence/learningStore.ts#loadLessonNotebook`/`saveLessonNotebook`)
and its own bootstrap (`lesson.initialize`) — see
`src/runtime/notebook/useNotebookRuntime.ts`. A lesson's notebook and the
Free Lab's notebook can never collide, because they are stored under
different keys entirely.

## App-level routing

```ts
type AppView = 'notebook' | 'exercises' | 'progress'
```

`App.tsx` holds this one piece of view state (plus which lesson, if any, is
open) and renders exactly one of `NotebookWorkspace` /
(`LessonCatalog` or `LessonWorkspace`) / `ProgressDashboard`. No routing
library — three local views don't warrant one.

## Future authoring boundary

Sprint 13 deliberately does **not** build:

- a lesson-authoring UI;
- a JSON/YAML lesson bundle import/export format;
- a generic lesson DSL;
- a remote lesson registry.

Every built-in lesson today is a hand-written `.ts` file under
`src/data/lessons/`. That's the intended boundary until ROADMAP.md Phase 10
("Authoring") is scoped — see AGENTS.md and PRODUCT.md for the same
guardrail stated at the product level.

## Why no Power Query lesson yet

Sprint 12 provides Power Query execution and validation staleness (a
row-only edit correctly invalidates a PASS via
`Dataset.source.revision`/`queryFingerprint.ts`), but its validation
coverage flows through downstream model/measure outputs, not a direct
"grade this Applied Step sequence" contract. Building a clean Power Query
lesson would need either a new validation rule type (e.g. "assert Applied
Step shape/output schema") or fragile UI-specific checks. Rather than force
a lesson through a validation contract that doesn't fit cleanly, Sprint 13
ships zero Power Query lessons and documents this as a follow-up
(ROADMAP.md "Later, only if validated") for a future sprint to design a
proper query-validation rule if/when a Power Query lesson is prioritized.

## Testing

- `tests/domain/` — none needed; `domain/learning.ts` is types only.
- `tests/data/lessons/lessonRegistry.test.ts` — registry uniqueness,
  lookup, per-lesson stage/checkpoint invariants.
- `tests/data/lessons/lessonBootstrap.test.ts` — each built-in lesson's
  `initialize()` produces the expected starting shape and does not pass its
  own checkpoint untouched.
- `tests/runtime/learning/lessonSession.test.ts` — hint reveal ordering,
  idempotent solution-reveal/stage-set, session creation.
- `tests/runtime/learning/lessonProgress.test.ts` — stage/lesson
  completion (including the stale-run and required-checkpoint cases), best
  score across multiple attempts, version isolation, progress totals.
- `tests/persistence/learningStore.test.ts` — round-trips for lesson
  notebook/session/attempt persistence, immutable attempt history.
- `tests/runtime/learning/lessonIntegration.test.ts` — full headless
  scenarios for all three built-in lessons: initial state fails its own
  checkpoint, then scores exactly 100/100 once the intended solution is
  built through the real runtime. These are also the tests that prove this
  sprint's two new checkpoint fixtures
  (`data/exercises/filterContextValidation.ts`,
  `data/exercises/timeIntelligenceValidation.ts`) have correct,
  independently hand-computed expected values.
