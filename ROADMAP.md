# Roadmap

## Phase 0 — Product Foundation

**Goal:** freeze the product concept before building complexity.

- notebook/cell contracts
- lesson format
- semantic-model contracts
- execution result contracts
- validation philosophy
- sample lesson
- minimal notebook UI shell

**Exit:** repository expresses one coherent product direction.

---

## Phase 1 — Data Runtime ✅ complete

- CSV import
- XLSX import (multi-sheet)
- schema/type inference
- null/duplicate inspection (profiling)
- table preview
- grain/key hints (potential-key detection)
- bundled lesson dataset (built-in Retail sample: Customers/Products/Sales/Calendar)
- local persistence (IndexedDB) across reloads

**Exit:** DataCell can load, inspect and persist tables. See
[`docs/DATA_RUNTIME.md`](./docs/DATA_RUNTIME.md) for implementation details.

---

## Phase 2 — Model Runtime ✅ complete

- semantic model state (`SemanticModel`, stable dataset/table/column refs)
- create/delete relationships, one-to-many only
- relationship validation: type compatibility, one-side uniqueness (against
  real row data), duplicate/self-relationship rejection, unmatched-foreign-key
  warnings with match rate
- active/inactive relationship state
- graph diagnostics: cycles and ambiguous active paths, isolated tables
- topology-based fact/dimension inference and star-schema health check
- model canvas (React Flow) with draggable table positions
- persistence across reloads (IndexedDB `models` store)

**Exit:** ModelCell can build and validate a usable semantic model. See
[`docs/MODEL_RUNTIME.md`](./docs/MODEL_RUNTIME.md) for implementation
details.

---

## Phase 3 — Calculated Columns ✅ complete

- reusable expression engine: parser → AST → binder → evaluator → execution
  trace, with structured diagnostics (no `eval`/`new Function`)
- row-level expression evaluator with an explicit `RowContext`
- arithmetic (`+ - * /`, unary `-`, parentheses, operator precedence)
- field references (`Table[Column]` / `[Column]`), scoped to the
  calculated column's own table — direct cross-table references are
  rejected in favor of `RELATED`
- `RELATED(Table[Column])` through active, unambiguous many→one
  relationships, with an indexed one-side lookup (O(n), not O(n·m))
- preview computed values (first ~100 rows, recomputed from live model
  state, never persisted)
- row-context visualization driven by the runtime's own execution trace
- calculated columns persist inside `SemanticModel` and appear on the
  model canvas with an `fx` badge

**Exit:** learner can create and debug calculated columns. See
[`docs/EXPRESSION_ENGINE.md`](./docs/EXPRESSION_ENGINE.md) and
[`docs/CALCULATED_COLUMNS.md`](./docs/CALCULATED_COLUMNS.md) for
implementation details.

---

## Phase 4 — Measures ✅ complete

- measure registry (`SemanticModel.measures`, `MeasureCell`), reusing the
  Sprint 3 parser/AST via a second binder (`bindMeasureExpression`)
- aggregation functions: `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`,
  `COUNTROWS`, `DISTINCTCOUNT`, `DIVIDE`
- measure references (`[Measure Name]`) with dependency-graph cycle
  detection (shared with the relationship-graph cycle check)
- an explicit `FilterContext` (direct equality/set filters, AND-combined)
- relationship propagation: one → many, transitive to a fixed point,
  inactive relationships skipped, fails closed on an invalid
  (`ACTIVE_CYCLE`/`AMBIGUOUS_PATH`) relationship graph
- execution trace: filter context, relationship propagation, aggregation
  and measure-reference nodes on the same `ExecutionTraceNode` shape
- `CALCULATE`/`FILTER`/time intelligence remain **out of scope** — Phase 4
  proves the measure-execution architecture those will plug into later

