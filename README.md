# BI Notebook Lab

A browser-based sandbox for practicing Power BI concepts without requiring Power BI Desktop.

I built it because practicing Power BI at work required access to a shared virtual desktop environment, making experimentation inconvenient. BI Notebook Lab runs entirely in the browser, is local-first (IndexedDB, no backend), and lets you build a semantic model, write DAX, transform data with Power Query, and get automatic feedback on whether your model and measures actually behave the way you think they do.

**This is not a Power BI replacement.** It implements a bounded, educational subset of Power BI's semantics — see [Semantic honesty](#semantic-honesty) below.

The core mental model is closer to Jupyter than to Power BI Desktop:

```text
Dataset → Power Query → Model → Calculated Column → Measure → Visual → Question → Test
```

Each concept is represented as an executable notebook cell. You build a solution progressively and get immediate feedback on structure, calculations and reasoning — not just whether a chart renders.

## What you can practice

- Power Query (typed Applied Steps: filter, dedupe, merge, append, pivot, unpivot, conditional/custom columns)
- Semantic modeling (star schemas, generic relationships, `USERELATIONSHIP`/`CROSSFILTER`)
- DAX (calculated columns, measures, `CALCULATE`, iterators, `VAR`/`RETURN`)
- Filter context (row vs. filter context, propagation, a visual Context Explorer)
- Classic time intelligence (`SAMEPERIODLASTYEAR`, `DATEADD`, `TOTALYTD`, ...)
- Visuals (KPI, Bar, Line, Table, Slicer) wired to the real measure runtime
- Automatic validation against a real model, not string-matching an expression
- Guided lessons (`Exercises`) with progressive hints and multi-checkpoint grading
- Semantic conformance — an independent correctness corpus, not just unit tests

## Try it

```text
Free Lab       open sandbox: start from a Practice Project, import a saved
                project, or add your own CSV/Excel data
Exercises      guided lessons with automatic checkpoint grading
Progress       your lesson history across sessions
```

A notebook can contain: `DataCell`, `QueryCell`, `ModelCell`,
`CalculatedColumnCell`, `MeasureCell`, `VisualCell`, `TestCell`, and generic
`markdown`/`question` cells. Every cell type has a domain contract and an
execution contract before it exists — see `AGENTS.md`.

## Architecture

```text
Raw Data (CSV / Excel / built-in samples)
   ↓
Power Query Runtime        (typed Applied Steps, never raw M)
   ↓
Semantic Model              (tables, relationships, calculated columns, measures)
   ↓
DAX Runtime                 (expression engine: lexer → parser → binder → evaluator)
   ↓
Filter / Relationship Engine (row context, filter context, propagation, CALCULATE)
   ↓
Visuals / Context Explorer  (KPI, Bar, Line, Table, Slicer; filter-propagation trace)
   ↓
Validation & Learning System (automatic grading, guided lessons, progress)
```

Every layer above the browser shell is pure, framework-free TypeScript —
"every execution result should be testable headlessly" is an enforced
guardrail, not a suggestion (`AGENTS.md`). React only renders state; it
never contains BI semantics. Everything runs client-side against IndexedDB
— there is no backend, no account, no telemetry.

## Feature matrix

| Area | Status |
|---|---|
| CSV / Excel import | ✓ |
| Power Query (typed Applied Steps, 19 kinds) | ✓ |
| Semantic model (generic relationships, `USERELATIONSHIP`/`CROSSFILTER`) | ✓ |
| Calculated columns | ✓ |
| Measures | ✓ |
| `CALCULATE` | ✓ |
| Iterators (`SUMX`/`AVERAGEX`/...) & table expressions | ✓ |
| `VAR`/`RETURN`, `ISBLANK`, `HASONEVALUE`, `KEEPFILTERS` | ✓ |
| Classic time intelligence | ✓ |
| Visuals (KPI/Bar/Line/Table/Slicer) | ✓ |
| Context Explorer (filter-propagation trace) | ✓ |
| Automatic validation / guided Exercises | ✓ |
| Portable project export/import (`.bilab.json`) | ✓ |
| Practice Projects & onboarding | ✓ |
| Semantic conformance suite | ✓ |
| Calculated Tables, `CALENDAR`/`CALENDARAUTO`, `SUMMARIZE` | ✗ (deferred) |
| Full DAX / full M compatibility | ✗ (bounded subset, by design) |
| PBIX/PBIP import, Fabric integration | ✗ (out of scope) |
| Accounts, collaboration, backend | ✗ (out of scope) |

## Semantic honesty

