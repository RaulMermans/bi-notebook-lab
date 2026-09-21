# Advanced Relationships (Sprint 11)

This document describes Sprint 11's migration from a hardcoded `one-to-many`/
single-direction relationship model to a generic one supporting `1:1`, `1:*`,
`*:*`, single-direction and bidirectional cross-filtering, active/inactive
state, multiple relationships between the same table pair, and directed
ambiguity detection. See [`docs/USERELATIONSHIP.md`](./USERELATIONSHIP.md)
for the runtime-override layer (`USERELATIONSHIP`/`CROSSFILTER`) built on
top of this.

## Why this changed

Sprint 2 deliberately hardcoded `RelationshipCardinality = 'one-to-many'` and
`CrossFilterDirection = 'single'` as single-value literal types — not
optional fields, the *only* possible values. That was the right scope for a
first relationship model, but it cannot express role-playing dimensions
(Order Date vs. Ship Date), 1:1 lookup tables, many-to-many bridge tables, or
bidirectional filtering — all things a Power BI learner needs to encounter.
Sprint 11 replaces the type, not just widens it, per the guardrail: **no
runtime component may continue treating legacy `one`/`many` fields as
authoritative** once hydration has run.

## The canonical relationship contract (`src/domain/model.ts`)

```ts
type RelationshipCardinality = 'one-to-many' | 'one-to-one' | 'many-to-many'
type RelationshipSide = 'left' | 'right'
type CrossFilterDirection = 'left-to-right' | 'right-to-left' | 'both'

interface Relationship {
  id: string
  left: ColumnRef
  right: ColumnRef
  cardinality: RelationshipCardinality
  /** Required only for `one-to-many` — which side is the unique "1" side. */
  oneSide?: RelationshipSide
  crossFilterDirection: CrossFilterDirection
  active: boolean
  createdAt: string
}
```

No field is named `one`/`many` on the canonical type. Every runtime consumer
that needs to know "which side is the one side" (RELATED, fact/dimension
inference, the classic validation rule) goes through the centralized
orientation helpers in `src/runtime/model/relationshipHelpers.ts` —
`relationshipOneEndpoint`/`relationshipManyEndpoint` (only defined for
`one-to-many`), `relationshipEndpoint`, `relationshipOtherSide`,
`relationshipEndpointTables`, `relationshipConnectsColumns`,
`relationshipConnectsTables`, `siblingRelationships` — rather than reading
`.left`/`.right` and re-deriving orientation ad hoc.

## Legacy hydration

A model persisted before Sprint 11 stores relationships as:

```ts
{ id, one: ColumnRef, many: ColumnRef, cardinality: 'one-to-many', crossFilterDirection: 'single', active, createdAt }
```

`hydrateSemanticModel()` (`src/runtime/model/modelRuntime.ts`) detects this
shape via a local type guard (`isLegacyRelationship`) and converts it:

```text
left = one
right = many
oneSide = 'left'
crossFilterDirection = 'left-to-right'
```

This is exactly the old always-single, one→many propagation direction, so a
hydrated Retail model produces numerically identical results to before
Sprint 11 — see `tests/runtime/model/relationshipHydration.test.ts`. Already-
canonical relationships pass through unchanged. Hydration runs on every
`loadModel()` (`src/persistence/modelStore.ts`), so no notebook migration
step is required of the learner.

Two thin convenience wrappers, `createRelationship`/`validateRelationship`
(`{one, many, active?}` shorthand), still exist in `modelRuntime.ts` for
callers that only ever need the classic 1:* single-direction case — they
delegate entirely to `createRelationshipConfig`/`validateRelationshipConfig`
below and never introduce a second runtime representation.

## Cardinality rules

**One-to-many.** One endpoint (`oneSide`) must contain unique values —
checked against real column data at validation time. `crossFilterDirection`
must be either the natural single direction implied by `oneSide` (the "1"
side always naturally filters the "*" side) or `'both'`; the reverse single
direction is rejected with `INVALID_CROSS_FILTER_DIRECTION`.

**One-to-one.** Both endpoints must contain unique values (`LEFT_SIDE_NOT_UNIQUE`/
`RIGHT_SIDE_NOT_UNIQUE`, checked independently). `crossFilterDirection` must
be `'both'` — Power BI does not allow a single-direction 1:1 relationship,
and creating one is blocked with `ONE_TO_ONE_REQUIRES_BOTH`. Unmatched rows
on either side are allowed (a 1:1 relationship is not required to be a
perfect bijection); a non-blocking `ONE_TO_ONE_COVERAGE` info diagnostic
reports the overlap when it's less than 100%.