**Exit:** learner can create useful measures and see why they evaluate as
they do. See [`docs/MEASURES.md`](./docs/MEASURES.md) and
[`docs/FILTER_CONTEXT.md`](./docs/FILTER_CONTEXT.md) for implementation
details.

---

## Phase 5 — Validation Engine ✅ complete

- author selectors (`TableSelector`/`ColumnSelector`/`MeasureSelector`/
  `CalculatedColumnSelector`) resolved fresh against the current model —
  never generated runtime ids stored in an exercise
- structural rules: relationship (direction + active state), model-health
  (graph validity, star schema, forbidden diagnostics), table-present
- expected numeric/row results, executed through the real Sprint 3/4
  runtimes (`evaluateCalculatedColumn`/`evaluateMeasure`), never a
  reimplemented calculation
- explicit numeric tolerance (`absolute` / `relative` / `absolute-or-relative`,
  default ±0.01 absolute or ±0.000001 relative) plus exact string/boolean/
  null comparison
- multi-context measure validation — the same measure checked across several
  `FilterContext` fixtures, which is what actually catches a hardcoded
  constant (a dedicated regression test proves this)
- semantic expression checks (AST-level: uses-function, references-measure,
  references-column, not-constant-only) as a supplementary rule type
- weighted partial credit within a multi-case rule, plus required-rule
  gating of the overall PASS
