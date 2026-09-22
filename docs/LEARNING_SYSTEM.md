# Learning System (Sprint 13)

```text
BI execution environment
        ↓
BI learning environment
```

Sprints 1–12 built an engine capable of teaching substantial Power BI
workflows. Sprint 13 does not add any DAX, Power Query, or model-object
capability — it organizes what already exists into a repeatable loop:

Sprint 14 extends this loop in two ways: a lesson can define more than one
independent checkpoint (see "Multi-checkpoint lessons" below), and a
checkpoint can grade Power Query state directly, with no Semantic Model
involved at all (Direct Query Validation — see
[`docs/QUERY_VALIDATION.md`](./QUERY_VALIDATION.md)). Neither change alters
the loop itself:

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
| Power Query — Cleaning & Reshaping Data (Sprint 14) | 5 datasets imported (the Sprint 12 Power Query Lab set + a new `Monthly_Targets_Wide` fixture), 4 empty (zero-step) query cells, **no model at all** — every checkpoint is workspace-scoped |

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
`createLessonAttemptFromCheckpointRuns`, `summarizeLessonProgress`,
`summarizeAllLessonProgress`, `computeLearnerProgressTotals`.

**Sprint 14**: `createLessonAttemptFromCheckpointRuns` (renamed from
`createLessonAttemptFromValidationRun`) takes every checkpoint's
`ValidationRun`, not just one — `pointsEarned`/`pointsPossible` are summed
across all of them, `passed` requires every run to have passed, and one
composite `validationFingerprint` is a hash over every run's own
`{testCellId, fingerprint}`, sorted by `testCellId`. A single-checkpoint
lesson (every Sprint 13 built-in) is simply the one-run case of the same
function.

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

`useLessonWorkspace.checkCheckpoint(stageId)` calls `runValidation({
datasets, models, queries, queryEvaluations }, testCell)` for the one
`TestCell` belonging to `stageId`, exactly like `NotebookWorkspace` does for
the Free Lab — the Learning System implements **zero** scoring logic of its
own. A stage with a `checkpointValidationId` completes only when:

```ts
isStageComplete(stage, run, isStale) // src/runtime/learning/lessonProgress.ts
// → run !== undefined && !isStale && run.passed
```

`isStale` comes from the pre-existing `isValidationRunStale()`
(`runtime/validation/fingerprint.ts`) — the same fingerprint mechanism the
Free Lab uses. If the semantic state changes after a PASS, the stage is
never shown as complete again until the checkpoint is re-run and re-passes.

### Multi-checkpoint lessons (Sprint 14)

Through Sprint 13, `isStageComplete` was checked against exactly one
`checkpointStage`/`run`/`isStale` triple, because every built-in lesson
defined exactly one checkpoint. Sprint 14 generalizes this: a lesson may
define any number of independent checkpoint stages, so
`useLessonWorkspace` now keeps everything keyed by
`LessonStage.checkpointValidationId` instead of a single value:

```ts
checkpointTestCellsByValidationId: Record<string, TestCell | undefined>
checkpointRunsByValidationId: Record<string, ValidationRun | undefined>
checkpointStaleByValidationId: Record<string, boolean>
```

```ts
isLessonComplete(stages, runsByValidationId, staleByValidationId) // lessonProgress.ts
// → every checkpoint stage's own map entry satisfies isStageComplete
```

`checkCheckpoint(stageId: string)` (previously a zero-argument function,
since there was only ever one checkpoint to check) resolves `stageId` to its
own `checkpointValidationId` and `TestCell`, runs validation for *that
checkpoint only*, and updates only its own entry in the maps — checking one
checkpoint never re-runs or invalidates another. A single-checkpoint lesson
(every Sprint 13 built-in) is simply the one-entry case of the same maps;
no special-casing was needed to keep them working.