**Many-to-many.** Neither side requires uniqueness. `crossFilterDirection`
can be `'left-to-right'`, `'right-to-left'`, or `'both'`. Creating a *:*
relationship always emits an informational `MANY_TO_MANY_RELATIONSHIP`
warning — this is a legitimate Power BI feature, but learners should
understand the modeling consequence (aggregated results can double-count).
No foreign-key-style unmatched-key diagnostic is computed for *:* — there is
no primary/foreign key relationship to report on.

## Relationship validation (`validateRelationshipConfig`)

`src/runtime/model/modelRuntime.ts`'s `validateRelationshipConfig` is the
single cardinality-aware validation pipeline (replacing the old
`validateRelationship`), covering, in order: `MISSING_REFERENCE`,
`SELF_RELATIONSHIP`, `COLUMN_TYPE_MISMATCH`, `INVALID_CARDINALITY` (missing/
extraneous `oneSide`), `INVALID_CROSS_FILTER_DIRECTION`,
`ONE_TO_ONE_REQUIRES_BOTH`, per-cardinality uniqueness
(`ONE_SIDE_NOT_UNIQUE`/`LEFT_SIDE_NOT_UNIQUE`/`RIGHT_SIDE_NOT_UNIQUE`),
`DUPLICATE_RELATIONSHIP` (same column pair, either order — via
`relationshipConnectsColumns`), `UNMATCHED_FOREIGN_KEYS` (1:* only),
`ONE_TO_ONE_COVERAGE` (1:1 only, info), `MANY_TO_MANY_RELATIONSHIP` /
`BIDIRECTIONAL_RELATIONSHIP` (pedagogical warnings), and finally
`RELATIONSHIP_CREATES_AMBIGUOUS_PATH` (see below) when the candidate would be
active. `createRelationshipConfig` never partially applies a relationship
that failed validation — the model is returned unchanged alongside the
diagnostics whenever any `error`-severity diagnostic is present.

`updateRelationship` edits an existing relationship's
cardinality/oneSide/crossFilterDirection/active state in place, validated
against the full proposed configuration exactly like creation (excluding the
relationship's own pre-edit state from duplicate/ambiguity checks via an
`excludeRelationshipId` parameter) — never a partially-applied edit.

## Generic filter propagation

The old propagation engine hardcoded a `one -> many` step per relationship.
Sprint 11 replaces this with a generic, edge-based model
(`relationshipPropagationEdges` in `relationshipHelpers.ts`):

```ts
interface RelationshipPropagationEdge {
  relationshipId: string
  sourceModelTableId: string
  sourceColumn: ColumnRef
  targetModelTableId: string
  targetColumn: ColumnRef
  direction: 'left-to-right' | 'right-to-left'
}
```

Every effective relationship (persisted `active`, folded with any runtime
override — see USERELATIONSHIP.md) derives 0, 1 or 2 edges:

| Cardinality    | Direction        | Edges |
|----------------|-------------------|-------|
| `one-to-many`  | single             | 1 (one → many) |
| `one-to-many`  | `both`             | 2 |
| `one-to-one`   | `both` (always)    | 2 |
| `many-to-many` | single             | 1 |
| `many-to-many` | `both`             | 2 |

`src/runtime/measure/filterPropagation.ts`'s `propagate()` walks *this same
edge list* to a fixed point — for every edge, it builds a `foreign key value
-> target row indices` index once (`buildTargetKeyIndex`, cached per edge for
the whole resolution) and intersects it against the source side's currently-
visible key values (`allowedKeysFromSource`). This is exactly the same "key
membership" step regardless of cardinality — `1 → *`, `* → 1`, `1 ↔ 1` and
`* → *` all reduce to it, so there is no cardinality-specific propagation
algorithm to maintain. Row selections only ever shrink during a resolution;
the loop is bounded by `tables.length + edges.length + 1` iterations and, if
that bound is somehow exhausted without reaching a fixed point (which the
monotonic-shrink invariant should make impossible), resolution fails closed
with a `PROPAGATION_DID_NOT_CONVERGE` diagnostic rather than looping forever
or silently returning a partial result.

`PropagationStep` (the trace/diagnostic shape) is now generic:
`{relationshipId, sourceModelTableId, sourceTableName, sourceColumnName,
targetModelTableId, targetTableName, targetColumnName, direction,
targetRowsBefore, targetRowsAfter}` — one contract for every cardinality,
replacing the old `oneTableName`/`manyTableName`/`manyRowsBefore`/
`manyRowsAfter` shape.