- structured, separated learner feedback vs. internal evidence, with
  context-aware hints (e.g. "your base result is correct, but it doesn't
  respond to filter context")
- a staleness fingerprint so a previous PASS is never shown as current after
  a semantic edit (canvas repositioning is deliberately excluded)
- `TestCell`, a real typed notebook cell; `ValidationSpec` persists on it,
  `ValidationRun` never does
- the Retail Foundations checkpoint (100 pts across Model/Calculated
  column/Measures/Filter behavior), with a full correct solution scoring
  100/100 and an intentionally broken one scoring less, verified both in
  automated tests and manually in the running app

**Exit:** exercises can be graded automatically without exact-string
matching. See [`docs/VALIDATION_ENGINE.md`](./docs/VALIDATION_ENGINE.md) for
implementation details.

---

## Phase 6 — Context Visualizer ✅ complete

Phase 4 already shipped a minimal, per-measure version of most of this
(`MeasureCellCard`'s filter-context panel, no-filter/current-context
comparison, and trace visualizer — see `docs/FILTER_CONTEXT.md` "UI").
Sprint 6 made it a first-class, reusable surface rather than embedded editor
state:

- a standalone filter editor (`ContextFilterEditor`) reusable outside a
  single measure cell — `MeasureCellCard` and `ContextExplorer` share the
  one implementation
- a model-wide `ContextExplorer`, reachable from a `[Model] [Context
  Explorer]` tab on `ModelCellCard`, with a measure picker
- a `@xyflow/react` relationship-propagation diagram: table nodes show
  visible/total rows and a textual DIRECT/PROPAGATED/UNFILTERED/
  DIRECT+PROPAGATED state; relationship edges show `1 → *` direction and a
  textual PROPAGATED/ACTIVE·NO EFFECT/INACTIVE state with before/after
  impact when propagated
  - a table/relationship inspector (`ContextDetailsPanel`) on selection
  - a baseline-vs-current comparison (`ContextComparison`) as its own
    component, driven by two real `evaluateMeasure` calls
- a plain-English narrative with an Explanation/Step-by-step toggle
  (`ContextFlowNarrative`), generated from the same runtime data, never
  hardcoded per-exercise text
- measure dependency visualization (`MeasureDependencyTree`), reusing the
  existing `measure-reference` trace nodes
- the existing technical trace tree remains available as a toggled detail
  view; row context vs. filter context is called out explicitly
  (`RowVsFilterContextNote`)

**Exit:** hidden BI mechanics become visually understandable. See
[`docs/CONTEXT_VISUALIZER.md`](./docs/CONTEXT_VISUALIZER.md) for
implementation details.

---

## Phase 7 — Visual Cells ✅ complete

- `VisualCell`, a real typed notebook cell (promoted out of
  `GenericCellKind`), owning a `VisualSpec` (Kpi/Table/Bar/Line/Slicer)
- a Visual Runtime (`runtime/visual/*`) that executes every Visual purely
  through the existing Sprint 4 `evaluateMeasure` — grouped Visuals
  (Bar/Line/Table-with-dimension) re-evaluate the configured measure(s)
  once per distinct dimension member under a merged `FilterContext`, with
  no second aggregation or relationship-propagation engine
- `mergeFilterContexts`, the canonical `FilterContext` combinator (different
  columns AND, same column intersects) that lets a grouped Visual's own
  per-member filter combine correctly with the shared notebook/slicer
  context
- a shared, transient `NotebookVisualContext`: every KPI/Table/Bar/Line
  reads it, every Slicer writes to it (own filter only — clearing one
  Slicer never touches another's), multiple Slicers combine with AND
  semantics, and it always resets to "All" on reload while Visual field
  mappings persist
- table/bar/line/KPI/slicer creation and editing UI (`AddVisualCellPanel`,
  `VisualCellCard`, one shared `VisualFieldsForm` for both), reusing Recharts
  for Bar/Line and real semantic `<table>`/radio/checkbox markup elsewhere
- cardinality limits (bar 30 / line 100 / table 100 / slicer 200) with an
  explicit "Showing top N of M" notice, deterministic sorting (blanks
  always last), and explicit `(Blank)` dimension members
- structured `VisualDiagnostic`s (`VISUAL_MEASURE_NOT_FOUND`,
  `VISUAL_COLUMN_NOT_FOUND`, `VISUAL_FILTER_GRAPH_INVALID`, …) so a deleted
  measure/column fails a Visual safely — verified manually across
  KPI/Bar/Line/Table with zero console errors
- verified end-to-end against the built-in Retail sample (KPI/Bar/Line/Table
  + Country/Category Slicers), including relationship active/inactive
  recovery and exact-value agreement with the Sprint 6 Context Explorer

**Exit:** learners can verify model/measure behavior through simple visuals.
See [`docs/VISUAL_CELLS.md`](./docs/VISUAL_CELLS.md) for implementation
details.

---

## Phase 8 — CALCULATE & Filter Context Modification ✅ complete

- comparison (`= <> > >= < <=`) and logical (`&&`/`\|\|`) operators added to
  the shared expression grammar as a pure addition (new AST node kinds,
  correct precedence, zero change to existing arithmetic parsing) — no
  CALCULATE-specific parser grammar
- `CALCULATE(expression, filter1, filter2, ...)` in measure context:
  boolean filter arguments, `REMOVEFILTERS`/`ALL` as filter modifiers, and
  `FILTER(Table, predicate)` producing a real row-subset that propagates
  through relationships via the unmodified Sprint 4 propagation loop
- a dedicated context-modification layer (`contextModifier.ts`) with
  **replacement** semantics on the same column — deliberately separate from
  Sprint 7's intersection-based `mergeFilterContexts` — so a same-column
  `CALCULATE` filter genuinely overrides the incoming context (`Spain
  Revenue` still shows Spain under an external France slicer) while
  unrelated filters on other columns/tables keep applying
- a context-safe, per-`CALCULATE`-scope measure-reference cache, so a
  measure evaluated under two different contexts in the same evaluation
  never returns the wrong context's cached value
- nested `CALCULATE` composes naturally (it's just another bound expression
  node); `CALCULATE` inside a calculated column is rejected with a
  dedicated, documented `CALCULATE_CONTEXT_TRANSITION_NOT_SUPPORTED`
  diagnostic rather than a fake partial implementation
- five new execution-trace node kinds rendered through the *existing*
  generic trace-tree component with no UI changes; the Context Explorer
  surfaces a top-level `CALCULATE` measure's internal modification instead
  of the external filter context, distinctly (never hidden)
- zero visual-specific or validation-specific `CALCULATE` code: every
  `KPI`/`Table`/`Bar`/`Line`/`Slicer` and the numeric-result validation rule
  picked it up automatically through the unmodified `evaluateMeasure`
- verified end-to-end against the built-in Retail sample (`Spain Revenue`,
  `Revenue All Countries`, `Revenue % All Countries`, `All Product Revenue`,
  a `FILTER` measure over a real `Products[UnitPrice]` column)

**Exit:** learners can manipulate filter context deliberately, the single
most important conceptual step toward real Power BI Desktop proficiency. See
[`docs/CALCULATE.md`](./docs/CALCULATE.md) for implementation details,
architecture, and known DAX compatibility limitations.

---

## Phase 8.5 — Advanced DAX: Iterators, Table Expressions & Conditional Logic ✅ complete

> Referred to as "Sprint 9" in its own implementation brief — a separate
> numbering from this roadmap's Phases (Phase 9 below is "Learning System,"
> not this work). Both numbers point at the same shipped feature set.

- a canonical `BoundTableExpression` abstraction (`runtime/tableExpression/`)
  that a bare model table, `FILTER`, `VALUES` and `DISTINCT` all bind to, and
  one evaluator every consumer shares
- `FILTER` became a reusable table-expression primitive: CALCULATE's own
  `FILTER` modifier now evaluates through the same code path a standalone
  `SUMX(FILTER(...), ...)` uses — refactored, not duplicated, with every
  Sprint 8 CALCULATE/FILTER test still passing
- `VALUES(Column)`/`DISTINCT(Column)` as one-column table expressions,
  respecting the current FilterContext, with real blanks retained and no
  synthesized unknown-member row (a documented compatibility boundary)
- `COUNTROWS` generalized to accept any table expression, not just a bare
  table
- `SUMX`/`AVERAGEX`/`MINX`/`MAXX`/`COUNTX` — real row-iterating DAX, with a
  genuine per-row Row Context (physical + calculated columns, `RELATED`),
  parsed/bound once and evaluated in O(n)
- the implicit context transition a measure reference needs inside an
  iterator's row (`SUMX(Products, [Total Revenue])`,
  `SUMX(VALUES(Products[Category]), [Total Revenue])`), with context-safe
  caching proven by a dedicated cache-leakage regression
