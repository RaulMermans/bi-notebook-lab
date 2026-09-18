# Context Visualizer (Sprint 6 + Sprint 8)

This document describes the Context Explorer: a reusable surface that makes
Sprint 4's filter-context/relationship-propagation mechanics visually
understandable, without reimplementing any of them.

**Sprint 8 update:** for a measure whose top-level expression is `CALCULATE`
(directly, or through a chain of plain measure references), the Explorer's
diagram and baseline/current comparison reflect the **internal,
CALCULATE-modified** context rather than the external one the learner set —
distinctly surfacing "external vs. internal" filters rather than hiding the
CALCULATE modification. This required zero changes to `contextAnalysis.ts`,
`graphAdapter.ts` or any Context Explorer component: it falls out of
`evaluateMeasure` itself now returning the CALCULATE-modified
`ResolvedFilterState` for that case (see
[`CALCULATE.md`](./CALCULATE.md) "Context Explorer integration" for the
exact, bounded scope of this substitution, and the one small
`graphAdapter.ts` fallback needed so a `FILTER`-derived reduction still shows
a consistent state badge).

## Purpose

Sprint 4 already computes exactly why a measure evaluates the way it does
(`resolveFilterContext`, `evaluateMeasure`) but only exposed it per-measure,
inline in `MeasureCellCard`. Sprint 6 promotes that to a first-class,
model-wide surface — `ContextExplorer` — so a learner can pick any measure
and any combination of filters and see:

- the baseline (unfiltered) result vs. the current-context result;
- which tables are directly filtered, which are propagated-into, and which
  are untouched;
- the direction and state of every relationship (`1 → *`, active/inactive,
  had-effect/no-effect);
- a plain-English narrative of what happened, at two levels of detail;
- a measure's dependency chain, when it references other measures.

See `ROADMAP.md` Phase 6 and the Sprint 6 brief for the product framing.

## Runtime-truth reuse

Nothing in this layer computes filtering, propagation, or aggregation.
`src/runtime/context/contextAnalysis.ts#analyzeMeasureContext` composes
exactly two calls to Sprint 4's `evaluateMeasure` (baseline, empty
`FilterContext`; current, the learner's `FilterContext`) and adapts their
already-computed `ResolvedFilterState`/`ExecutionTraceNode` output:

```text
analyzeMeasureContext({ model, datasets, measureId, filterContext })
  → evaluateMeasure(..., EMPTY_FILTER_CONTEXT)   // baseline
  → evaluateMeasure(..., filterContext)          // current
  → compareMeasureResults(baseline.value, current.value)      // comparison.ts
  → buildTableStates(model, current.filterState)               // graphAdapter.ts
  → buildRelationshipStates(model, datasets, current.filterState)
  → buildContextNarrative(...) / buildBeginnerExplanation(...)  // narrative.ts
```

`graphAdapter.ts`/`narrative.ts`/`comparison.ts` only read fields Sprint 4
already computed (`tableSummaries`, `directFilterSummaries`,
`propagationSteps`, `trace`) — see "No duplicated propagation algorithm"
below.

### One additive runtime extension

