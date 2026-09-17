# Filter Context (Sprint 4)

`FilterContext` is the explicit, first-class runtime concept a measure
evaluates in — the counterpart to `RowContext` for calculated columns
(see [`MEASURES.md`](./MEASURES.md)). This document covers its
representation, propagation algorithm, and execution traces.

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

`resolveFilterContext(model, datasets, filterContext): ResolvedFilterState`
runs in three steps:

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

`components/notebook/measure/FilterContextPanel.tsx` is a lightweight
evaluation-context editor, not a report slicer: add/remove
table+column+value filters, with a value picker sourced from the column's
actual distinct values (capped at 200 — larger columns fall back to a
free-text input, per the sprint brief's "avoid rendering tens of thousands
of dropdown items"). `MeasureCellCard.tsx` shows a "No filters" vs.
"Current context" comparison whenever at least one filter is active.

Filter context state is UI-only and never persisted — reloading the
notebook always starts a measure back at "no filters", by design (spec
§53).

## Known limitations

- Only `equals`/`in` — no comparison operators (`>`, `<`, ranges), no
  boolean combinations beyond implicit AND, no `CALCULATE`/`FILTER`
  context modification.
- Ambiguous or cyclic active relationship graphs fail the *entire*
  evaluation rather than degrading gracefully for the unaffected part of
  the model — intentional per spec, but means one bad relationship can
  block every measure in a larger model until fixed.
- `MIN`/`MAX`-side type restrictions and `DISTINCTCOUNT`'s blank handling
  are documented in `MEASURES.md`, not repeated here.
