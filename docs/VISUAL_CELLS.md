# Visual Cells (Sprint 7 + Sprint 8 + Sprint 9)

Sprint 7 completes the MVP learning loop by adding a bounded visualization
layer on top of the Sprint 2–6 semantic model / measure / filter-context
runtime. This document covers the `VisualCell` domain contract, the
`VisualSpec` union, the Visual Runtime's execution semantics, `FilterContext`
merge behavior, the shared slicer context, persistence, performance, and
known limitations.

**Sprint 8 update:** every Visual automatically supports `CALCULATE`
measures — a KPI on `Spain Revenue` still shows Spain under a France
Slicer (same-column replacement happens one layer down, inside
`evaluateMeasure`, invisible to `mergeFilterContexts`), and a grouped Bar/
Table correctly combines its own per-member filter with a `CALCULATE`
measure's internal context. **Zero lines changed in `runtime/visual/*`** —
see [`CALCULATE.md`](./CALCULATE.md) "Visual Cells integration" and
`tests/runtime/visual/calculateVisual.test.ts`.

**Sprint 9 update:** the same is true of iterator (`SUMX`/`AVERAGEX`/`MINX`/
`MAXX`/`COUNTX`) and conditional (`IF`/`SWITCH`/`SELECTEDVALUE`) measures — a
KPI on `Selected Country` (`SELECTEDVALUE`) reacts to a slicer the same way a
`CALCULATE` measure does, and a grouped Bar/Table computing a `SUMX` measure
per member gets that member's category filter folded into the iterator's
table expression automatically, purely because `evaluateMeasure` is still the
one and only thing every Visual calls. **Zero lines changed in
`runtime/visual/*`** — see [`docs/ITERATORS.md`](./ITERATORS.md) "Visual Cell
integration" and `tests/runtime/visual/iteratorVisual.test.ts`.

## Product boundary

This is **not** a report designer. There are no report pages, no freeform
canvas, no drag-resize tiles, no chart theming, no cross-filtering/
drill-through, and no visual-design grading. A Visual is a notebook cell,
exactly like a `MeasureCell` or `CalculatedColumnCell` — its only job is to
let a learner see, in real numbers, that the model/measure they built
actually behaves correctly.

## VisualCell (`src/domain/notebook.ts`)

```ts
interface VisualCell extends BaseNotebookCell {
  kind: 'visual'
  modelId: string
  visual: VisualSpec
}
```

