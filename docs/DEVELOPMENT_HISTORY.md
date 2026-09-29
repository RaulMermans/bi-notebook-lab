# Development history

> Development context: built with AI-assisted development. Product scope, architecture, acceptance criteria and verification were human-directed, and earlier commits carry the assistant's tool identity as their author.

> Moved from the README to keep the landing page focused. This is the sprint-by-sprint record of what the runtime contains.

## Repository status (as of Sprint 16)

Sprint 1 (Data Runtime), Sprint 2 (Semantic Model Runtime), Sprint 3
(Calculated Columns & Row Context), Sprint 4 (Measures & Filter Context),
Sprint 5 (Validation Engine), Sprint 6 (Context Visualizer), Sprint 7
(Visual Cells), Sprint 8 (`CALCULATE` & Filter Context Modification),
Sprint 9 (Iterators, Table Expressions & Conditional Logic), Sprint 10
(Date Tables & Classic Time Intelligence), Sprint 11 (Advanced
Relationships & `USERELATIONSHIP`/`CROSSFILTER`), Sprint 12 (Power
Query & Data Transformation Runtime), Sprint 13 (Learning System —
lesson catalog, guided stages, hints, progress), Sprint 14 (Advanced
Applied Steps, Direct Query Validation, and Multi-Checkpoint Lessons) and
Sprint 15 (Workspace Referential Integrity, Essential DAX Closure, and a
Semantic Conformance Suite) are complete — the full MVP
learning loop (import → model → calculated columns → measures → filter
context manipulation → visualize → validate) now works end to end, with real
row-iterating DAX (`SUMX`/`AVERAGEX`/`MINX`/`MAXX`/`COUNTX`), conditional
logic (`IF`/`SWITCH`), classic time intelligence, and a fully generic
relationship model on top. This repository now contains:

- product and architecture contracts
- notebook/cell domain types as a discriminated union, including functional
  `DataCell`, `ModelCell`, `CalculatedColumnCell` and `MeasureCell` kinds
- a working data import pipeline: CSV, Excel (multi-sheet), and a built-in
  sample retail dataset
- deterministic type inference and column profiling
- a semantic model runtime: generic relationships (1:1, 1:*, *:*,
  single-direction or bidirectional cross-filter, active/inactive, multiple
  relationships between the same table pair for role-playing dimensions)
  with real cardinality-aware validation (type compatibility, uniqueness,
  duplicate/self-relationship checks, unmatched-foreign-key warnings),
  directed ambiguous-filter-path diagnostics, and topology-based
  fact/dimension inference
- a visual model canvas (React Flow) that renders and repositions the model
  — the model itself, not the canvas, is the source of truth
- a reusable expression engine (parser → AST → binder → evaluator →
  execution trace) that actually executes a bounded Power BI-style scalar
  grammar row by row, including `RELATED` through active relationships,
  with structured diagnostics and a row-context visualizer
- real measures — `SUM`/`AVERAGE`/`MIN`/`MAX`/`COUNT`/`COUNTROWS`/
  `DISTINCTCOUNT`/`DIVIDE`, measure references with dependency-cycle
  detection, and aggregation over both physical and calculated columns —
  evaluated through a second binder over the *same* expression engine
- an explicit `FilterContext`: direct filters, transitive one → many
  relationship propagation with inactive relationships correctly ignored,
  and a fail-closed guard against ambiguous/cyclic relationship graphs
- a measure execution trace (filter context, relationship propagation,
  aggregation, measure references) rendered through the same trace-tree
  component as the row-context visualizer
- local persistence (IndexedDB) so a notebook, its datasets, its semantic
  models, and their calculated columns and measures all survive a reload,
  with pre-Sprint-4 models hydrating safely
