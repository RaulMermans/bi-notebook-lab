# BI Notebook Lab

An interactive notebook for learning **business intelligence, data modeling and DAX-style analytical thinking by doing**.

The product is intentionally **not a Power BI clone**. The core mental model is closer to Jupyter:

```text
Dataset → Model → Calculated Column → Measure → Visual → Question → Test
```

Each concept is represented as an executable notebook cell. Learners build a solution progressively and receive immediate feedback on structure, calculations and reasoning.

## North Star

> Make invisible BI concepts visible, executable and testable.

Power BI is excellent for building reports, but it is not optimized as a learning environment. BI Notebook Lab focuses on the parts that beginners usually find hardest:

- table grain and keys
- star schemas
- relationships and filter propagation
- calculated columns vs measures
- row context vs filter context
- common DAX patterns
- debugging why a result is wrong

## Product surface

A notebook can contain:

- `MarkdownCell`
- `DataCell`
- `ModelCell`
- `CalculatedColumnCell`
- `MeasureCell`
- `VisualCell`
- `QuestionCell`
- `TestCell`

The first product milestone is not a dashboard builder. It is a **learning runtime** capable of executing and validating these cells.

## Repository status

Sprint 1 (Data Runtime), Sprint 2 (Semantic Model Runtime), Sprint 3
(Calculated Columns & Row Context), Sprint 4 (Measures & Filter Context),
Sprint 5 (Validation Engine), Sprint 6 (Context Visualizer), Sprint 7
(Visual Cells), Sprint 8 (`CALCULATE` & Filter Context Modification),
Sprint 9 (Iterators, Table Expressions & Conditional Logic), Sprint 10
(Date Tables & Classic Time Intelligence) and Sprint 11 (Advanced
Relationships & `USERELATIONSHIP`/`CROSSFILTER`) are complete — the full MVP
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

Calendar-based (Auto date/time) time intelligence, `TREATAS`, composite
models, and full DAX compatibility remain **not** implemented — see
[`docs/ITERATORS.md`](./docs/ITERATORS.md),
[`docs/TABLE_EXPRESSIONS.md`](./docs/TABLE_EXPRESSIONS.md),
[`docs/CALCULATE.md`](./docs/CALCULATE.md),
[`docs/TIME_INTELLIGENCE.md`](./docs/TIME_INTELLIGENCE.md) and
[`docs/ADVANCED_RELATIONSHIPS.md`](./docs/ADVANCED_RELATIONSHIPS.md) for the
exact scope and known limitations.

## Run locally

```bash
npm install
npm run dev
```

Then either import a `.csv`/`.xlsx` file or click **Load Retail Dataset** to
try the built-in sample. Add a Model cell to select tables into a semantic
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

## Scope guardrail

Do **not** attempt to recreate Power BI Desktop, Power Query, Microsoft Fabric or full DAX compatibility.

The learning target is the smallest runtime that can faithfully teach the mental models used in real BI work.