## Ambiguity detection — this is the important redesign

The old `ACTIVE_CYCLE` diagnostic ran simple directed-cycle detection on the
`many -> one` graph. **This is retired entirely, not generalized.** A legal
bidirectional relationship (`A ↔ B`) is, by construction, a 2-node directed
cycle in a propagation-edge graph — so simple cycle detection is the wrong
tool once bidirectional cross-filter exists, and would make a completely
legitimate model unusable.

The only thing that *is* a correctness problem is **more than one distinct
directed propagation path between an ordered table pair** — two different
routes a filter could take to reach the same target, which makes the result
ambiguous. This is `AMBIGUOUS_FILTER_PATH` (renamed from the old undirected
`AMBIGUOUS_PATH`, promoted to `error` severity so it still fails closed via
`FILTER_GRAPH_INVALID`).

`findAmbiguousDirectedPairs` (`relationshipHelpers.ts`) builds a directed
adjacency list from `relationshipPropagationEdges`, keeping parallel edges
between the same table pair distinct (two simultaneously-active
relationships between the same two tables — e.g. `OrderDate` + `ShipDate`
both active — are two separate 1-hop paths, not one, and *are* ambiguous).
For every ordered table pair, it counts distinct simple paths (node-simple —
no table revisited within one path, but not edge-deduplicated) via DFS,
stopping at 2 since only ">1" matters.

Examples:

```text
A ↔ B                          -> not ambiguous (exactly one path each direction)
A → B → D, A → C → D           -> AMBIGUOUS_FILTER_PATH for (A, D)
A → B (OrderDate), A → B (ShipDate), both active -> AMBIGUOUS_FILTER_PATH for (A, B)
A → B → C → A (a directed cycle) -> not ambiguous (each ordered pair has exactly one path)
```

`checkFilterGraphValidity` (`filterPropagation.ts`) now only filters model
diagnostics for `AMBIGUOUS_FILTER_PATH` (not the retired `ACTIVE_CYCLE`) to
build `FILTER_GRAPH_INVALID`.

## Active-state validation — fail closed, not a blind flip

`setRelationshipActive` can no longer unconditionally flip a boolean. It
returns `{ model, diagnostics }`: clones the model with the proposed
activation applied, checks `hasAmbiguousDirectedPath` on the *effective*
graph, and — if activating would introduce ambiguity — rejects with
`RELATIONSHIP_CREATES_AMBIGUOUS_PATH`, returning the *original* model
unchanged. Deactivating a relationship never needs this check (it only
removes edges). The same `hasAmbiguousDirectedPath` check runs inside
`createRelationshipConfig` (when the candidate would be created active) and
`updateRelationship`, so the guarantee is uniform across every mutation
path, not just the active-toggle UI control.

## Multiple relationships between the same tables (role-playing dimensions)

Fully supported, and the canonical Sprint 11 scenario:

```text
Calendar[Date] → Sales[OrderDate]   ACTIVE
Calendar[Date] → Sales[ShipDate]    INACTIVE
```

`graphAnalysis.ts`'s `validateModel` surfaces this topology as pedagogical,
non-blocking model-wide diagnostics: `MULTIPLE_RELATIONSHIPS_BETWEEN_TABLES`
(info, any table pair connected by 2+ relationships),
`ROLE_PLAYING_RELATIONSHIP_PATTERN` (info, specifically the "one active, rest
inactive" shape), `INACTIVE_RELATIONSHIP` (info, per inactive relationship —
"won't propagate unless activated via USERELATIONSHIP"), and
`BIDIRECTIONAL_FILTERING_WARNING`/`MANY_TO_MANY_WARNING` (warning, persistent
model-level equivalents of the creation-time `BIDIRECTIONAL_RELATIONSHIP`/
`MANY_TO_MANY_RELATIONSHIP` diagnostics). None of these block evaluation.

## Model health / star-schema recognition

The old "one table only on the many side = fact, one table only on the one
side = dimension" heuristic (`inferFactDimensionRoles`/`computeTableRoles`,
`graphAnalysis.ts`) is now scoped to `one-to-many` relationships only — a
`one-to-one`/`many-to-many`/bidirectional relationship carries no "1
side"/"many side" role and is never counted here. This means a valid
advanced model (role-playing dates, a 1:1 lookup, a *:* bridge table) is
never misdiagnosed as a broken star schema just for using a feature the old
heuristic didn't anticipate, while classic star schemas keep byte-identical
`STAR_SCHEMA_VALID`/`MULTIPLE_FACT_TABLES`/`DIMENSION_ON_MANY_SIDE`
diagnostics (Sprint 1-10 regression, `tests/runtime/model/
factDimensionInference.test.ts`).