A `LessonAttempt` is still recorded exactly once per completion — on the
specific `checkCheckpoint` call whose result flips the lesson from
incomplete to complete, never on a checkpoint that was already passing.
`wasComplete`/`isCompleteNow` are computed synchronously inside the same
callback, from the pre-update and post-update run maps, which sidesteps two
failure modes a naive React-effect-based approach would risk: depending on
effect-scheduling timing, and double-recording an attempt when an
already-passing checkpoint is re-checked and re-passes.

`components/learning/LessonWorkspace.tsx` mirrors the same generalization:
it reads the *current* stage's own checkpoint run/stale from the maps
(rather than a single shared value), and a new `handleRunValidation(cellId)`
routes a "Run"/"Check solution" click on any `TestCellCard` in the notebook
to the correct stage's `checkCheckpoint(stage.id)` by finding which stage
owns that cell's `validation.id` — previously this always called the single
zero-argument `checkCheckpoint()`, which only "worked" because every
Sprint 13 lesson had exactly one `TestCell`.

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

## The Power Query lesson (Sprint 14)

Sprint 13 shipped zero Power Query lessons and documented why: Sprint 12's
Power Query validation coverage flowed only through downstream model/measure
outputs, not a direct "grade this Applied Step sequence" contract, and
forcing a lesson through a validation contract that didn't fit cleanly
would have meant either a new rule type or fragile UI-specific checks. That
follow-up is exactly what Sprint 14 built: Direct Query Validation (six new
`ValidationRule` types over a query's evaluated output — see
[`docs/QUERY_VALIDATION.md`](./QUERY_VALIDATION.md)) plus a `TestCell.scope`
that no longer requires a model at all.

`power-query-cleaning-reshaping` ("Power Query — Cleaning & Reshaping
Data", `src/data/lessons/powerQueryLesson.ts`) is the lesson that contract
unlocked: intermediate difficulty, 5 stages, 4 independent
`{ kind: 'workspace' }`-scoped checkpoints (stages 2–5), and **no Semantic
Model anywhere in the lesson** — the first built-in lesson graded purely on
Power Query state. It reuses the Sprint 12 Power Query Lab dataset
(`Customers_Dirty`, `Sales_Jan`/`Sales_Feb`, `Products`) plus a new
dedicated `Monthly_Targets_Wide` fixture
(`src/lib/sample/generateMonthlyTargetsDataset.ts`) added specifically to
make Unpivot Columns pedagogically obvious (all 12 target values are
distinct by design, so a later checkpoint can identify a row by its
`Target` value alone). Its four query cells all start with
`loadEnabled: false` explicitly — a `NewQueryDefinition` otherwise defaults
to `loadEnabled: true`, which would have made the final "Enable Load"
checkpoint trivially pass from the start; this was a real bug found and
fixed during manual verification.

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
  scenarios for the three Sprint 13 built-in lessons: initial state fails
  its own checkpoint, then scores exactly 100/100 once the intended
  solution is built through the real runtime. These are also the tests that
  prove this sprint's two new checkpoint fixtures
  (`data/exercises/filterContextValidation.ts`,
  `data/exercises/timeIntelligenceValidation.ts`) have correct,
  independently hand-computed expected values.
- `tests/runtime/learning/powerQueryLessonIntegration.test.ts` (Sprint 14) —
  the same style of full headless proof for `power-query-cleaning-reshaping`:
  initial state fails every checkpoint, each of the 4 checkpoints completes
  independently (never sequentially — proven by completing them out of
  order), and the lesson records exactly one `LessonAttempt` at 400/400. It
  drives the real `NotebookRuntime` + `ValidationEngine` + Learning System
  throughout, never constructing a `QueryEvaluation` directly.
- `tests/runtime/learning/lessonProgress.test.ts` extended (Sprint 14) with
  multi-checkpoint `isLessonComplete`/`createLessonAttemptFromCheckpointRuns`
  scenarios (partial completion across several checkpoints, out-of-order
  completion, composite fingerprint hashing).
- `tests/data/lessons/lessonBootstrap.test.ts` / `lessonRegistry.test.ts`
  extended (Sprint 14) for the 4th lesson's starting-state shape and
  registry membership.
