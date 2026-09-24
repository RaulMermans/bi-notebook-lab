# AGENTS.md

## Mission

Build a notebook-based BI learning environment, not a Power BI clone.

## Non-negotiable product direction

The notebook is the primary interface and unit of work.

A learner progresses through executable cells that expose data modeling and analytical semantics.

## Engineering guardrails

1. Keep BI semantics outside React components.
2. Prefer pure deterministic functions for model/expression logic.
3. Every execution result should be testable headlessly.
4. Validation must compare meaning/results, not only raw expression strings.
5. Do not add enterprise BI features unless a roadmap phase explicitly requires them.
6. Do not build visual polish before runtime correctness.
7. New cell types require a domain contract and execution contract first.
8. Lessons must be portable data/config, not hardcoded UI flows. Sprint 13
   satisfies this with plain `LessonDefinition` TypeScript objects (data)
   consumed by one generic `LessonWorkspace` component (config-driven UI) —
   not a JSON/DSL bundle format, which is deliberately deferred to the
   future Authoring phase (see docs/LEARNING_SYSTEM.md "Future authoring
   boundary").

## Current supported scope

The "Initial supported scope" below described the Sprint 1–2 starting point.
Sprints 3–15 have since shipped well past it — calculated columns, measures,
CALCULATE, iterators/table expressions, classic time intelligence, advanced
relationships (USERELATIONSHIP/CROSSFILTER), a Power Query transformation
layer (Sprint 12, see docs/POWER_QUERY_RUNTIME.md), a lesson-based
Learning System (Sprint 13, see docs/LEARNING_SYSTEM.md), advanced
Applied Steps plus Direct Query Validation and multi-checkpoint lessons
(Sprint 14, see docs/APPLIED_STEPS.md, docs/QUERY_VALIDATION.md and
docs/LEARNING_SYSTEM.md), and workspace referential integrity plus the rest
of the essential DAX subset (Sprint 15, see docs/WORKSPACE_INTEGRITY.md,
docs/EXPRESSION_ENGINE.md and docs/SEMANTIC_CONFORMANCE.md) all exist
in-repo. Treat this list as scope history, not a current restriction —
check ROADMAP.md for what has actually shipped before assuming something is
out of scope.

Delivered:

- local datasets
- one-to-many, one-to-one, many-to-many and bidirectional relationships
- calculated columns
- measures, including CALCULATE, iterators, and classic time intelligence
- row/filter context
- validation, including staleness tracking
- explanation traces
- Power Query: typed Applied Steps, query dependency graph, Merge/Append
  (Sprint 12); Pivot Column, Unpivot Columns, Conditional Column, Index
  Column and Custom Column — the last backed by a bounded, non-M scalar
  expression subsystem (lexer/parser/binder/evaluator, never `eval`) — round
  out the Applied Steps set to nineteen kinds (Sprint 14, see
  docs/APPLIED_STEPS.md and docs/POWER_QUERY_EXPRESSIONS.md)
- Direct Query Validation: `TestCell.scope` (`model` or `workspace`) and six
  `ValidationRule` types that grade a Power Query output directly — no
  Semantic Model required (Sprint 14, see docs/QUERY_VALIDATION.md)
- Learning System: lesson catalog, guided stages, progressive hints, solution
  reveal, reset/new-attempt, versioned historical progress (Sprint 13, three
  built-in lessons), generalized to any number of independent per-lesson
  checkpoints and a 4th built-in lesson graded purely through Direct Query
  Validation (Sprint 14 — see docs/LEARNING_SYSTEM.md)
- Workspace Referential Integrity: every destructive `NotebookRuntime`
  mutation (delete model/dataset/query/measure/calculated column, disable a
  query's load, remove a model table) enforces a RESTRICT/CASCADE policy
  internally before mutating, guaranteeing no cell/model object/query can
  ever point at a deleted id (Sprint 15, see docs/WORKSPACE_INTEGRITY.md)
- Essential DAX closure: `VAR`/`RETURN` (scalar-only, correct lexical
  scoping), `ISBLANK`, `HASONEVALUE`, and a bounded
  `KEEPFILTERS(Table[Column] = value)` (Sprint 15, see
  docs/EXPRESSION_ENGINE.md "Variables (VAR/RETURN)", docs/MEASURES.md and
  docs/CALCULATE.md)
- Semantic Conformance Suite: 83 hand-verified DAX cases across 10 families,
  run through the real public runtime APIs, honestly labeled by provenance
  (no `power-bi-verified` claims yet) and with one documented known
  divergence (Sprint 15, see docs/SEMANTIC_CONFORMANCE.md; `npm run
  conformance`)

Still avoid (no roadmap phase has required these):

- an arbitrary Power Query M parser/interpreter or query folding (Sprint 12
  implements Power Query's transformation workflow through typed steps only,
  and Sprint 14's Custom Column expression subsystem is a small bounded
  scalar grammar of its own, not M — see docs/POWER_QUERY_RUNTIME.md
  "M-language boundary" and docs/POWER_QUERY_EXPRESSIONS.md)
- a lesson-authoring UI, a JSON/DSL lesson bundle format, or a remote lesson
  registry (every built-in lesson, including Sprint 14's 4th one, is
  code-owned TypeScript — see docs/LEARNING_SYSTEM.md "Future authoring
  boundary"; this is ROADMAP.md Phase 10, not yet started)
- Calculated Tables / CALENDAR/CALENDARAUTO / SELECTCOLUMNS/ADDCOLUMNS/
  SUMMARIZE (evaluated as a Sprint 14 candidate and deliberately deferred —
  see ROADMAP.md "Recommended Sprint 16")
- table-valued VAR, CALCULATETABLE, and full DAX blank-coercion semantics
  beyond what's implemented (Sprint 15 deliberately scoped VAR to
  scalar-only and left arithmetic's uniform blank-propagation behavior
  alone rather than replicating DAX's per-operator coercion table — see
  docs/EXPRESSION_ENGINE.md and docs/SEMANTIC_CONFORMANCE.md's `blank-008`
  known divergence)
- Power BI Service/Fabric
- deployment infrastructure
- authentication
- billing
- collaboration

## Definition of done for a sprint

A sprint is not complete until:

- types/contracts are updated;
- behavior has automated tests where practical;
- README/docs remain aligned;
- no feature logic is trapped inside presentation components;
- the next developer can understand the state from repository documentation.