## Relationship Lab sample dataset

`src/lib/sample/generateRelationshipLabDataset.ts` — a separate, seeded
generator (Retail's own generator is untouched) exercising every scenario
above with real `DataTable`s:

- `Calendar` (contiguous 2024-2025 daily rows, markable as a Date Table).
- `Sales` (`OrderID, OrderDate, ShipDate, CustomerID, Revenue`) — the
  canonical role-playing fixture; `ShipDate` is always a few days after
  `OrderDate`.
- `Customers` / `CustomerProfile` — the 1:1 fixture (exactly one profile row
  per `CustomerID`, disjoint attribute columns).
- `Products` / `Targets` — the *:* fixture (`Category` repeated on both
  sides across multiple regions).

Loadable from the notebook's "Add your first dataset" / Import Data panel
via "Load Relationship Lab Dataset" (`loadSampleRelationshipLabDataset` in
`src/runtime/data/dataRuntime.ts`), alongside the existing Retail sample.

## Model Canvas & Context Explorer

The relationship edge label is now computed generically
(`relationshipCardinalityLabel` in `src/lib/format/relationshipLabel.ts`,
shared by the Model Canvas and the Context Explorer's propagation diagram):
`1 → *` / `1 ↔ *` / `* ← 1` / `1 ↔ 1` / `* → *` / `* ← *` / `* ↔ *`,
computed from cardinality + direction + `oneSide`. Inactive relationships
keep a dashed line *and* visible "INACTIVE" text (never color alone). When
two relationships connect the same table pair, `ModelCanvas.tsx` offsets
their curvature (`RelationshipEdge.tsx`'s `parallelIndex`) so both stay
independently inspectable, and each edge's title/label shows its endpoint
column names.

`domain/context.ts`'s `ContextRelationshipState` generalizes off the old
hardcoded `one`/`many` naming to `left`/`right` + `cardinality` +
`crossFilterDirection`, and `propagation` is now a list (0-2 entries,
`ContextRelationshipPropagationEntry`) rather than a single before/after
pair, since a bidirectional/1:1 relationship can propagate in both
directions within the same resolution. See
[`docs/CONTEXT_VISUALIZER.md`](./CONTEXT_VISUALIZER.md) for the
`USERELATIONSHIP`/`CROSSFILTER` override-visibility addition.

## RELATED compatibility

`src/expression/relatedLookup.ts`'s `resolveRelatedRelationship` is
cardinality-aware (sprint brief §43-44):

- **`one-to-many`**: unchanged from Sprint 3 — only many→one is ever a valid
  `RELATED` direction (`RELATED_WRONG_DIRECTION` for the reverse).
- **`one-to-one`**: both endpoints are unique, so lookup is valid in either
  direction — no `RELATED_WRONG_DIRECTION` for 1:1.
- **`many-to-many`**: always rejected with `RELATED_UNSUPPORTED_CARDINALITY`
  — `RELATED` never picks an arbitrary matching row.

The actual index-building (`resolveRelatedIndexAndKey` in
`relatedLookup.ts`) is generic: it resolves whichever side matches the
user's requested target column as the index side, and the other side as the
current row's own key column — one implementation for every supported
cardinality, shared by calculated columns (`expression/evaluator.ts`) and
iterator row expressions (`measureEvaluator.ts`/`iteratorEvaluator.ts`).
`RELATED` deliberately ignores `crossFilterDirection` — it is a row-context
lookup concept, not a visual filter-propagation concept.

## Known Power BI compatibility boundaries

- No live re-validation of `AMBIGUOUS_FILTER_PATH` under a
  `USERELATIONSHIP`/`CROSSFILTER` override beyond the table pair the
  override itself touches (see docs/USERELATIONSHIP.md "Known boundaries").
- No `TREATAS`, `NATURALINNERJOIN`/`NATURALLEFTOUTERJOIN`, RLS/security-filter
  direction, composite models, or DirectQuery-specific relationship behavior
  — explicitly out of scope.
- Auto-detect cardinality (`RelationshipForm.tsx`'s "Auto detect" button) is
  a client-side uniqueness probe over already-loaded data, not a persisted
  Power BI "Assume Referential Integrity" setting.
