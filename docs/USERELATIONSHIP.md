# USERELATIONSHIP & CROSSFILTER (Sprint 11)

This document describes Sprint 11's runtime relationship-override layer —
`USERELATIONSHIP` and `CROSSFILTER` as `CALCULATE` filter modifiers. See
[`docs/ADVANCED_RELATIONSHIPS.md`](./ADVANCED_RELATIONSHIPS.md) for the
underlying generic relationship model and propagation engine this builds on,
and [`docs/CALCULATE.md`](./CALCULATE.md) for the `FilterModifier`/
`EffectiveContext` architecture both functions plug into.

## What they do

Both functions temporarily change which relationship is effectively active,
and in which direction it filters, for one `CALCULATE` call — never the
persisted `SemanticModel`. This is exactly the mechanism that makes the
canonical role-playing scenario work:

```text
Calendar[Date] → Sales[OrderDate]   ACTIVE
Calendar[Date] → Sales[ShipDate]    INACTIVE

Orders =
COUNTROWS(Sales)                          -- uses OrderDate (the active relationship)

Orders Shipped =
CALCULATE(
    [Orders],
    USERELATIONSHIP(Sales[ShipDate], Calendar[Date])
)                                          -- uses ShipDate, for this calculation only
```

## Runtime architecture: one override layer, not two

Per the sprint's non-negotiable constraint, `USERELATIONSHIP` and
`CROSSFILTER` share a single implementation — there is no second
relationship-modifier architecture. Both bind to the same `FilterModifier`
variant:

```ts
interface RelationshipOverrideModifier {
  kind: 'RelationshipOverride'
  sourceFunction: 'USERELATIONSHIP' | 'CROSSFILTER'
  relationshipId: string
  action: 'activate' | 'suppress' | 'direction'
  directions?: Exclude<CrossFilterDirection, 'both'>[]
  conflictingRelationshipIds: string[]
  requestedLabel: string
  modelStateLabel: string
  conflictingLabels: string[]
  label: string
}
```

(`src/runtime/measure/contextModifier.ts`, alongside `ReplaceColumnFilter`,
`PredicateFilter`, `RemoveColumns`, `RemoveTables`, `ClearAllFilters` and
`DateTableReplace` — the same union CALCULATE has bound every other filter
argument to since Sprint 8.)