`visual` was removed from `GenericCellKind` and promoted to a fully typed
cell, mirroring `MeasureCell`/`CalculatedColumnCell`/`TestCell`. Unlike a
`MeasureCell`, there is no create-time validation pass: a `VisualSpec` is
authored field-mapping data (like a `TestCell`'s `ValidationSpec`), not an
expression that can fail to parse — so a `VisualCell` always comes into
existence, and a mapping that later goes stale (deleted measure/column)
fails safely at render time instead (see "Broken references" below).

## VisualSpec (`src/domain/visual.ts`)

```ts
type VisualSpec = KpiVisualSpec | TableVisualSpec | BarVisualSpec | LineVisualSpec | SlicerVisualSpec

interface BaseVisualSpec { id: string; type: VisualType; title?: string }

interface KpiVisualSpec extends BaseVisualSpec { type: 'kpi'; measureId: string }

interface BarVisualSpec extends BaseVisualSpec {
  type: 'bar'; category: ColumnRef; measureId: string
  sort?: 'category-asc' | 'category-desc' | 'value-asc' | 'value-desc'
  limit?: number
}

interface LineVisualSpec extends BaseVisualSpec {
  type: 'line'; axis: ColumnRef; measureId: string
  sort?: 'axis-asc' | 'axis-desc'
}

interface TableVisualSpec extends BaseVisualSpec {
  type: 'table'; dimension?: ColumnRef; measureIds: string[]; limit?: number
}

interface SlicerVisualSpec extends BaseVisualSpec {
  type: 'slicer'; column: ColumnRef; mode?: 'single' | 'multi'
}
```

`category`/`axis`/`dimension`/`column` are always physical `ColumnRef`s
(`{ datasetId, tableId, columnId }`) — never a `CalculatedColumn` reference
and never a `ModelTable.id`. See "Known limitations" for why calculated
columns aren't yet supported as visual dimensions, and `FILTER_CONTEXT.md`
§34 (the Sprint 4 regression) for why `ModelTable.id` must never leak into a
`ColumnRef`.

## Visual Runtime (`src/runtime/visual/`)

```text
types.ts       VisualDiagnostic, VisualDataRow, VisualQueryResult, KpiQueryResult
grouping.ts    getDistinctVisualMembers, evaluateGroupedRows
sorting.ts     sortBarRows, sortLineRows
visualQuery.ts runKpiVisual, runBarVisual, runLineVisual,
               runGroupedTableVisual, runScalarTableVisual
visualRuntime.ts  barrel + runTableVisual/runVisualQuery dispatchers,
                  runSlicerMembers, buildSlicerFilter
```

The Visual Runtime reuses, unmodified:

- `evaluateMeasure` (`runtime/measure/measureRuntime.ts`) for every number a
  Visual ever shows;
- `resolveColumnRef`/`resolveTableRef` (`runtime/model/modelRuntime.ts`) to
  resolve a `ColumnRef` against the live dataset registry;
- `mergeFilterContexts` (`runtime/measure/filterContext.ts`, new this
  sprint — see below) to combine the shared notebook/slicer context with a
  Visual's own per-member filter.

It implements **no** aggregation function, no relationship propagation, and
no second filter-resolution algorithm. `SUM`/`COUNTROWS`/`DISTINCTCOUNT`/…
and one → many propagation still live exactly where Sprint 4 put them.

### The core mechanism: grouped measure evaluation

A grouped Visual (Bar/Line/Table-with-a-dimension) is "repeated measure
evaluation under controlled filter contexts" (`grouping.ts#evaluateGroupedRows`):

1. `getDistinctVisualMembers` resolves the dimension column's real, deduped,
   non-blank values directly from the underlying `DataTable` rows (never
   from rendered labels), plus a separate `hasBlank` flag.
2. For each member (plus one synthetic `(Blank)` member if `hasBlank`), it
   merges the shared `notebookContext` with `{ column: dimension, operator:
   'equals', values: [member] }` via `mergeFilterContexts`, then calls
   `evaluateMeasure` once per configured measure under that merged context.
3. The caller (`runBarVisual`/`runLineVisual`/`runGroupedTableVisual`) then
   sorts (`sorting.ts`) and applies the cardinality limit.

This is deliberately the naive `N` distinct members `x` `M` measures
strategy (brief §57) — see "Performance" below.

### KPI and scalar Table

`runKpiVisual` and `runScalarTableVisual` skip grouping entirely: they
evaluate each configured measure exactly once under the shared
`notebookContext`. A `TableVisualSpec` with no `dimension` renders one row
per measure (`Measure | Value`) instead of one row per dimension member.

## FilterContext merge (`mergeFilterContexts`, `runtime/measure/filterContext.ts`)

```ts
function mergeFilterContexts(base: FilterContext, additional: FilterContext): FilterContext
```

Rule, keyed by `{ datasetId, tableId, columnId }`:

- **Different columns always combine with AND** — a filter on a column not
  already present in `base` is simply added.
- **The same column intersects** rather than appending a second,
  contradictory constraint: `Country IN [Spain, France]` merged with
  `Country = Spain` collapses to `Country = Spain`. Two flatly contradictory
  filters (`Country = Spain` merged with `Country = France`) collapse to an
  **empty value set** on that column, which `filterPropagation.ts`'s
  `columnMatches` then deterministically matches against zero rows — never
  a silently-picked side.

### The "blank grouped rows" consequence

This has one visible, deliberate consequence: if a Visual's own dimension is
the **same column** an active Slicer already filters, every group *except*
the one matching the Slicer's selection becomes an impossible (empty-value)
constraint once merged with the shared context, and renders as `Blank`/`0`
rather than being hidden. This was observed and confirmed correct during
manual verification (a `Customers[Country]` table alongside a
`Customers[Country]` slicer set to Spain: every other country's row goes
blank, Spain's stays populated and matches the KPI exactly). It is the
correct, deterministic outcome of "same-column filters intersect" — not a
bug — but it is a real, learner-visible UX rough edge worth knowing about
before building a Table whose dimension mirrors an active Slicer's field.

## Shared notebook visual context

Conceptually (brief §14):

```ts
interface NotebookVisualContext { filters: ColumnFilter[] }
```

Implemented in `runtime/notebook/useNotebookVisualContext.ts` as
`Record<slicerCellId, ColumnFilter>` rather than a flat array, specifically
so **clearing one Slicer removes only its own filter** (brief §36) even in
the edge case where two Slicers target the same column — deleting one map
entry can never touch another's. The merged `FilterContext` every Visual
actually reads is derived via `mergeFilterContexts` folded over that map's
current values. It is **transient React state owned by `App.tsx`** — never
persisted, and explicitly not the same state as the Sprint 6 Context
Explorer's filter editor (brief §15): two different surfaces, two different
lifetimes, even though both are ordinary `ColumnFilter[]`/`FilterContext`
values under the hood.

## KPI / Bar / Line / Table / Slicer

- **KPI** (`components/visual/KpiVisual.tsx`) — one scalar, formatted with
  the existing `formatContextValue` (`lib/format/formatValue.ts`, shared
  with the Context Explorer — no competing formatter). Blank (`null`) is a
  legitimate result and renders as `—`; a diagnostic renders as an explicit
  error, never a fabricated `0`.
- **Bar** (`BarVisual.tsx`) — Recharts horizontal bar chart. Default sort
  `value-desc`. An accessible `visual__summary` paragraph (category count,
  highest/lowest) carries the same information as the chart, generated from
  the actual `VisualQueryResult` — never hardcoded.
- **Line** (`LineVisual.tsx`) — Recharts line chart. Default sort
  `axis-asc`, chronological for `date`/`datetime` columns, numeric/lexical
  otherwise. No zoom/drill/time hierarchy.
- **Table** (`TableVisual.tsx`) — a real semantic `<table>` (not a raw
  dataset preview): `dimension + measures`, or `Measure | Value` with no
  dimension. Client-side column sorting is supported since it's
  straightforward on top of an already-computed result.
- **Slicer** (`SlicerVisual.tsx`) — real radio/checkbox form controls (never
  the chart canvas as the only source of information), sourced from
  `getDistinctVisualMembers`/`runSlicerMembers`, capped at the same 200-value
  limit as `ContextFilterEditor`. Emits a canonical `ColumnFilter` via
  `buildSlicerFilter(column, selectedValues, mode)` — always the Slicer's own
  `ColumnRef`, never a `ModelTable.id` (the Sprint 4 regression `FILTER_
  CONTEXT.md` §34 warns about; `tests/runtime/visual/slicer.test.ts` asserts
  this explicitly). Selections are fully controlled from
  `useNotebookVisualContext` — the component itself holds no selection state.

`VisualRenderer.tsx` is the single dispatch point: it calls
`runVisualQuery`/`runKpiVisual` and passes only the resulting
`VisualQueryResult`/`KpiQueryResult` to the chart/table component — none of
them ever see `SemanticModel`/`Dataset` directly (brief §21/§27).

## Cardinality limits and sorting

```ts
VISUAL_CARDINALITY_LIMITS = { bar: 30, line: 100, table: 100, slicer: 200 }
```

Truncation surfaces as a `VISUAL_HIGH_CARDINALITY` info diagnostic
("Showing top 30 of 842 categories.") rendered as a `visual__notice`, never
a silent cutoff. Sorting (`sorting.ts`) never relies on object insertion
order; blank dimension members always sort last, in every direction — a
deliberate, explicit choice rather than an accident of swapping comparator
arguments for descending order.

## Blank handling

- **Blank dimension members** render as the literal string `"(Blank)"`
  (`grouping.ts#BLANK_MEMBER_LABEL`) and are always included as their own
  group unless the underlying column has no blanks at all.
- **Blank measure results** (a legitimate "no matching rows" `SUM`, etc.)
  render as `formatContextValue`'s existing `"Blank"` in tables/charts, and
  as `—` in the KPI specifically (brief §53).

## Persistence

`VisualCell` — including its `VisualSpec` — lives entirely inside
`NotebookDocument.cells`, exactly like `TestCell`. No new IndexedDB store
was needed: the existing `saveNotebook` effect in `useNotebookRuntime.ts`
already persists the whole `cells` array on every change.
`NotebookRuntime#createVisualCell`/`updateVisualCell`/`removeVisualCell`
mirror `createTestCell`/`removeTestCell` exactly.

Slicer **selections** are never persisted — `useNotebookVisualContext`'s
`bySlicer` map lives only in `App.tsx`'s React state, so a reload always
restores every Visual's field mapping while resetting every Slicer to "All"
(brief §14/§45, matching the deliberate Sprint 4/6 precedent for filter UI
state).

## Broken references

A `VisualCell` whose `modelId` no longer resolves shows "This visual
references a model that no longer exists. Edit or remove the visual."
(`VisualCellCard.tsx`, mirroring `MeasureCellCard`'s "missing" state). A
`VisualSpec` whose `measureId`/`column`/`dimension` no longer resolves is
caught by the Visual Runtime itself (`VISUAL_MEASURE_NOT_FOUND`/
`VISUAL_COLUMN_NOT_FOUND`) and rendered as an explicit per-visual error —
never a crash, never a silently-blank chart. Verified manually: deleting a
measure referenced by a KPI/Bar/Line/Table left all four with a clear error
message, zero console errors, and both unrelated Slicers still fully
functional.

## Performance

The naive `N` distinct members `x` `M` measures strategy means `evaluate
Measure` runs up to `cardinalityLimit x measureCount` times per Visual
render — acceptable for the bounded MVP scale this product targets (brief
§57), and confirmed responsive against the 1,500-row/731-day built-in Retail
sample during manual verification, including a 100-point Line chart. This is
an intentional tradeoff, not an oversight: a future execution backend
(vectorized batch evaluation, a real query planner) can replace the repeated
`evaluateMeasure` calls inside `grouping.ts` without changing any
`VisualSpec`/`VisualCell` contract (brief §58).

## Known limitations

- **Visual dimensions are physical columns only.** `BarVisualSpec.category`/
  `LineVisualSpec.axis`/`TableVisualSpec.dimension`/`SlicerVisualSpec.column`
  are all plain `ColumnRef`s, which can only address a physical `DataColumn`
  — not a Sprint 3 `CalculatedColumn`. Measure aggregation is unaffected and
  still supports calculated columns exactly as Sprint 4 built it
  (`LogicalColumnRef`). Extending visual dimensions to calculated columns
  would need a new dimension-ref type (or reusing `LogicalColumnRef`) and
  was deferred as out of scope for Sprint 7 to avoid destabilizing the
  sprint, per the brief's explicit fallback.
- **Same-column Slicer + grouped-Visual interaction** renders blank rows for
  every non-matching group rather than hiding them — see "The 'blank
  grouped rows' consequence" above.
- Only `equals`/`in` column filters — no ranges, no boolean combinations,
  no `CALCULATE`/`FILTER` (unchanged from Sprint 4).
- No chart cross-filtering/drill-through/bookmarks — out of scope by design.
- No visual-design grading — `TestCell`/`ValidationSpec` remain
  model/column/measure-based only.