- `IF`/`SWITCH`/`BLANK()`/`TRUE()`/`FALSE()` in measures **and** calculated
  columns; calculated columns also gained the comparison/logical operators
  Sprint 8 deliberately deferred
- `SELECTEDVALUE`, sharing its distinct-visible-values notion with `VALUES`
- zero visual-specific or validation-specific new-function code: every
  `KPI`/`Table`/`Bar`/`Line`/`Slicer` and the semantic/measure-result
  validation rules picked up every new function automatically through the
  unmodified `evaluateMeasure`
- verified end-to-end against the built-in Retail sample (`Gross Margin X`,
  `Calculated Revenue` via `RELATED`, `High Quantity Revenue` via
  `FILTER`+`SUMX`, `Average Margin per Sale`, `Selected Country`, `Revenue
  Band`/`Profitable` calculated columns)

**Exit:** the engine moved from "aggregations + filter manipulation" to "row
context + filter context + table expressions + iterators + context
transition + conditional logic" — a substantial step toward realistic Power
BI Desktop practice. See [`docs/ITERATORS.md`](./docs/ITERATORS.md) and
[`docs/TABLE_EXPRESSIONS.md`](./docs/TABLE_EXPRESSIONS.md) for implementation
details, architecture, and known DAX compatibility limitations.

---

## Phase 8.6 — Time Intelligence & Date Table Modeling ✅ complete

> Referred to as "Sprint 10" in its own implementation brief.