`DirectFilterSummary` (in `runtime/measure/filterPropagation.ts`) gained a
`modelTableId` field — it was already computed inside
`applyDirectFilters()`'s loop but not previously returned. This lets
`graphAdapter.ts` cross-reference a direct filter to its table by id instead
of by name (names aren't guaranteed unique across datasets). No filtering
behavior changed.

## Contract (`src/domain/context.ts`)

```ts
interface ContextAnalysis {
  measureId; measureName; measureExpression
  filters: ColumnFilter[]
  tables?: ContextTableState[]            // undefined when invalid
  relationships?: ContextRelationshipState[]
  baseline: ContextMeasureResult
  current: ContextMeasureResult
  comparison: MeasureContextComparison
  narrative: ContextFlowStep[]
  beginnerExplanation: string
  invalid?: { code; message }             // set instead of tables/relationships
}
```

```ts
interface ContextTableState {
  modelTableId; tableName; totalRows; visibleRows; percentVisible
  filterState: 'unfiltered' | 'direct' | 'propagated' | 'direct+propagated'
  directFilters: ContextFilterSummary[]
  incomingPropagation: ContextTablePropagationSource[]
  position?: { x; y }                      // ModelTable.position, reused as-is
}

interface ContextRelationshipState {
  relationshipId; oneModelTableId; manyModelTableId
  oneTableName; manyTableName; oneColumnName; manyColumnName
  active: boolean
  propagated: boolean
  state: 'propagated' | 'active-no-effect' | 'inactive'
  manyRowsBefore?; manyRowsAfter?
  allowedOneSideKeys?: number    // == the "1" side's visible row count (see below)
}
```

`allowedOneSideKeys` is not a new computation: a relationship's "1" side is
always unique (enforced by `ONE_SIDE_NOT_UNIQUE` at creation time —
`docs/MODEL_RUNTIME.md`), so the number of distinct visible key values on
that side always equals its visible row count, which `tableSummaries`
already has.

## Baseline vs. current comparison

`runtime/context/comparison.ts#compareMeasureResults` only computes a
numeric delta when **both** values are finite numbers:

- `baseline === 0, current === 0` → `relativeDelta = 0` (not `undefined`,
  not `NaN`).
- `baseline === 0, current !== 0` → `relativeDelta` stays `undefined` — the
  UI shows "n/a (baseline is 0)" rather than `Infinity`/`NaN`.
- Either value non-numeric (string/boolean/blank) → `bothNumeric: false`,
  no delta at all — never `"Spain" - "France"`.

## Table/relationship classification

A table's `filterState` is derived purely from whether it has any entries in
`directFilters`/`incomingPropagation` (both populated straight from
`ResolvedFilterState`):

| directFilters | incomingPropagation | `filterState` |
|---|---|---|
| none | none | `unfiltered` |
| some | none | `direct` |
| none | some | `propagated` |
| some | some | `direct+propagated` |

A relationship's `state` is:

- `inactive` if `Relationship.active === false` — regardless of anything
  else;
- `propagated` if a matching `PropagationStep` exists (Sprint 4 only emits
  one when the many-side selection actually changed);
- `active-no-effect` otherwise — active, but its "1" side wasn't
  constrained (or the constraint didn't change anything) under the current
  context.

This distinguishes three real states the sprint brief calls out explicitly:
an inactive relationship never propagates; an active relationship with an
unfiltered "1" side has "no effect" this evaluation; a relationship that
actually narrowed the many side is "propagated," annotated with its real
before/after row counts.

## Multiple filter paths

When two dimension tables are both filtered (e.g. `Customers[Country] =
Spain` and `Products[Category] = Furniture`), Sales' `incomingPropagation`
naturally contains one entry per relationship that narrowed it — because
`resolveFilterContext`'s fixed-point loop records a `PropagationStep` per
relationship, independently. The table node shows "Via Customers →
CustomerID, Products → ProductID"; nothing here special-cases "two
filters" — it's just iterating the same list Sprint 4 already produced.

## Narrative (`runtime/context/narrative.ts`)

`buildContextNarrative` produces a numbered sequence generated entirely
from `ResolvedFilterState.directFilterSummaries` /
`.propagationSteps`, plus any `aggregation` nodes found by walking the
measure's own execution trace (`collectAggregationNodes`) — never a
hardcoded, exercise-specific string. `buildBeginnerExplanation` produces a
one-paragraph prose version of the same facts for the "Explanation" toggle.
Both fall back to an explicit "no filters" sentence when the context is
empty (Sprint 6 brief §29's "not an error state").

## Measure dependency visualization

`components/context/MeasureDependencyTree.tsx` reuses the shared
`TraceNodeView` component (the same one the row-context visualizer and the
technical trace tree use) and only renders when the measure's own trace
contains a *nested* `measure-reference` node — i.e. the measure actually
depends on another measure (e.g. `Average Order Value = DIVIDE([Total
Revenue], [Orders])`). No second trace representation was built.

## Row Context vs. Filter Context

`components/context/RowVsFilterContextNote.tsx` is the one static,
non-runtime-driven component in this layer — a compact side-by-side
reminder of the Sprint 3 vs. Sprint 4 distinction (once-per-row/`RowContext`
vs. once-per-query/`FilterContext`). It appears at the bottom of
`ContextExplorer` and is intentionally kept separate from
`RowContextVisualizer` (Sprint 3) — the two contexts are never merged.

## UI architecture (`src/components/context/`)

```text
ContextExplorer.tsx             top-level surface: measure picker, filter
                                 editor, comparison, diagram + details,
                                 narrative, dependency tree, technical trace
                                 toggle, row-vs-filter-context note
ContextFilterEditor.tsx         the Sprint 4 FilterContextPanel, generalized
                                 and moved here — shared by ContextExplorer
                                 and MeasureCellCard (no second implementation)
ContextPropagationDiagram.tsx   read-only @xyflow/react graph
ContextTableNode.tsx            table node: visible/total rows, %, state badge
ContextRelationshipEdge.tsx     relationship edge: 1 → * direction, state
                                 label, before/after impact when propagated
ContextComparison.tsx           baseline vs. current, delta/%
ContextDetailsPanel.tsx         table inspector / propagation-step inspector
ContextFlowNarrative.tsx        Explanation / Step-by-step toggle
MeasureDependencyTree.tsx       reuses TraceNodeView, conditional on dependency
RowVsFilterContextNote.tsx      static Row Context vs. Filter Context card
```

Selecting a node or edge in `ContextPropagationDiagram` drives
`ContextDetailsPanel` via `ContextExplorer`'s own `selectedTableId`/
`selectedRelationshipId` state — clicking the same element again deselects
it (`ContextExplorer.selectTable`/`selectRelationship`).

## Where it lives

`ModelCellCard` gained a `[Model] [Context Explorer]` tab switch
(`model-view-tabs`, `role="tablist"`). Both views stay **mounted** — only
one is `hidden` at a time — so switching to the Model tab to toggle a
relationship's active state and switching straight back to Context Explorer
never resets the learner's in-progress filter selection. Only unmounting the
whole `ModelCellCard` (removing the cell, or a page reload) resets it — which
matches "filters are transient, never persisted" (brief §9/§53).

## React Flow reuse

`ContextPropagationDiagram` reuses `@xyflow/react` (the same library
`ModelCanvas` uses) rather than a second graph library, in a read-only
configuration: `nodesDraggable={false}`, `nodesConnectable={false}`,
`edgesReconnectable={false}`. Table positions come from the learner's own
`ModelTable.position` when set, falling back to the same deterministic grid
formula `ModelCanvas` uses — now shared via
`src/lib/layout/modelLayout.ts#defaultTablePosition` instead of being
duplicated in each file.

### A real accessibility/interaction pitfall, and its fix

React Flow's edge-label and (in this read-only configuration) node wrapper
elements set `pointer-events: none` so panning/dragging the canvas isn't
blocked by overlay content; `pointer-events` is an inherited CSS property,
so any interactive element rendered inside — our node/edge `<button>`s —
silently inherited `none` too, and clicks fell through to the pane
underneath. `.context-node`, `.context-node__button`, and
`.context-edge-label` all set `pointer-events: auto` explicitly to override
this. This was caught during manual browser verification (clicks on a table
node or relationship edge did nothing until the fix), not by any automated
test — there is no component-test harness in this repo (`vitest` runs in a
Node environment, not `jsdom`).

## Accessibility

Every table/relationship state is expressed as visible text (`DIRECT`,
`PROPAGATED`, `UNFILTERED`, `ACTIVE · NO EFFECT`, `INACTIVE`), never color
alone; edges additionally distinguish state by line weight/dash. Every
selectable diagram element is a real `<button>` (`aria-pressed` reflects
selection), not a click-only `<div>`, so keyboard navigation (Tab + Enter/
Space) reaches every node and edge. The filter editor's table/column/value
pickers are labelled `<select>`/`<input>` elements with explicit
`aria-label`s.

## Invalid relationship graphs fail closed

If `current.filterState.valid` is `false` (the model's active relationship
graph has an `ACTIVE_CYCLE`/`AMBIGUOUS_PATH`), `analyzeMeasureContext`
returns `invalid: { code, message }` and omits `tables`/`relationships`
entirely — `ContextExplorer` renders the fixed message from Sprint 6 brief
§27 ("Context cannot be resolved... Fix the model before exploring filter
propagation") instead of a diagram built from partial/undefined data. This
reuses the exact same `FILTER_GRAPH_INVALID` guard `resolveFilterContext`
already enforces (`docs/FILTER_CONTEXT.md` "Invalid filter graphs") — no new
validation logic.

## No-filter state

With an empty `FilterContext`, every table's `filterState` is `unfiltered`
and every relationship's `state` is `active-no-effect` — this is the normal,
non-error baseline (brief §29), and `baseline.value === current.value`
(verified by `compareMeasureResults` returning `absoluteDelta: 0`).

## Performance

Each filter change triggers exactly one `analyzeMeasureContext` call (memoized
per `[model, datasets, measure, filters]` via `useMemo` in
`ContextExplorer`), which is two `evaluateMeasure` calls — the same cost as
`MeasureCellCard`'s existing baseline/current comparison, just centralized.
No global cache was added; Sprint 4's own evaluation-local caches
(`columnValuesCache`, `manyIndexCache`) already make a single evaluation
cheap at Retail scale.

## No duplicated propagation algorithm

`src/runtime/context/*.ts` contains no `resolveContextFilterContext()`, no
`contextPropagate()`, and no second aggregation function — every number
displayed by the Context Explorer traces back to a field already present on
`ResolvedFilterState`/`MeasureExecution`/`ExecutionTraceNode`. If that
weren't true, the Context Explorer and the measure runtime could silently
drift apart (the same rationale `docs/VALIDATION_ENGINE.md` gives for why
the validation engine never reimplements BI logic).

## Known limitations

- No exercise-authoring integration beyond a manual pointer:
  `TestCellCard` shows "Explore context: open this checkpoint's Model
  cell → Context Explorer tab..." next to a `HINT_FILTER_CONTEXT` feedback
  item, rather than an automatic deep-link/selection. Per brief §26
  ("provide a clear manual path instead" if direct deep-linking is
  disproportionate), and to keep the Validation Engine decoupled from UI
  visualization state.
- Filter context is per-`ContextExplorer` instance, transient state — never
  persisted, and reset when the `ModelCellCard` itself unmounts (removing
  the cell, or reloading the page). It is preserved across the Model ↔
  Context Explorer tab switch within the same session (see "Where it
  lives" above).
- `ContextPropagationDiagram` inherits the same relationship model as
  Sprint 4: one-to-many, single-direction filtering only. There is nothing
  to visualize for bidirectional or many-to-many relationships because they
  don't exist yet.