This project implements a **bounded educational subset** of Power BI
semantics — not full DAX, not full M, not a Power BI replacement. It backs
that claim with a conformance suite (`npm run conformance`): 83
hand-verified DAX cases across 10 families, run through the real runtime
APIs, honestly labeled by provenance rather than claimed as
`power-bi-verified`.

One known divergence is tracked deliberately rather than hidden: `BLANK() +
5` returns `BLANK()` here, where real DAX coerces blank to `0` for `+`. This
codebase propagates blank uniformly through every arithmetic operator
instead of replicating DAX's per-operator coercion table. See
[`docs/SEMANTIC_CONFORMANCE.md`](./docs/SEMANTIC_CONFORMANCE.md) for the
full list of what's verified and what's still approximate.

## Repository status

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

## Run locally

```bash
npm install
npm run dev
```

Open **Free Lab** and pick a card from the **Practice projects** gallery
(Retail Modeling, DAX Playground, Power Query Cleaning, or Filter Context
Lab) to start from a working example, or import a `.csv`/`.xlsx` file to
bring your own data. Use **Export project**/**Import project** at any time
to save your work as a portable `.bilab.json` file and restore it later or
on another machine — see
[`docs/PROJECT_BUNDLE.md`](./docs/PROJECT_BUNDLE.md).

Click **Load Power Query Lab Dataset** to try Power Query on deliberately
messy data (`Sales_Jan`/`Sales_Feb`/`Products`/`Customers_Dirty`). On
`Customers_Dirty`, click **Transform Data**, then use the toolbar to Rename
`customer_id` → `CustomerID`, Change Type to `integer`, Replace `"ES "` →
`"ES"` in `Country`, Filter `CustomerID` is-not-blank, and Remove
Duplicates by `CustomerID` — click any Applied Step to see the table as it
existed at that point. Use **+ Reference Query** on `Sales_Jan`/`Sales_Feb`
to build `Sales Combined` with an Append Queries step, then Merge Queries
against a `Products` query to expand `ProductName`/`Category`/`UnitPrice`,
and Group By `Category` to total `Revenue`. Add the transformed queries'
outputs (not the raw `DataCell`s) to a Model cell — everything downstream
(relationships, measures, visuals, validation) works exactly as it does on
raw data, because it's reading the same kind of `Dataset` either way.

Add a Model cell to select tables into a semantic
model and build a star schema (Customers/Products/Calendar 1:* Sales), then
use **+ New calculated column** to write a row-level expression such as
`Sales[Revenue] - Sales[Cost]` or `RELATED(Products[Category])`.

Use **+ New measure** to create `SUM(Sales[Revenue])`, `DISTINCTCOUNT(Sales[OrderID])`
or `DIVIDE([Total Revenue], [Orders])`, then expand the measure cell to add
filters (e.g. `Customers[Country] = Spain`) and watch the result recompute
with a full execution trace.

Once you have a model, use **+ Add Retail checkpoint** to add the built-in
scored checkpoint, then click **Check solution** to grade your model,
`Margin` column, and measures against frozen expected results — including
under several filter contexts, so a hardcoded number can't pass.

Expand a Model cell and switch to its **Context Explorer** tab to pick any
measure, add filters (e.g. `Customers[Country] = Spain`), and watch the
relationship-propagation diagram, baseline/current comparison, and
plain-English narrative update from the real runtime.

Use **+ Add Visual** to create a KPI on `Total Revenue`, a Bar chart of
`Products[Category]` by `Total Revenue`, a Line chart of `Calendar[Date]` by
`Total Revenue`, a Table of `Customers[Country]` with `Total Revenue`/
`Orders`/`Average Order Value`, and a `Customers[Country]` Slicer — then pick
a country and watch every visual recompute together, matching the exact
number the Context Explorer shows for the same filter.

Create `Spain Revenue = CALCULATE([Total Revenue], Customers[Country] = "Spain")`,
put it on a KPI, then set the `Customers[Country]` Slicer to France: `Total
Revenue` follows the slicer, `Spain Revenue` doesn't — same-column
replacement, not intersection. Add `Revenue All Countries =
CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country]))` to see a
slicer-proof grand total, and open either measure in the Context Explorer to
see the internal CALCULATE modification laid out step by step.

Create `Gross Margin X = SUMX(Sales, Sales[Revenue] - Sales[Cost])` and
compare it to `Total Revenue - Total Cost`; create `Calculated Revenue =
SUMX(Sales, Sales[Quantity] * RELATED(Products[UnitPrice]))` and compare it
to `SUM(Sales[Revenue])`; create `Selected Country = SELECTEDVALUE(
Customers[Country], "Multiple Countries")`, put it on a KPI, and watch it
switch between `"Multiple Countries"` and a single country name as you change
the `Customers[Country]` Slicer. Add a calculated column `Revenue Band =
SWITCH(TRUE(), Sales[Revenue] >= 2000, "Large", Sales[Revenue] >= 500,
"Medium", "Small")` and preview it row by row.

Mark `Calendar` as a Date Table (using `Calendar[Date]`) in the Model
editor, then create `Revenue LY = CALCULATE([Total Revenue],
SAMEPERIODLASTYEAR(Calendar[Date]))`. Select `Year = 2025, Month = March`
in the Context Explorer and watch `Revenue LY` compute March 2024's
revenue — not blank, and not intersected with `Year = 2025`. Add `Revenue
YoY = [Total Revenue] - [Revenue LY]`, `Revenue PM =
CALCULATE([Total Revenue], PREVIOUSMONTH(Calendar[Date]))` and `Revenue YTD
= TOTALYTD([Total Revenue], Calendar[Date])`, put all four on a Line
Visual against `Calendar[Month]`, and compare `Revenue YTD` to
`CALCULATE([Total Revenue], DATESYTD(Calendar[Date]))` — they always
match.

## Core documents

- [`PRODUCT.md`](./PRODUCT.md)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`ROADMAP.md`](./ROADMAP.md)
- [`docs/CELL_SPEC.md`](./docs/CELL_SPEC.md)
- [`docs/LEARNING_MODEL.md`](./docs/LEARNING_MODEL.md)
- [`docs/VALIDATION_ENGINE.md`](./docs/VALIDATION_ENGINE.md)
- [`docs/DATA_RUNTIME.md`](./docs/DATA_RUNTIME.md)
- [`docs/MODEL_RUNTIME.md`](./docs/MODEL_RUNTIME.md)
- [`docs/EXPRESSION_ENGINE.md`](./docs/EXPRESSION_ENGINE.md)
- [`docs/CALCULATED_COLUMNS.md`](./docs/CALCULATED_COLUMNS.md)
- [`docs/MEASURES.md`](./docs/MEASURES.md)
- [`docs/FILTER_CONTEXT.md`](./docs/FILTER_CONTEXT.md)
- [`docs/CONTEXT_VISUALIZER.md`](./docs/CONTEXT_VISUALIZER.md)
- [`docs/VISUAL_CELLS.md`](./docs/VISUAL_CELLS.md)
- [`docs/CALCULATE.md`](./docs/CALCULATE.md)
- [`docs/TABLE_EXPRESSIONS.md`](./docs/TABLE_EXPRESSIONS.md)
- [`docs/ITERATORS.md`](./docs/ITERATORS.md)
- [`docs/DATE_TABLES.md`](./docs/DATE_TABLES.md)
- [`docs/TIME_INTELLIGENCE.md`](./docs/TIME_INTELLIGENCE.md)
- [`docs/ADVANCED_RELATIONSHIPS.md`](./docs/ADVANCED_RELATIONSHIPS.md)
- [`docs/USERELATIONSHIP.md`](./docs/USERELATIONSHIP.md)
- [`docs/POWER_QUERY_RUNTIME.md`](./docs/POWER_QUERY_RUNTIME.md)
- [`docs/APPLIED_STEPS.md`](./docs/APPLIED_STEPS.md)
- [`docs/POWER_QUERY_EXPRESSIONS.md`](./docs/POWER_QUERY_EXPRESSIONS.md)
- [`docs/LEARNING_SYSTEM.md`](./docs/LEARNING_SYSTEM.md)
- [`docs/QUERY_VALIDATION.md`](./docs/QUERY_VALIDATION.md)
- [`docs/WORKSPACE_INTEGRITY.md`](./docs/WORKSPACE_INTEGRITY.md)
- [`docs/SEMANTIC_CONFORMANCE.md`](./docs/SEMANTIC_CONFORMANCE.md)
- [`docs/PROJECT_BUNDLE.md`](./docs/PROJECT_BUNDLE.md)
- [`docs/PERFORMANCE.md`](./docs/PERFORMANCE.md)
- [`docs/E2E_TESTING.md`](./docs/E2E_TESTING.md)

## Scope guardrail

Do **not** attempt to recreate Power BI Desktop, Microsoft Fabric, or full
DAX compatibility. Power Query is now in scope, but only its Applied Steps
transformation workflow (Sprint 12) — not an arbitrary M parser/interpreter,
query folding, the Advanced Editor, custom M functions, connectors,
parameters, or dataflows. See `docs/POWER_QUERY_RUNTIME.md` "M-language
boundary".

The learning target is the smallest runtime that can faithfully teach the mental models used in real BI work.