- `DateTableDefinition[]` on `SemanticModel` (`dateTables`) — a Date Table is
  an explicit, learner-driven marking (`markDateTable`/`unmarkDateTable`,
  `runtime/dateTable/`), never inferred, and a model may mark more than one
  (no hardcoded "the" Calendar table); legacy models hydrate with `[]`
- Classic Power BI-style Date Table validation: table/column existence,
  date/datetime type, no blanks, unique dates, contiguous day-by-day,
  consistent datetime time-of-day — structured `DateTableDiagnostic`s, never
  a raw JS error, and an invalid marking never becomes canonical model state
- Model Canvas/Model editor: a `DATE TABLE` badge on a marked table's node, a
  "Mark as Date Table" / "Unmark" control with inline validation feedback
- a canonical, timezone-safe date-math layer (`runtime/dateTable/dateMath.ts`)
  — UTC epoch-day arithmetic, Classic year/month shift with last-valid-day
  clamping (Feb 29 → Feb 28, Jan 31 - 1 month → Feb 28/29)
- `SAMEPERIODLASTYEAR`, `DATEADD` (YEAR/QUARTER/MONTH/DAY), `PREVIOUSMONTH`,
  `PREVIOUSYEAR` and `DATESYTD` as a single new `BoundTimeIntelligenceTable`
  table-expression variant (`runtime/tableExpression/`) — the same one
  dispatch every table expression already shared, not a second engine
- a new `DateTableReplace` `FilterModifier` (`runtime/measure/contextModifier.ts`):
  a Classic time-intelligence date set *replaces* the marked Date Table's
  entire current filter state rather than intersecting with it, so
  `CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))` under a
  `Year = 2025, Month = March` slicer correctly yields March 2024 — not blank
- `TOTALYTD` as measure-binder sugar for
  `CALCULATE(expression, DATESYTD(dates))`, reusing the identical bound shape
  and evaluator — proven numerically identical in tests and live in the app
- relationship propagation is untouched: a marked Date Table's filters still
  only reach a fact table through an *active* relationship, exactly like any
  other filter (verified by disabling `Calendar → Sales` and back)
- Context Explorer and the execution trace pick up `SAMEPERIODLASTYEAR`/
  `DATEADD`/etc. automatically via four new trace node kinds
  (`date-table`/`time-intelligence`/`date-shift`/`date-period`) — no second
  time-intelligence explainer was built
- a new `date-table` Validation Engine rule type, and the existing
  measure-result rule type grades YoY/YTD measures with no new rule type
  needed
- verified end-to-end against the built-in Retail sample (`Revenue LY`,
  `Revenue PM`, `Revenue YTD`/`Revenue YTD Explicit`, `Revenue YoY`/
  `Revenue YoY %`) and live in the running app via Playwright, including the
  critical Year+Month filter-replacement regression and a hard-reload
  persistence check

**Exit:** the engine now covers "row context + filter context + context
transition + CALCULATE + table expressions + iterators + date context + time
intelligence." See [`docs/DATE_TABLES.md`](./docs/DATE_TABLES.md) and
[`docs/TIME_INTELLIGENCE.md`](./docs/TIME_INTELLIGENCE.md) for implementation
details, architecture, and known DAX compatibility limitations.

---

## Phase 8.7 — Advanced Relationships & USERELATIONSHIP/CROSSFILTER ✅ complete

> Referred to as "Sprint 11" in its own implementation brief.

- `Relationship` migrated from a hardcoded `one-to-many`/single-direction
  shape to a generic one: `cardinality: 'one-to-many' | 'one-to-one' |
  'many-to-many'`, `crossFilterDirection: 'left-to-right' | 'right-to-left' |
  'both'`, `left`/`right` endpoints (no field named `one`/`many` on the
  canonical type) — legacy models hydrate to the numerically identical old
  behavior with zero learner-visible change