`EffectiveContext` (CALCULATE's per-scope working state) gained a
`relationshipState: EffectiveRelationshipState` field:

```ts
interface EffectiveRelationshipState {
  activatedRelationshipIds: Set<string>
  suppressedRelationshipIds: Set<string>
  directionOverrides: Map<string, Set<'left-to-right' | 'right-to-left'>>
}
```

(`src/runtime/model/relationshipHelpers.ts`). Suppression always wins over
activation (`isRelationshipEffectivelyActive`), and
`relationshipPropagationEdges(model, relationshipState)` — the exact same
edge-derivation function `propagate()` always uses — folds these overrides
in automatically: an activated relationship contributes edges even if
`active: false` on the model; a suppressed one contributes none even if
`active: true`; a direction override replaces the persisted
`crossFilterDirection` for edge derivation.

This is why nested-CALCULATE scoping and cache-context-safety fall out of
existing machinery for free: `cloneEffectiveContext` deep-clones
`relationshipState` (`cloneRelationshipState`) exactly like it already
clones `columnFilters`/`tableSelections` for every nested `CALCULATE` scope
(`measureEvaluator.ts`'s `evaluateCalculate`), and each nested scope gets a
**fresh** `NodeResult` cache (`ctx.cache`) — so a measure reference cached
under a ShipDate override can never leak into a sibling scope evaluated
under OrderDate. See "Cache/context-identity safety" below and
`tests/runtime/measure/relationshipCacheSafety.test.ts`.

The persisted `SemanticModel` is never touched by any of this — `apply
FilterModifier`'s `RelationshipOverride` case only mutates the cloned
`EffectiveContext.relationshipState`.

## USERELATIONSHIP binding (`src/expression/measureBinder.ts#bindUserRelationship`)

`USERELATIONSHIP(Table1[Column], Table2[Column])`:

1. Exactly two arguments, each a fully-qualified physical column reference
   (`ColumnReference` with a non-null table) — not a measure, expression,
   calculated result, or literal. Otherwise `USERELATIONSHIP_COLUMN_REQUIRED`.
   Wrong argument count → `USERELATIONSHIP_INVALID_ARITY`.
2. Resolves the exactly-one relationship connecting the two columns, in
   *either argument order* (`relationshipConnectsColumns`) —
   `USERELATIONSHIP_RELATIONSHIP_NOT_FOUND` / `_AMBIGUOUS_RELATIONSHIP`
   otherwise. The relationship does not need to currently be inactive.
3. For a `one-to-many`/`many-to-many` relationship: `action: 'activate'` —
   force-active, using the relationship's own persisted `crossFilterDirection`
   for edge derivation (no direction narrowing needed).
4. For a `one-to-one` relationship: `action: 'direction'` with exactly one
   direction — "arg2's table filters arg1's table" (bounded, documented
   semantics, not silently `'both'`). Two opposing `USERELATIONSHIP`
   invocations in the same `CALCULATE` call union into both directions being
   active, via the `Set` in `directionOverrides`.
5. `conflictingRelationshipIds` = every sibling relationship connecting the
   same two endpoint tables (`siblingRelationships`) — suppressed alongside
   activation (see "Conflict scope" below).

Used outside `CALCULATE` (a bare top-level call, or as a measure body on its
own), it is rejected with `USERELATIONSHIP_INVALID_CONTEXT` — it does not
return a scalar.

## CROSSFILTER binding (`src/expression/measureBinder.ts#bindCrossFilter`)

`CROSSFILTER(Table1[Column], Table2[Column], direction)`:

The direction argument parses as a bare identifier — a `TableReference` AST
node, exactly the pattern `DATEADD`'s `YEAR`/`QUARTER`/`MONTH`/`DAY`
interval-unit argument already uses (`timeIntelligenceBinder.ts`'s
`bindDateAdd`) — so **no grammar change was needed** for this sprint.

| Direction | Valid for | Effect |
|---|---|---|
| `NONE` | any cardinality | `action: 'suppress'` — disables the relationship for this calculation only, no sibling suppression needed |
| `BOTH` | any cardinality | `action: 'direction'`, both directions |
| `ONEWAY` | `one-to-many` only | `action: 'direction'`, the relationship's natural (one→many) direction |
| `ONEWAY_LEFTFILTERSRIGHT` | `many-to-many` only | `action: 'direction'`, left→right |
| `ONEWAY_RIGHTFILTERSLEFT` | `many-to-many` only | `action: 'direction'`, right→left |

An invalid direction keyword → `CROSSFILTER_INVALID_DIRECTION`. A direction
valid in general but not for the resolved relationship's cardinality (e.g.
`ONEWAY` on a 1:1, or `ONEWAY_LEFTFILTERSRIGHT` on a 1:*) →
`CROSSFILTER_DIRECTION_INVALID_FOR_CARDINALITY`. Column/arity/relationship-
resolution diagnostics mirror `USERELATIONSHIP`'s
(`CROSSFILTER_COLUMN_REQUIRED`/`_INVALID_ARITY`/`_RELATIONSHIP_NOT_FOUND`/
`_AMBIGUOUS_RELATIONSHIP`). Used outside `CALCULATE` →
`CROSSFILTER_INVALID_CONTEXT`.

## Conflict scope (sprint brief §27)

When a modifier activates or redirects a relationship between two endpoint
tables, every *other* relationship connecting those same two tables is
suppressed for that calculation (`siblingRelationships`, resolved once at
bind time) — this is what makes:

```dax
CALCULATE(
    [Revenue],
    USERELATIONSHIP(Sales[ShipDate], Calendar[Date])
)
```

use ShipDate *instead of* OrderDate, not *in addition to* it (an
intersection through both would silently over-filter). Unrelated
relationships (e.g. `Customers → Sales`, `Products → Sales`) are never
touched — suppression is scoped strictly to the endpoint-table pair the
override targets. `CROSSFILTER(..., NONE)` suppresses only the named
relationship itself; there is nothing new being activated, so no sibling
needs suppressing.

This scoping is also *why* no live `AMBIGUOUS_FILTER_PATH` re-validation is
needed per `CALCULATE` call (a deliberate, documented scope boundary — see
"Known boundaries" below): the override structurally prevents more than one
edge-providing relationship from remaining active within the table pair it
touches.

## Nested USERELATIONSHIP / CROSSFILTER

```dax
CALCULATE(
    CALCULATE(
        [Revenue],
        USERELATIONSHIP(Sales[ShipDate], Calendar[Date])
    ),
    USERELATIONSHIP(Sales[OrderDate], Calendar[Date])
)
```

The inner `CALCULATE` clones the outer scope's already-OrderDate-activated
`EffectiveContext`, then applies its own ShipDate override on top — within
the inner scope, ShipDate wins (it's both activated *and* not suppressed,
while OrderDate is now suppressed by the inner modifier's own
`conflictingRelationshipIds`). When the inner `CALCULATE` returns, the outer
scope's `EffectiveContext` is untouched (clone-per-scope, never mutate the
enclosing scope), so any sibling expression in the outer scope still sees
OrderDate active. See `tests/runtime/measure/userelationship.test.ts`'s
"nested CALCULATE" test, which also proves this via a completely separate
`evaluateMeasure` call for a plain `[Total Revenue]` measure under the same
filter — confirming no override state leaked into global/model state.