- a validation engine that grades a learner's real model, calculated columns
  and measures — structural rules (relationships, model health), row/measure
  result rules executed through the actual Sprint 3/4 runtimes across
  multiple filter contexts (so a hardcoded constant measure can't pass), and
  supplementary AST-level semantic checks — with weighted partial credit,
  required-rule gating, and a staleness fingerprint so a stale PASS is never
  shown as current
- `TestCell`, a real notebook cell backed by a persisted `ValidationSpec`
  (never a persisted score), and a built-in **Retail Foundations** checkpoint
  scoring up to 100 points
- a **Context Explorer** (`[Model] [Context Explorer]` tab on a `ModelCell`):
  pick any measure and any combination of filters and see, from the real
  Sprint 4 runtime, the baseline-vs-current result, a relationship-
  propagation diagram (visible/total rows, direct vs. propagated vs.
  unfiltered, active/inactive relationship state, before/after impact), a
  plain-English narrative at two detail levels, and a measure's dependency
  chain when it references other measures
- **Visual Cells** — `KPI`, `Table`, `Bar`, `Line` and `Slicer`, each a real
  typed notebook cell backed by a Visual Runtime that executes purely
  through the same Sprint 4 `evaluateMeasure` (no second aggregation
  engine): Bar/Line/Table-with-a-dimension re-evaluate the configured
  measure(s) once per distinct member under a merged filter context; a
  Slicer emits a canonical column filter into a shared, transient notebook
  filter context that every other Visual reads, so multiple slicers combine
  with AND semantics and clearing one never touches another's filter
- **CALCULATE** — a measure can now modify its own filter context: boolean
  filter arguments (`Customers[Country] = "Spain"`, with comparison and
  logical operators), `REMOVEFILTERS`/`ALL` as filter modifiers, and
  `FILTER(Table, predicate)` producing a real row-subset that propagates
  through relationships exactly like a direct filter. Same-column filters
  **replace** the incoming context (not intersect) — `Spain Revenue` still
  returns Spain even under an external France slicer — while unrelated
  filters on other columns/tables keep applying. Nested CALCULATE composes;
  the execution trace and Context Explorer both surface the internal
  modification explicitly, and every existing visual/validation surface
  picked it up automatically through the unmodified `evaluateMeasure`.
- **Iterators & table expressions** — `SUMX`/`AVERAGEX`/`MINX`/`MAXX`/
  `COUNTX` evaluate a real expression once per row of a table expression
  (a model table, `FILTER(...)`, `VALUES(...)`, or `DISTINCT(...)`), all
  sharing one canonical `BoundTableExpression`/evaluator with `CALCULATE`'s
  own `FILTER` modifier and the now-generalized `COUNTROWS`. A measure
  reference inside an iterator's row (`SUMX(Products, [Total Revenue])`)
  gets a bounded, context-safe filter-context transition per row.
- **Conditional logic** — `IF`, `SWITCH` (including `SWITCH(TRUE(), ...)`),
  `BLANK()` and `SELECTEDVALUE` work in measures; calculated columns gained
  the comparison/logical/`IF`/`SWITCH` support Sprint 8 deliberately
  deferred (`Order Size = IF(Sales[Revenue] >= 1000, "Large", "Standard")`).

- **Date Tables & Classic time intelligence** — mark a table as a Date
  Table (with Power BI-style validation: contiguous, unique, non-blank
  dates), then write `SAMEPERIODLASTYEAR`, `DATEADD`, `PREVIOUSMONTH`,
  `PREVIOUSYEAR`, `DATESYTD` and `TOTALYTD` measures. A time-intelligence
  date set correctly *replaces* the Date Table's filters instead of
  intersecting with them, so `CALCULATE([Total Revenue],
  SAMEPERIODLASTYEAR(Calendar[Date]))` under a `Year = 2025, Month = March`
  slicer yields March 2024 — not blank.

- **Advanced Relationships & `USERELATIONSHIP`/`CROSSFILTER`** — the
  relationship model is now fully generic: 1:1, 1:*, *:*, single-direction
  or bidirectional cross-filter, multiple relationships between the same
  table pair (role-playing dimensions, e.g. Order Date/Ship Date, one
  active), and directed `AMBIGUOUS_FILTER_PATH` detection that never flags a
  legal bidirectional relationship. `USERELATIONSHIP`/`CROSSFILTER` in
  `CALCULATE` temporarily activate/suppress/redirect a relationship for one
  calculation only, composing for free with `SAMEPERIODLASTYEAR`/`DATEADD`
  and every Visual Cell. `RELATED` now also supports one-to-one lookups and
  rejects many-to-many. See
  [`docs/ADVANCED_RELATIONSHIPS.md`](./docs/ADVANCED_RELATIONSHIPS.md) and
  [`docs/USERELATIONSHIP.md`](./docs/USERELATIONSHIP.md).

- **Power Query & Data Transformation Runtime** — a real pre-model
  transformation layer. `QueryCell`/`QueryDefinition` run a typed Applied
  Steps pipeline (Rename/Remove/Reorder Columns, Change Type, Filter Rows,
  Replace Values, Remove Duplicates, Sort Rows, Fill Down/Up, Split/Merge
  Columns, Group By, Merge Queries with all six join kinds, Append Queries)
  against an immutable raw import or another query's output, with a query
  dependency graph that fails closed on cycles, stable output/column
  identity across every re-evaluation, and per-step diagnostics that never
  crash the notebook. The transformed output enters the same `Dataset`
  boundary every `DataCell` always has — the Semantic Model, Calculated
  Columns, Measures, `CALCULATE`, iterators, time intelligence,
  relationships and Visual Runtime all stay completely unaware Power Query
  exists. Editing a query's filter step recomputes downstream measures and
  visuals automatically and turns a passing `TestCell` STALE, with no model
  rebuild. See [`docs/POWER_QUERY_RUNTIME.md`](./docs/POWER_QUERY_RUNTIME.md)
  and [`docs/APPLIED_STEPS.md`](./docs/APPLIED_STEPS.md).

- **Learning System** — an `Exercises` catalog of built-in lessons
  (**Retail Foundations**, **Filter Context & CALCULATE**, **Time
  Intelligence**, **Power Query — Cleaning & Reshaping Data**), each with a
  deterministic starting notebook, guided stages with progressive hints and
  an on-demand solution, and one or more checkpoints graded by the *exact
  same* Validation Engine a hand-built `TestCell` uses — the Learning System
  adds zero new scoring logic. A lesson may define several independent
  checkpoints (Sprint 14) that complete in any order, not just one. A
  `Progress` view aggregates versioned, immutable attempt history (best
  score, attempts, completion) separately from live validation truth, which
  is still never persisted: reloading mid-lesson always requires
  re-checking every checkpoint. The Free Lab (this notebook, with no lesson
  selected) is completely unaffected — a lesson's notebook is persisted
  under its own key. See
  [`docs/LEARNING_SYSTEM.md`](./docs/LEARNING_SYSTEM.md).

- **Advanced Applied Steps & Direct Query Validation** — five more `QueryStep`
  kinds: **Pivot Column** (one row-value per distinct pivot value becomes its
  own column, with a deterministic, data-independent output-column identity
  — see `docs/POWER_QUERY_RUNTIME.md` "Pivot column identity"), **Unpivot
  Columns** (the inverse — collapse several columns into one attribute/value
  pair), **Conditional Column** (first-match-wins clauses reusing Filter
  Rows' own comparison semantics), **Index Column**, and **Custom Column** —
  a bounded, non-M scalar expression subset (`[Column]` refs, arithmetic,
  `&` text concatenation, comparisons, `if...then...else`, a small
  `Text.*`/`Number.*`/`Date.*` function set) parsed and evaluated by a real
  lexer → parser → binder → evaluator pipeline that never calls `eval`/`new
  Function`. See [`docs/APPLIED_STEPS.md`](./docs/APPLIED_STEPS.md) and
  [`docs/POWER_QUERY_EXPRESSIONS.md`](./docs/POWER_QUERY_EXPRESSIONS.md).
  Alongside this, `TestCell` gained a `scope` (`{ kind: 'model' }` or
  `{ kind: 'workspace' }`) and the Validation Engine gained **Direct Query
  Validation** — six rule types that grade a Power Query `QueryDefinition`'s
  output (existence, health, schema, row count, specific values, and which
  Applied Step kinds it uses) without requiring a Semantic Model at all. See
  [`docs/QUERY_VALIDATION.md`](./docs/QUERY_VALIDATION.md).

- **Workspace Referential Integrity** — every destructive `NotebookRuntime`
  mutation (delete dataset/model/query/measure/calculated column, disable a
  query's load, remove a model table) is now checked against a real
  RESTRICT/CASCADE policy *before* it's allowed to happen: deleting a Model
  cascades its owned cells cleanly, while deleting a Dataset/Query/Measure/
  Calculated Column that something else still depends on is blocked with a
  specific, learner-visible reason instead of silently orphaning a reference.
  `validateWorkspaceIntegrity` guarantees no cell/model object/query can ever
  point at something deleted after a successful mutation. See
  [`docs/WORKSPACE_INTEGRITY.md`](./docs/WORKSPACE_INTEGRITY.md).
- **Essential DAX Closure** — `VAR`/`RETURN` (scalar-only, correct lexical
  scoping, forward-reference rejection, works anywhere the ordinary
  expression binder reaches — not inside a `CALCULATE` filter predicate or
  an iterator's row expression), `ISBLANK`, `HASONEVALUE`, and a bounded
  `KEEPFILTERS(Table[Column] = value)` (same-column intersect instead of
  `CALCULATE`'s normal same-column replace) close out the DAX subset's most
  commonly-missing pieces. See
  [`docs/EXPRESSION_ENGINE.md`](./docs/EXPRESSION_ENGINE.md) "Variables
  (VAR/RETURN)", [`docs/MEASURES.md`](./docs/MEASURES.md) and
  [`docs/CALCULATE.md`](./docs/CALCULATE.md).
- **Semantic Conformance Suite** — 83 hand-verified DAX cases across 10
  families (scalar arithmetic, blanks, variables, aggregations, filter
  context, `CALCULATE`, iterators, relationships, time intelligence,
  advanced relationships), run through the real public runtime APIs and
  compared against independently-derived expected values, answering "is the
  supported DAX subset actually correct," not just "does the code do what
  the tests told it to." One documented known divergence (`BLANK() + 5`).
  Run with `npm run conformance`. See
  [`docs/SEMANTIC_CONFORMANCE.md`](./docs/SEMANTIC_CONFORMANCE.md).
- **V1 Practice UX, Performance & GitHub Release Readiness (Sprint 16)** —
  a portable project bundle (`.bilab.json`, export/import an entire
  workspace atomically, with stable ids and a validate-before-write
  guarantee — see [`docs/PROJECT_BUNDLE.md`](./docs/PROJECT_BUNDLE.md));
  four built-in Practice Projects and a Free Lab onboarding pass; a
  performance benchmark harness with real measurements at 1k/10k/50k/100k
  rows justifying the 100,000-row limit and the decision **not** to
  introduce Web Workers (see
  [`docs/PERFORMANCE.md`](./docs/PERFORMANCE.md)); React Flow/Recharts
  moved behind `React.lazy()` plus Rollup vendor-chunk splitting, cutting
  the main bundle from 1.15 MB to 425 kB gzip; a shared `BlockedActionNotice`
  component and a top-level error boundary; and a release-level Playwright
  E2E suite (see [`docs/E2E_TESTING.md`](./docs/E2E_TESTING.md)).

Calendar-based (Auto date/time) time intelligence, `TREATAS`, composite
models, full DAX compatibility, calculated tables, and an arbitrary Power
Query M parser/interpreter (Sprint 12/14 implement typed Applied Steps and a
bounded Custom Column expression subset, not M — see
`docs/POWER_QUERY_RUNTIME.md` "M-language boundary" and
`docs/POWER_QUERY_EXPRESSIONS.md`) remain **not** implemented — see
[`docs/ITERATORS.md`](./docs/ITERATORS.md),
[`docs/TABLE_EXPRESSIONS.md`](./docs/TABLE_EXPRESSIONS.md),
[`docs/CALCULATE.md`](./docs/CALCULATE.md),
[`docs/TIME_INTELLIGENCE.md`](./docs/TIME_INTELLIGENCE.md),
[`docs/ADVANCED_RELATIONSHIPS.md`](./docs/ADVANCED_RELATIONSHIPS.md) and
[`docs/POWER_QUERY_RUNTIME.md`](./docs/POWER_QUERY_RUNTIME.md) for the
exact scope and known limitations.