- a single centralized orientation module (`runtime/model/
  relationshipHelpers.ts`) every runtime file routes through instead of
  reading `.left`/`.right` and re-deriving "which side is the one/many side"
  independently
- a generic, edge-based filter-propagation engine
  (`relationshipPropagationEdges`/`propagate()`) — `1 → *`, `* → 1`, `1 ↔ 1`
  and `* → *` all reduce to the same "key membership" step, so there is no
  cardinality-specific propagation algorithm to maintain
- `ACTIVE_CYCLE` retired entirely (a legal bidirectional relationship is a
  2-node directed cycle, so simple cycle detection is the wrong tool);
  replaced by directed `AMBIGUOUS_FILTER_PATH` detection (more than one
  distinct directed propagation path between an ordered table pair), which
  never flags a legal bidirectional relationship or a directed cycle
- multiple relationships between the same table pair (role-playing
  dimensions, e.g. Order Date/Ship Date, one active) fully supported, with
  pedagogical model-wide diagnostics (`MULTIPLE_RELATIONSHIPS_BETWEEN_TABLES`,
  `ROLE_PLAYING_RELATIONSHIP_PATTERN`, `INACTIVE_RELATIONSHIP`)
- `setRelationshipActive` fails closed (clone-validate-commit,
  `{model, diagnostics}`) instead of unconditionally flipping a boolean, so
  activating a relationship can never silently introduce ambiguity
- `USERELATIONSHIP`/`CROSSFILTER` as `CALCULATE` filter modifiers, sharing
  one `RelationshipOverrideModifier` implementation: temporarily activate,
  suppress, or redirect a relationship for one calculation only, never the
  persisted model, with automatic sibling suppression so switching to
  Ship Date replaces Order Date rather than intersecting with it
- `USERELATIONSHIP`/`CROSSFILTER` compose for free with `SAMEPERIODLASTYEAR`/
  time intelligence and every Visual Cell — zero new code in either layer
- `RELATED` now supports one-to-one lookups (valid in either direction) and
  explicitly rejects many-to-many with `RELATED_UNSUPPORTED_CARDINALITY`
  (never picks an arbitrary row)
- a new `relationship-config` validation rule type for grading a
  relationship's full cardinality/direction/active configuration, alongside
  the still-supported classic 1:* `relationship` rule
- a seeded Relationship Lab sample dataset exercising every scenario (1:1,
  *:*, role-playing dates) with real data, loadable alongside the Retail
  sample
- verified end-to-end against both the Retail sample and the Relationship
  Lab dataset, including nested `CALCULATE`/`USERELATIONSHIP` scoping,
  cache-context safety, and the `USERELATIONSHIP` + `SAMEPERIODLASTYEAR`
  composition the sprint brief calls out explicitly

**Exit:** the relationship model now covers the modeling scenarios a real
Power BI learner needs — role-playing dimensions, 1:1 lookups, *:* bridge
tables, bidirectional filtering, and runtime relationship switching. See
[`docs/ADVANCED_RELATIONSHIPS.md`](./docs/ADVANCED_RELATIONSHIPS.md) and
[`docs/USERELATIONSHIP.md`](./docs/USERELATIONSHIP.md) for implementation
details, architecture, and known Power BI compatibility boundaries.

---

## Phase 8.8 — Power Query & Data Transformation Runtime ✅ complete

> Referred to as "Sprint 12" in its own implementation brief.

- a genuine pre-model transformation layer:
  `RAW SOURCE → Power Query (Applied Steps) → Semantic Model → DAX → Visuals`,
  distinct from — and never implemented by mutating — `SemanticModel`/
  `CalculatedColumn`
- `QueryDefinition` (`domain/query.ts`): persisted source + typed Applied
  Steps + a stable `outputDatasetId`/`outputTableId` that survives every
  re-evaluation, so model/relationship references never break when a step
  is edited
