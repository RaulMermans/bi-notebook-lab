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
Sprints 3–13 have since shipped well past it — calculated columns, measures,
CALCULATE, iterators/table expressions, classic time intelligence, advanced
relationships (USERELATIONSHIP/CROSSFILTER), a Power Query transformation
layer (Sprint 12, see docs/POWER_QUERY_RUNTIME.md), and a lesson-based
Learning System (Sprint 13, see docs/LEARNING_SYSTEM.md) all exist in-repo.
Treat this list as scope history, not a current restriction — check
ROADMAP.md for what has actually shipped before assuming something is out
of scope.

Delivered:

- local datasets
- one-to-many, one-to-one, many-to-many and bidirectional relationships
- calculated columns
- measures, including CALCULATE, iterators, and classic time intelligence
- row/filter context
- validation, including staleness tracking
- explanation traces
- Power Query: typed Applied Steps, query dependency graph, Merge/Append (Sprint 12)
- Learning System: lesson catalog, guided stages, progressive hints, solution
  reveal, reset/new-attempt, versioned historical progress (Sprint 13, three
  built-in lessons — see docs/LEARNING_SYSTEM.md)

Still avoid (no roadmap phase has required these):

- an arbitrary Power Query M parser/interpreter or query folding (Sprint 12
  implements Power Query's transformation workflow through typed steps only —
  see docs/POWER_QUERY_RUNTIME.md "M-language boundary")
- a lesson-authoring UI, a JSON/DSL lesson bundle format, or a remote lesson
  registry (Sprint 13's lessons are code-owned TypeScript — see
  docs/LEARNING_SYSTEM.md "Future authoring boundary"; this is ROADMAP.md
  Phase 10, not yet started)
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
