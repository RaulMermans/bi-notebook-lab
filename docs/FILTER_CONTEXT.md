# Filter Context (Sprint 4 + Sprint 8)

`FilterContext` is the explicit, first-class runtime concept a measure
evaluates in — the counterpart to `RowContext` for calculated columns
(see [`MEASURES.md`](./MEASURES.md)). This document covers its
representation, propagation algorithm, and execution traces — all
unchanged in their *public* contract since Sprint 4. Sprint 8's `CALCULATE`
builds a separate, richer context-*modification* layer on top of these same
primitives without changing them — see [`CALCULATE.md`](./CALCULATE.md) for
that layer, including the one propagation-pipeline extension
(`resolveFilterContextUnchecked`'s optional `tableSelections` seed) that made
`FILTER(Table, predicate)` possible with no change to `propagate()` itself.

## Representation (`src/runtime/measure/filterContext.ts`)

```ts
interface ColumnFilter {
  column: ColumnRef            // { datasetId, tableId, columnId } — a physical column
  operator: 'equals' | 'in'
  values: unknown[]
}

interface FilterContext {
  filters: ColumnFilter[]
}
```

All filters in a `FilterContext` apply simultaneously with **AND**
semantics. `FILTER`/`CALCULATE`/boolean expression filters are explicitly
out of scope for Sprint 4 (see "Explicitly Out of Scope" in the sprint
brief) — `ColumnFilter` covers exactly equality and set-membership, which
is what's needed to teach direct filtering and relationship propagation.

## Row selection (`src/runtime/measure/filterPropagation.ts`)

```ts
type RowSelection = Set<number> | 'all'
```

`'all'` means "every row of the table is visible" and is kept lazy so an
unfiltered 100k-row fact table never materializes a `Set`. Row selections
are runtime-only — never persisted, always recomputed from the current
`FilterContext`.

## Resolution pipeline

`resolveFilterContext(model, datasets, filterContext, tableSelections?):
ResolvedFilterState` runs in three steps. Since Sprint 8, it's a thin
wrapper: it runs the graph-validity check once, then delegates to
`resolveFilterContextUnchecked` (steps 2-3) for the actual computation —
`CALCULATE`'s nested resolutions call the unchecked variant directly, since
graph validity is a property of `model` alone and was already checked once
at the top of `evaluateMeasure` (see [`CALCULATE.md`](./CALCULATE.md)
"performance"). The optional `tableSelections` parameter (new in Sprint 8)
seeds a table's starting row selection instead of `'all'` — see
[`CALCULATE.md`](./CALCULATE.md) "FILTER row context and table-selection
representation".

### 1. Fail closed on an invalid relationship graph

Before anything else, `resolveFilterContext` runs
`runtime/model/graphAnalysis.ts#validateModel` and checks for
`ACTIVE_CYCLE` or `AMBIGUOUS_PATH` diagnostics. If either is present, the
whole filter context — and therefore every measure evaluated under it —
fails closed with a single `FILTER_GRAPH_INVALID` diagnostic instead of
silently picking one propagation path:

```text
FILTER_GRAPH_INVALID

This model's relationship graph is invalid (ACTIVE_CYCLE, AMBIGUOUS_PATH),
so measures can't be evaluated deterministically. Fix the model
diagnostics first.
```

This is a learning environment; deterministic correctness matters more
than permissiveness.

### 2. Apply direct filters

Each `ColumnFilter` is grouped by its resolved `ModelTable`, and every
filter landing on the same table AND-intersects (`applyDirectFilters`).
A filter on `Sales[Quantity]` constrains `Sales` directly; a filter on
`Customers[Country]` constrains `Customers` directly. Neither yet affects
any other table — that's step 3.

### 3. Propagate through active relationships, one → many, to a fixed point

For every **active** relationship whose "1" side already has a
constrained row selection, `propagate()`:

1. Collects the set of key values still visible on the "1" side
   (`allowedKeysFromOneSide`).
2. Looks up the "many" side's matching row indices via a
   `foreign key value -> row indices` index built once per relationship
   per evaluation (`buildManySideKeyIndex` — an evaluation-local cache,
   the same pattern as Sprint 3's `RELATED` index).
3. Intersects that with the many-side's current selection.

This repeats in a loop (bounded by `relationships.length + 1` passes)
until nothing changes, so a transitive chain (`Region → Customers →
Sales`) resolves without hardcoding hop counts — each pass can pick up a
newly-constrained table from the previous pass.

**Direction is one-way by construction**: the loop only ever reads the
"1" side's selection to constrain the "many" side. A filter on `Sales`
(the many side of every relationship in a star schema) is never used to
constrain `Customers`/`Products`/`Calendar` — real Power BI single-
direction filtering, not a simplification bug.

**Inactive relationships are skipped entirely** — `activeRelationships()`
(shared with `graphAnalysis.ts`) filters them out before propagation ever
sees them, so disabling a relationship on the model canvas immediately
stops it from propagating, and re-enabling it immediately restores
propagation, with no measure-side changes needed.

## Relationship indexing / performance

Within one `evaluateMeasure` call:

- Each relationship's many-side key index is built at most once
  (`manyIndexCache` inside `propagate()`).
- Each logical column's value vector (physical or calculated) is
  resolved at most once (`columnValuesCache` inside
  `measureEvaluator.ts`), even if multiple aggregations in the same
  measure expression read the same column.
- Measure references are cached per evaluation (see `MEASURES.md`
  "Shared dependencies evaluated once").

None of these caches are persisted or shared across separate
`evaluateMeasure` calls — each call gets fresh, evaluation-local caches,
avoiding the invalidation problems a global cache would introduce.

## Execution trace

`resolveFilterContext` builds one `ExecutionTraceNode` (`kind:
'filter-context'`) whose children are:

- one `filter-context` node per direct filter, with `rowsBefore`/
  `rowsAfter` metadata from the actual row scan;
- one `relationship-propagation` node per relationship that actually
  changed a selection, with `manyRowsBefore`/`manyRowsAfter` metadata.

`measureEvaluator.ts` emits `aggregation` trace nodes with
`visibleRows`/`totalRows`/`nonBlankValues` metadata from the real
aggregation call — never a string reconstructed from the expression
source. All of this renders through the shared `TraceNodeView` component
(`components/notebook/shared/TraceTree.tsx`).

## UI

`components/context/ContextFilterEditor.tsx` — generalized in Sprint 6 from
the original Sprint 4 `FilterContextPanel` — is a lightweight
evaluation-context editor, not a report slicer: add/remove
table+column+value filters, with a value picker sourced from the column's
actual distinct values (capped at 200 — larger columns fall back to a
free-text input, per the sprint brief's "avoid rendering tens of thousands
of dropdown items"). It's shared by both `MeasureCellCard.tsx` (its "No
filters" vs. "Current context" comparison) and the Sprint 6 `ContextExplorer`
— there is only one implementation. See
[`CONTEXT_VISUALIZER.md`](./CONTEXT_VISUALIZER.md) for the model-wide
propagation visualization built on top of this same `FilterContext`/
`ResolvedFilterState`.

Filter context state is UI-only and never persisted — reloading the
notebook always starts a measure back at "no filters", by design (spec
§53).

## FilterContext merge (Sprint 7)

`mergeFilterContexts(base, additional)` (added to this module in Sprint 7)
is the canonical way to combine two `FilterContext`s — used by the Visual
Runtime to intersect the shared notebook/slicer context with a grouped
Visual's own per-member filter. Different columns AND together; the same
column **intersects** its value sets rather than appending a second,
contradictory constraint (so `Country IN [Spain, France]` merged with
`Country = Spain` collapses to `Country = Spain`, and two flatly
contradictory filters collapse to an empty, deterministically-zero-row value
set rather than silently picking one side). See
[`VISUAL_CELLS.md`](./VISUAL_CELLS.md) for the full design and the one
learner-visible consequence (blank grouped rows when a Visual's dimension
matches an active Slicer's own column).

The Sprint 7 `NotebookVisualContext` (`useNotebookVisualContext.ts`) is a
separate piece of transient UI state from this file's `ColumnFilter`/
`FilterContext` — built on the same primitives, but never shared with
`ContextFilterEditor`'s state (deliberately: Context Explorer is a
diagnostic surface, Visual Cells are notebook output — see
`VISUAL_CELLS.md`).

## Known limitations

- `ColumnFilter` itself is still only `equals`/`in` — this contract was
  deliberately **not** extended for Sprint 8 (sprint brief §47 "do not
  mutate the persisted/public meaning of `FilterContext` unless necessary").
  Comparison operators, boolean combinations, and `CALCULATE`/`FILTER`
  context modification are real and implemented, but live in a *separate*
  runtime layer (`contextModifier.ts`/`booleanFilter.ts`) that produces a
  plain `ColumnFilter[]` (plus an internal table-selection seed) by the time
  it reaches this module — see [`CALCULATE.md`](./CALCULATE.md).
- Ambiguous or cyclic active relationship graphs fail the *entire*
  evaluation rather than degrading gracefully for the unaffected part of
  the model — intentional per spec, but means one bad relationship can
  block every measure in a larger model until fixed.
- `MIN`/`MAX`-side type restrictions and `DISTINCTCOUNT`'s blank handling
  are documented in `MEASURES.md`, not repeated here.