- a 14-member `QueryStep` discriminated union: Rename/Remove/Reorder
  Columns, Change Type, Filter Rows, Replace Values, Remove Duplicates,
  Sort Rows, Fill Down/Up, Split Column, Merge Columns, Group By, Merge
  Queries (all six join kinds, indexed hash join, multi-column typed
  composite keys), Append Queries (name-union schema, a small documented
  type-promotion lattice)
- schema-preserving steps keep every `DataColumn.id`; schema-generating
  steps (Split/Merge Columns, Group By aggregations, Merge expand columns,
  Append's schema union) get ids generated exactly once at step creation,
  never during evaluation
- a query dependency graph (`runtime/query/queryGraph.ts`) for
  query-as-source/Merge/Append references, with dependency-first evaluation
  order and fail-closed cycle/missing-dependency detection
- a deterministic query fingerprint rolled up through dependencies, folded
  into a query-sourced table's `DatasetSource.revision` and, from there,
  into the Validation Engine's fingerprint — a row-only query edit (Filter
  Rows, Replace Values, Remove Duplicates) now correctly turns a passing
  `TestCell` STALE even though the schema never changed
- a real `QueryCell` (`kind: 'query'`) with an Applied Steps UI: add /
  rename / reorder / delete a step, click any step to preview the pipeline
  as of that point, per-step row/column metrics, and a Step Failure
  Boundary that stops the pipeline at the first failure and marks every
  later step `'skipped'` rather than executing against invalid state
- `NotebookRuntime` folds every load-enabled query's output back into the
  same `datasets` map `DataCell` has always used — the Semantic Model,
  Calculated Columns, Measures, `CALCULATE`, iterators, time intelligence,
  relationships and Visual Runtime require zero Power-Query-aware code
- a seeded Power Query Lab sample (`Sales_Jan`/`Sales_Feb`/`Products`/
  `Customers_Dirty`) with real messiness — duplicate rows, dirty text
  values, a text-formatted numeric-id column, an append-compatible but
  schema-mismatched month pair, a Merge lookup table — and four
  independently-verified acceptance workflows (Clean Customers, Append
  Sales, Merge Products, Group By Category)

**Exit:** the practice environment now covers the full Power BI Desktop
workflow shape — `Power Query → Semantic Model → DAX → Visuals` — not just
the modeling/DAX half of it. See
[`docs/POWER_QUERY_RUNTIME.md`](./docs/POWER_QUERY_RUNTIME.md) and
[`docs/APPLIED_STEPS.md`](./docs/APPLIED_STEPS.md) for implementation
details, architecture, and known Power Query compatibility boundaries
(no M parser, no query folding, no fuzzy merge, no Pivot/Unpivot).

---

## Phase 9 — Learning System

- lesson catalog
- difficulty levels
- progress
- hints
- reset/checkpoint
- solution reveal
- exercise history

**Exit:** product works as a repeatable training environment.

---

## Phase 10 — Authoring

- lesson author schema
- exercise builder
- dataset packaging
- reusable validation rules
- import/export lesson bundles

**Exit:** new lessons can be created without changing product code.

---

## Later, only if validated

- **Advanced Power Query + M Fundamentals** (recommended next, now that
  Phase 8.8's Query Runtime exists) — Pivot/Unpivot, Conditional Column,
  Index Column, Custom Column, and basic/generated-M concepts, bounded to
  the same typed-step architecture (still no arbitrary M interpreter).
- **Calculated Tables & Advanced Model Objects** (the alternative Sprint 13
  candidate) — `CALENDAR`/`CALENDARAUTO`, `SELECTCOLUMNS`/`ADDCOLUMNS`,
  `SUMMARIZE`, and calculated tables built from DAX table expressions
  rather than an import/query. Reassess which gap matters more once the
  Query Runtime has seen real use.
- custom datasets
- shareable notebooks
- desktop wrapper
- AI tutor grounded in execution traces
- Power BI-flavored interview challenges