## USERELATIONSHIP + Time Intelligence

```dax
Shipped Revenue LY =
CALCULATE(
    [Revenue],
    USERELATIONSHIP(Sales[ShipDate], Calendar[Date]),
    SAMEPERIODLASTYEAR(Calendar[Date])
)
```

This composes with **no new implementation** — `computeTimeIntelligenceRowIndexes`
(`runtime/timeIntelligence/timeIntelligenceEvaluator.ts`) only ever reads the
*ambient* (outer, already-resolved) `ResolvedFilterState`; it has no
relationship awareness at all. Because `USERELATIONSHIP` and
`SAMEPERIODLASTYEAR` are two modifiers folded into the *same*
`EffectiveContext` and then resolved together in one
`resolveFilterContextUnchecked` call, the sequence is:

```text
incoming Date context (ambient, outer scope)
  → SAMEPERIODLASTYEAR reads ambient visible dates, computes the LY date set
  → both modifiers applied to nextEffectiveContext (order doesn't matter —
    USERELATIONSHIP only changes relationshipState, DateTableReplace only
    changes Calendar's own tableSelections; they don't read each other)
  → resolveFilterContextUnchecked resolves the modified context ONCE
  → propagate() reads relationshipState: ShipDate is the effective edge for
    Calendar<->Sales, OrderDate is suppressed
  → Calendar's LY-shifted row selection propagates through ShipDate to Sales
  → Revenue aggregates over exactly those rows
```

Verified end-to-end in `tests/runtime/measure/userelationship.test.ts`
("USERELATIONSHIP composes with SAMEPERIODLASTYEAR") — the acceptance test
the sprint brief calls out explicitly, with independently hand-derived
expected values from raw fixture rows, not re-derived through the engine
under test.

## Cache/context-identity safety

Relationship overrides are part of `EffectiveContext`, which is exactly what
determines a `CALCULATE` scope's `NodeResult` cache identity — each scope
gets a **fresh** cache (`measureEvaluator.ts`'s `evaluateCalculate`:
`cache: new Map()`), so a value computed for `[Total Revenue]` under a
ShipDate override can never be reused for the same measure reference under
an OrderDate override, even within one `evaluateMeasure` call. Verified by
`tests/runtime/measure/relationshipCacheSafety.test.ts`, which combines two
differently-overridden `CALCULATE` scopes referencing the same measure via
subtraction — a cache-identity bug would produce a constant wrong answer
(the two sides cancelling out) regardless of the underlying data; the actual
runtime correctly produces the real difference for three different filter
contexts.

## Execution trace

New trace node kinds (`src/expression/trace.ts`): `relationship-override`,
`userelationship`, `crossfilter`. `measureEvaluator.ts`'s
`buildModifierTraceNode` renders the "Requested / Model state / Effective
state / Suppressed" shape:

```text
USERELATIONSHIP
Requested:        Calendar[Date] ↔ Sales[ShipDate]
Model state:       Inactive
Effective state:   Active for this calculation
Suppressed:        Calendar[Date] ↔ Sales[OrderDate]
```

surfaced in the Context Explorer via `ContextDetailsPanel.tsx`'s
`overrideReason` display — see
[`docs/CONTEXT_VISUALIZER.md`](./CONTEXT_VISUALIZER.md#userelationship--crossfilter-sprint-11).

## Known boundaries

- **No live `AMBIGUOUS_FILTER_PATH` re-validation per `CALCULATE` call.**
  The conflict-scope suppression (above) structurally prevents an override
  from creating ambiguity *within the table pair it touches*, but a deep
  composition across unrelated relationships elsewhere in the graph is not
  independently re-checked at override-application time. This is a
  deliberate, bounded scope decision for a learning tool, not a silent gap —
  documented here rather than implemented, per the sprint's "do not start
  Sprint 12 early" guardrail.
- 1:1 `USERELATIONSHIP` direction semantics are bounded exactly as described
  above (arg2 filters arg1) — this does not attempt to model every possible
  Power BI 1:1 relationship-argument edge case.
- No `TREATAS`, `CALCULATETABLE`, `KEEPFILTERS`, `ALLEXCEPT`, `ALLSELECTED` —
  explicitly out of scope (still rejected via
  `UNSUPPORTED_CALCULATE_ADJACENT_FUNCTIONS`).
