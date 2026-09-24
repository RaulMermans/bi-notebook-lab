# CALCULATE & Filter Context Modification (Sprint 8)

Sprint 4 proved `FilterContext` + relationship propagation + aggregation on
an *externally supplied* context. Sprint 8 lets a measure **modify its own
filter context** with `CALCULATE`, `FILTER`, `REMOVEFILTERS` and `ALL` — the
step that turns this from "basic DAX practice" into "real filter-context
manipulation practice." This document covers CALCULATE semantics, the
boolean-expression grammar it's built on, the context-modification
architecture, and known DAX compatibility limitations. See
[`EXPRESSION_ENGINE.md`](./EXPRESSION_ENGINE.md) for the shared
parser/AST/binder pipeline and [`MEASURES.md`](./MEASURES.md)/
[`FILTER_CONTEXT.md`](./FILTER_CONTEXT.md) for the Sprint 4 foundation this
builds on.

## Pipeline

```text
Expression AST (+ ComparisonExpression, LogicalExpression — src/expression/ast.ts)
        │
bindMeasureExpression()  (src/expression/measureBinder.ts)
        │
        ├── CALCULATE(expr, filters...)  →  BoundCalculate { expression, modifiers: FilterModifier[] }
        │     each filter argument bound via src/runtime/measure/booleanFilter.ts
        │     (bindPredicateExpression) into a FilterModifier (src/runtime/measure/contextModifier.ts)
        │
        └── everything else → same BoundMeasureExpression tree as Sprint 4
                (Comparison/Logical added as general scalar-boolean nodes too)
        │
measureEvaluator.ts#evaluateCalculate()
        │
        ├── clone the enclosing EffectiveContext (contextModifier.ts)
        ├── apply each FilterModifier in argument order (applyFilterModifier)
        ├── resolveFilterContextUnchecked() → the modified ResolvedFilterState
        └── evaluate the inner expression under that modified state,
            with a FRESH per-scope measure-reference cache
```

## `=` is comparison, not assignment

Inside an expression, `=` is always a comparison:

```DAX
Customers[Country] = "Spain"
```

Measure-name assignment (`Spain Revenue =`) is UI/domain metadata handled
entirely outside the expression parser, exactly as before — the parser never
sees it.

## Operator precedence

```text
()
unary -
* /
+ -
< <= > >=
= <>
&&
||
```

(highest to lowest binding). Same-precedence operators are left-associative.
This is a pure grammar *addition*: no arithmetic expression that parsed
before Sprint 8 parses differently now (`tests/expression/parser.test.ts`
still passes unchanged; `tests/expression/booleanParser.test.ts` covers the
new grammar and precedence explicitly).

## AST additions (`src/expression/ast.ts`)

```ts
interface ComparisonExpressionNode { kind: 'ComparisonExpression'; operator: '='|'<>'|'>'|'>='|'<'|'<='; left; right }
interface LogicalExpressionNode    { kind: 'LogicalExpression';    operator: '&&'|'||'; left; right }
```

`CALCULATE`, `FILTER`, `REMOVEFILTERS` and `ALL` are **not** new AST node
kinds — they parse as ordinary `FunctionCallNode`s through the existing
grammar, exactly like `SUM`/`DIVIDE`. No CALCULATE-specific parser grammar
was added, per the sprint brief.

## Boolean runtime

`&&`/`||` short-circuit; comparisons never silently coerce a string to a
number. Documented blank-comparison semantics (a deliberate simplification,
not full DAX blank coercion — see `src/runtime/measure/booleanFilter.ts`):

- `=`: `BLANK = BLANK` is `true`; `BLANK` compared to anything else is `false`.
- `<>`: the exact negation of `=` above.
- `> >= < <=`: **any** comparison involving a blank operand is never `true`.
- Comparing two non-blank values of different JS types never coerces: `=` is
  `false`, `<>` is `true`, relational operators are `false`.

A comparison/logical expression is also a valid **general scalar measure
result** outside CALCULATE (e.g. `[Total Revenue] > 100` as a measure body,
mirroring real DAX) — `BoundMeasureComparison`/`BoundMeasureLogical` in
`measureBinder.ts`.

## CALCULATE binding (`src/expression/measureBinder.ts#bindCalculate`)

```DAX
CALCULATE(expression, filter1, filter2, ...)
```

- First argument: any bound scalar measure expression (a measure reference,
  an aggregation, arithmetic, `DIVIDE`, even a nested `CALCULATE`).
- Remaining arguments (zero or more): filter modifiers, applied **in
  argument order** against a running `EffectiveContext` (see below).
- `CALCULATE()` (zero arguments) is rejected with `INVALID_CALCULATE_ARITY`.
  `CALCULATE(expr)` with no filter arguments is valid and must equal `expr`'s
  own unfiltered/current-context result (sprint brief §53 — see the
  `MANDATORY REGRESSION` tests in `tests/runtime/measure/calculate.test.ts`
  and `tests/runtime/validation/measureValidation.test.ts`).

Each filter argument is bound as one of:

| Argument shape | Modifier | 
| --- | --- |
| `Table[Column] = literal` | `ReplaceColumnFilter` (a canonical `ColumnFilter`) |
| any other single-table comparison, incl. `&&`/`\|\|` composition | `PredicateFilter` (`tableWide: false` — scoped to the columns it references) |
| `FILTER(Table, predicate)` | `PredicateFilter` (`tableWide: true` — replaces the whole table's context) |
| `REMOVEFILTERS(Table[Column], ...)` | `RemoveColumns` |
| `REMOVEFILTERS(Table)` | `RemoveTables` |
| `REMOVEFILTERS()` | `ClearAllFilters` |
| `ALL(Table[Column])` | `RemoveColumns` (ALL ≈ remove filters, sprint brief §26) |
| `ALL(Table)` | `RemoveTables` |

`ALLEXCEPT`, `ALLSELECTED` and `CALCULATETABLE` are explicitly rejected with
`UNSUPPORTED_FUNCTION` wherever they appear (as a CALCULATE filter argument
or standalone) — never silently interpreted as ordinary filtering.
**`USERELATIONSHIP` and `CROSSFILTER` are now supported** (Sprint 11) as a
third filter-modifier row in the table above's family — see "Sprint 11
addendum" below and [`docs/USERELATIONSHIP.md`](./USERELATIONSHIP.md) for
the full design. **`KEEPFILTERS` is now supported** (Sprint 15), bounded to
a direct equality shape — see "KEEPFILTERS (Sprint 15)" below.

### Boolean filter argument rules (`src/runtime/measure/booleanFilter.ts`)

A direct CALCULATE boolean filter (or `FILTER`'s predicate) must:

- reference physical columns from **one table** only
  (`BOOLEAN_FILTER_MULTIPLE_TABLES` otherwise; `FILTER`'s predicate is
  additionally scoped to its explicit table argument —
  `FILTER_ROW_CONTEXT_VIOLATION` for a cross-table reference, no implicit
  relationship traversal);
- never reference a measure (`BOOLEAN_FILTER_MEASURE_REFERENCE` — a
  bracket-only `[Name]` inside a filter predicate always looks like a
  measure reference in measure-mode grammar);
- never contain a nested `CALCULATE` (`BOOLEAN_FILTER_NESTED_CALCULATE`);
- produce a boolean shape — a comparison, a `&&`/`\|\|` combination, or a
  boolean literal (`FILTER_PREDICATE_NOT_BOOLEAN` otherwise).

Column/table names are resolved to stable `ColumnRef`/`ModelTable` ids at
bind time, same as every other binder in this codebase — never kept as
strings for execution.

## Context-modification architecture (`src/runtime/measure/contextModifier.ts`)

This is a **separate layer from `mergeFilterContexts`** (`filterContext.ts`,
Sprint 7). They solve different problems:

- `mergeFilterContexts`: combines two *external* `FilterContext`s (notebook
  context + a Visual's own per-member filter) with **intersection**
  semantics on the same column — correct for combining independent filters
  that should all apply together.
- `contextModifier.ts`: CALCULATE's own bookkeeping, with **replacement**
  semantics on the same column — correct for "this measure's `CALCULATE`
  overrides whatever the outside world says about this column."

```ts
interface EffectiveContext {
  columnFilters: Map<string, ColumnFilter>              // one entry per column, replaceable
  tableSelections: Map<string, EffectiveTableSelection>  // FILTER/inequality-derived row subsets
}
```

`FilterModifier` values (`ReplaceColumnFilter | PredicateFilter |
RemoveColumns | RemoveTables | ClearAllFilters`) are applied one at a time by
`applyFilterModifier(model, datasets, ctx, modifier, ambientState)`, which
centralizes every mutation — no ad hoc `.filter()` calls scattered through
the evaluator (sprint brief §48).

### Same-column replacement

```text
External: Customers[Country] = France
CALCULATE: Customers[Country] = "Spain"
→ Spain (not blank from France ∩ Spain)
```

`ReplaceColumnFilter` **deletes** any existing entry for that column key
before installing the new one — it is not appended alongside the old value
the way `mergeFilterContexts` or plain `FilterContext` accumulation would.
This is the single most important Sprint 8 behavior — see
`tests/runtime/measure/calculate.test.ts`'s "same-column replacement" and
"unrelated filters survive" suites, and the Retail-sample equivalents in
`tests/runtime/measure/calculateRetailSample.test.ts`.

### `FILTER` and the ambient context

`FILTER(Table, predicate)` and a direct inequality filter both scan the
table's rows using the **enclosing scope's already-resolved
`ResolvedFilterState`** (the ambient context *before* this `CALCULATE` call's
own modifiers run) — not the raw unfiltered physical table, and not a
context updated by sibling modifiers processed earlier in the same
`CALCULATE` call. Concretely: `matched = { row | ambientVisible(row) &&
predicate(row) }`.

This is what makes "External `Products[Category] = Electronics`, then
`CALCULATE(..., FILTER(Products, Products[UnitPrice] > 100))`" automatically
return the *intersection* (sprint brief §51) with no separate intersection
logic needed — the FILTER scan already only sees Electronics rows.

### Table-wide vs. column-scoped replacement

- A direct boolean filter argument (`Products[Price] > 50`, or a `&&`/`\|\|`
  composition passed directly to `CALCULATE`) replaces filters **only on the
  columns it references** (`PredicateFilter.tableWide = false`) — unrelated
  columns on the same table are untouched.
- `FILTER(Table, predicate)` replaces **every** filter currently on `Table`
  (`tableWide = true`), matching real DAX's table-argument replacement
  behavior. This is a deliberate, documented, bounded choice (sprint brief
  §51 "be deliberate... document bounded behavior") rather than trying to
  infer exactly which of `Table`'s columns the predicate "really" touches.

`REMOVEFILTERS(Column)`/`ALL(Column)` can undo a column-scoped `PredicateFilter`
(it tracks `scopeColumns`), but does not touch a table-wide `FILTER`-derived
selection — only `REMOVEFILTERS(Table)`/`ALL(Table)`/`REMOVEFILTERS()` do.
Documented, bounded limitation.

### Modifier ordering

Filter arguments apply **sequentially, left to right**, each mutating the
running `EffectiveContext`:

```DAX
CALCULATE(
    [Total Revenue],
    REMOVEFILTERS(Customers[Country]),
    Customers[Country] = "Spain"
)
```

`REMOVEFILTERS` clears Country first; the equality then sets it to Spain —
deterministic, and matches real DAX's practical outcome for this exact
pattern. See `tests/runtime/measure/calculate.test.ts`'s "Modifier ordering"
suite.

## `FILTER` row context and table-selection representation

`FILTER(Table, predicate)`'s predicate is evaluated once per row of `Table`
using the *actual row values* (`evaluatePredicateForRow` in
`booleanFilter.ts`) — the same "one row at a time" mental model as Sprint 3's
`RowContext`, not a second concept of "current row." A naked reference to a
different table inside `FILTER`'s predicate is rejected
(`FILTER_ROW_CONTEXT_VIOLATION`) rather than implicitly relationship-traversed.

The matched row subset is represented at runtime as a plain `Set<number>` of
row indexes (`EffectiveTableSelection.includedRowIndexes`) — never persisted,
never forced into a lossy `ColumnFilter` value list. `filterPropagation.ts`
was extended with one new capability to consume it:

```ts
resolveFilterContextUnchecked(model, datasets, filterContext, tableSelections?: Map<modelTableId, Set<number>>)
```

`tableSelections`, when given, **seeds** a table's starting row selection
(instead of the `'all'` default) before ordinary `ColumnFilter`s and
relationship propagation run — so a `FILTER`-derived Products subset both
AND-combines with any ordinary column filter on Products *and* propagates
through the existing `1 → *` relationship-propagation loop with **zero
changes to `propagate()` itself** (sprint brief §21/§50). No second
aggregation or relationship engine was introduced.

`resolveFilterContext` (the existing Sprint 4 public entry point) is
unchanged in its default-argument behavior — it now delegates to
`resolveFilterContextUnchecked` after its usual `FILTER_GRAPH_INVALID`
graph-validity check. That check (`checkFilterGraphValidity`) is a pure
function of `model`, independent of any `FilterContext`, so `evaluateMeasure`
runs it **once** per call and every nested `CALCULATE` within that call skips
it — avoiding repeated `validateModel` recomputation for deeply-nested or
grouped-Visual evaluation (sprint brief §68).

## Measure dependencies and the context-safe cache

`Spain AOV = CALCULATE([Average Order Value], Customers[Country] = "Spain")`
must recompute **both** of AOV's own dependencies (`[Total Revenue]`,
`[Orders]`) under the Spain-modified context, not just AOV's own top-level
aggregation. This works because `evaluateNode`'s recursive calls always pass
the *same* `MeasureEvalContext` object down through the expression tree —
when that context is `calcCtx` (the one `evaluateCalculate` builds), every
nested `MeasureReference`/`Aggregation` sees `calcCtx.filterState`, with no
special-casing needed per node kind.

**Critical cache rule** (sprint brief §32/§64): `MeasureEvalContext.cache`
(the per-evaluation measure-reference cache from Sprint 4) is **fresh** for
every `CALCULATE`-modified scope — `evaluateCalculate` always constructs a
`new Map()` rather than inheriting the enclosing scope's cache. A measure
referenced under an external France context and *also* referenced inside a
`CALCULATE(..., Country = "Spain")` in the same evaluation therefore
recomputes independently for each context; neither can return the other's
cached value. `visiting` (cycle detection) and `columnValuesCache` (raw
column value vectors, which don't depend on filter context) **are** shared
across nested scopes — only the context-dependent measure-result cache is
scoped per `CALCULATE` call. See the "context-safe cache" test in
`tests/runtime/measure/calculate.test.ts`.

## Nested CALCULATE

```DAX
CALCULATE(
    CALCULATE([Total Revenue], Products[Category] = "Furniture"),
    Customers[Country] = "Spain"
)
```

Works because `Calculate` is just another `BoundMeasureExpression` node kind:
the outer `CALCULATE`'s inner expression is itself a `Calculate` node, so
`evaluateNode` recurses naturally. The inner `CALCULATE` clones and builds on
the **outer's already-modified** `EffectiveContext` (whatever context it's
evaluated *in*), so the two filters compose as "Spain AND Furniture," not one
replacing the other. No nesting depth limit is enforced explicitly (the same
`visiting` cycle guard bounds runaway recursion through measure references).

## Context transition boundary

Sprint 8 supports `CALCULATE` **in measure context only**. Using `CALCULATE`
inside a **calculated column** expression is still rejected at bind time with
a dedicated `CALCULATE_CONTEXT_TRANSITION_NOT_SUPPORTED` diagnostic
(`src/expression/binder.ts`) rather than either (a) silently doing nothing
sensible, or (b) implementing real DAX's row-context → filter-context
transition, which remains out of scope. This is a deliberate, documented
limitation, not an oversight — see sprint brief §34's "prefer a structured
diagnostic unless the transition can be made rigorous." Sprint 9 *does* add a
different, narrower row-context → filter-context transition — for a measure
referenced inside an iterator's row expression (`SUMX(Products, [Total
Revenue])`) — see [`docs/ITERATORS.md`](./ITERATORS.md) "Implicit context
transition." That mechanism is iterator-specific and does not lift this
calculated-column restriction.

## `ALL` scope limitation

Sprint 8 supports `ALL` **only** as a `CALCULATE` filter modifier
(`ALL(Table)` / `ALL(Table[Column])`, both ≈ "remove filters"). Sprint 9 does
**not** extend `ALL` into a general table-returning expression usable outside
`CALCULATE` (e.g. as a `SUMX` iterator source) — `FILTER`/`VALUES`/`DISTINCT`
became reusable table expressions (see
[`docs/TABLE_EXPRESSIONS.md`](./TABLE_EXPRESSIONS.md)), but `ALL` still only
works as a CALCULATE filter modifier; using it anywhere else falls back to the
"only supported as a CALCULATE filter argument" `UNSUPPORTED_FUNCTION`
diagnostic. A future sprint could fold `ALL` into the same
`BoundTableExpression` abstraction (it's structurally "remove the FILTER
applied to a table"), but Sprint 9 didn't need it to satisfy the iterator
foundation and deliberately left it alone.

## Sprint 9: FILTER became a shared table-expression primitive

CALCULATE's `FILTER(Table, predicate)` filter modifier (`bindFilterFunction` in
`src/expression/measureBinder.ts`) now binds through the same
`bindTableExpression` (`src/runtime/tableExpression/tableExpressionBinder.ts`)
that `COUNTROWS`/`SUMX`/etc. use, and `applyFilterModifier`'s `PredicateFilter`
case (`src/runtime/measure/contextModifier.ts`) evaluates the matched rows
through the same `evaluateTableExpression`
(`src/runtime/tableExpression/tableExpressionEvaluator.ts`) that a standalone
`SUMX(FILTER(...), ...)` uses. This is a refactor into a reusable
abstraction, not a semantic rewrite — every example on this page and every
Sprint 8 test still passes unchanged. See
[`docs/TABLE_EXPRESSIONS.md`](./TABLE_EXPRESSIONS.md) for the full design.

## Sprint 11 addendum: USERELATIONSHIP/CROSSFILTER as a new FilterModifier

`USERELATIONSHIP`/`CROSSFILTER` are now real `CALCULATE` filter modifiers,
documented in full in [`docs/USERELATIONSHIP.md`](./USERELATIONSHIP.md) —
this section is a concise pointer plus the one CALCULATE-specific
architectural note.

Both bind to a new `FilterModifier` variant,
`RelationshipOverrideModifier` (`kind: 'RelationshipOverride'`,
`src/runtime/measure/contextModifier.ts`), alongside `ReplaceColumnFilter`/
`PredicateFilter`/`RemoveColumns`/`RemoveTables`/`ClearAllFilters`/
`DateTableReplace` — the same union every other `CALCULATE` filter argument
has bound to since Sprint 8. **No new `FilterModifier` dispatch pattern was
needed**: `applyFilterModifier`'s existing `switch (modifier.kind)` in
`contextModifier.ts` simply gained one more case, mutating
`EffectiveContext`'s new `relationshipState` field exactly the way every
other case already mutates `columnFilters`/`tableSelections`. Modifier
ordering, nested-`CALCULATE` scoping (`cloneEffectiveContext` now also
deep-clones `relationshipState`), and the context-safe fresh-cache rule all
apply to `RelationshipOverride` unchanged — no relationship-specific
exception to any of this document's existing rules was required.

New diagnostic codes: `USERELATIONSHIP_COLUMN_REQUIRED`,
`USERELATIONSHIP_INVALID_ARITY`, `USERELATIONSHIP_RELATIONSHIP_NOT_FOUND`,
`USERELATIONSHIP_AMBIGUOUS_RELATIONSHIP`, `USERELATIONSHIP_INVALID_CONTEXT`,
`CROSSFILTER_COLUMN_REQUIRED`, `CROSSFILTER_INVALID_ARITY`,
`CROSSFILTER_RELATIONSHIP_NOT_FOUND`, `CROSSFILTER_AMBIGUOUS_RELATIONSHIP`,
`CROSSFILTER_INVALID_DIRECTION`,
`CROSSFILTER_DIRECTION_INVALID_FOR_CARDINALITY`,
`CROSSFILTER_INVALID_CONTEXT`. See
[`docs/USERELATIONSHIP.md`](./USERELATIONSHIP.md) for the full binding
rules, the conflict-scope (sibling-relationship suppression) design, the
`USERELATIONSHIP` + `SAMEPERIODLASTYEAR` composition walkthrough, and known
boundaries.

## KEEPFILTERS (Sprint 15)

Real DAX's `KEEPFILTERS` changes a `CALCULATE` filter argument from its
normal same-column **replace** behavior to same-column **intersect**.
Sprint 15 implements this, deliberately bounded to the single shape a
learner is most likely to reach for:

```DAX
KEEPFILTERS(Table[Column] = value)
```

Only a direct equality inside `KEEPFILTERS` is supported. Anything richer —
a comparison other than `=`, a compound `&&`/`||` predicate — is rejected
with `UNSUPPORTED_KEEPFILTERS_SHAPE` rather than silently falling back to
plain replacement or misinterpreting the shape. `bindKeepFilters`
(`src/expression/measureBinder.ts`) is a new case inside
`bindCalculateFilterArgument`'s dispatch, checked *before* the pre-existing
`UNSUPPORTED_CALCULATE_ADJACENT_FUNCTIONS` rejection set — that set still
correctly rejects a **standalone** `KEEPFILTERS(...)` used outside
`CALCULATE`; that generic-function-call path was deliberately left
untouched.

Implementation: a new optional `keepFilters?: boolean` flag on
`ReplaceColumnFilterModifier` (`src/runtime/measure/contextModifier.ts`) —
mirroring the pre-existing `PredicateFilterModifier.tableWide` flag
precedent ("a flag on the modifier changes fold-in behavior," not a whole
new `FilterModifier` kind). In `applyFilterModifier`'s `ReplaceColumnFilter`
case, when the flag is set, it looks up any existing `ColumnFilter` on that
column and **intersects** the value sets — reusing the exact same
same-column intersection arithmetic `mergeFilterContexts` already
implements in `filterContext.ts`, not a second implementation. When there is
no pre-existing filter on that column, it behaves identically to a plain
replace.

**Verified live in the browser**, against the Retail sample, with an
ambient `Customers[Country] = France` filter applied:

```DAX
CALCULATE([Total Revenue], Customers[Country] = "Spain")
```

returns Spain's revenue — plain replace, France is discarded outright —
while

```DAX
CALCULATE([Total Revenue], KEEPFILTERS(Customers[Country] = "Spain"))
```

under the identical ambient filter returns BLANK: France ∩ Spain is empty,
and the execution trace shows `Customers[Country]` equals narrowing 120 → 0
rows.

## Variables inside CALCULATE (Sprint 15)

`VAR`/`RETURN` works around and inside a `CALCULATE` call — as the
expression argument, or wrapping the whole `CALCULATE` call from outside —
exactly like any other position the ordinary expression binder reaches. It
does **not** work inside a `CALCULATE` filter-predicate argument itself
(that's the separate, narrower `booleanFilter.ts` binder). See
[`EXPRESSION_ENGINE.md`](./EXPRESSION_ENGINE.md) "Variables (VAR/RETURN)"
for the full grammar, scoping rules, and the critical rule that a
variable's value is captured once and is immune to a later `CALCULATE`
context transition (verified live: `VAR Outer = [Total Revenue] RETURN
CALCULATE(Outer, Customers[Country] = "Spain")` returns the full,
unfiltered `Total Revenue`, not the Spain-filtered one).

## Execution trace (`src/expression/trace.ts`)

Five new `TraceNodeKind`s, all real runtime output (never reconstructed from
source text):

```ts
type TraceNodeKind = ... | 'calculate' | 'filter-modifier' | 'boolean-filter' | 'table-filter' | 'remove-filters'
```

A `calculate` node's children, in order:

1. `filter-context` labeled "Incoming context" — the enclosing scope's own
   resolved trace (its direct filters + propagation steps).
2. One `boolean-filter` (a `ReplaceColumnFilter`/column-scoped
   `PredicateFilter`) or `table-filter` (a table-wide `PredicateFilter`, i.e.
   `FILTER(...)`, with `tableName`/`inputRows`/`rowsMatched` metadata) or
   `remove-filters` (with a `removed: string[]` metadata list) node per
   filter argument, in argument order.
3. `filter-context` labeled "Modified context" — the freshly resolved
   `ResolvedFilterState` after every modifier has applied (its own direct
   filters/propagation steps, including any relationship propagation
   triggered by a `FILTER`-derived table selection).
4. The inner expression's own trace (an `aggregation`, another `calculate`,
   etc.).

This renders through the existing generic `TraceNodeView` component
(`components/notebook/shared/TraceTree.tsx`) with zero changes — it already
recurses through `children` generically by `kind`.

## Context Explorer integration

`evaluateMeasure`'s returned `MeasureExecution.filterState` normally reflects
the *external* `FilterContext` it was called with (Sprint 4-7 behavior,
unchanged). Sprint 8 adds one bounded exception: **when the measure's own
top-level bound expression is a `Calculate` node (directly, or through a
chain of plain measure references), `filterState` instead reflects the
`CALCULATE`-modified context** — so the Context Explorer's
tables/relationships diagram for `Spain Revenue` shows "Country = Spain,
Customers 3 → 2 rows," not the external France slicer's numbers, distinctly
surfacing the internal CALCULATE modification rather than hiding it (sprint
brief §38-§39). See `tests/runtime/context/calculateContext.test.ts`.

**Documented bounded limitation**: this substitution only happens for a
measure whose entire top-level result *is* one `CALCULATE` (or a pass-through
reference to one). A measure like `Revenue % All Countries = DIVIDE([Total
Revenue], CALCULATE(...))`, whose top level is a `DIVIDE`, still shows the
*external* context in its diagram — the internal `CALCULATE` is still fully
visible in the execution trace (never hidden), just not promoted to the
top-level diagram. A single filter-state diagram cannot faithfully represent
an expression that combines two different filter contexts (e.g. `[Spain
Revenue] - [France Revenue]`); per-node context breakdown is future work.

`graphAdapter.ts#buildTableStates` also gained one small, backward-compatible
fallback: a table whose `visibleRows < totalRows` with no `ColumnFilter`-based
`directFilters` entry (only possible now, from a `FILTER`/inequality-derived
table selection) is now labeled `'direct'` instead of `'unfiltered'`, so the
state badge and the percentage stay visually consistent. The *why* (which
predicate did it) is only in the execution trace, not this summary — a
documented, bounded gap (sprint brief §49's caution against forcing
`FILTER`'s richer semantics into a lossy summary shape applies here too).

## Visual Cells integration

No visual-specific `CALCULATE` code exists anywhere in `runtime/visual/*`.
Every `KPI`/`Table`/`Bar`/`Line` still calls the unmodified `evaluateMeasure`
— a `CALCULATE`-based measure "just works" the moment it's created, including
the slicer-override case (a `Country = France` Slicer's `FilterContext` is
passed straight through, and `Spain Revenue`'s own `CALCULATE` replaces it
internally) and the grouped-Visual case (a Bar chart's per-category filter
merges via the *unchanged* `mergeFilterContexts`, which only ever sees the
*external* `FilterContext` — `CALCULATE`'s internal Country override happens
one layer further in, inside `evaluateMeasure`, invisible to and unaffected
by the merge). See `tests/runtime/visual/calculateVisual.test.ts`.

## Validation engine compatibility

`runtime/validation/measureValidation.ts`'s numeric-result rule needed **zero
changes** — it already calls the real `evaluateMeasure`, so a `CALCULATE`
measure validates exactly like a Sprint 4 one. The one behavior sprint brief
§53 asks to guarantee (`SUM(...)` and `CALCULATE(SUM(...))` agree on an
unfiltered result) is covered as a named regression test in both
`tests/runtime/measure/calculate.test.ts` and
`tests/runtime/validation/measureValidation.test.ts`.

`runtime/validation/semanticValidation.ts`'s AST-traversal helpers
(`collectFunctionNames`/`collectBracketNames`/`collectColumnReferences`) were
extended with one line each to recurse into the two new AST node kinds
(`ComparisonExpression`/`LogicalExpression`) — `uses-function` now correctly
detects `CALCULATE`/`FILTER`/`REMOVEFILTERS`/`ALL` the same way it already
detected `SUM`/`DIVIDE`, since they're all just `FunctionCallNode`s.

## Retail examples (`src/lib/sample/generateRetailDataset.ts`)

Verified end-to-end against the real bundled Retail sample in
`tests/runtime/measure/calculateRetailSample.test.ts`:

```DAX
Spain Revenue =
CALCULATE([Total Revenue], Customers[Country] = "Spain")

Revenue All Countries =
CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country]))

Revenue % All Countries =
DIVIDE([Total Revenue], CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country])))

All Product Revenue =
CALCULATE([Total Revenue], ALL(Products))

Premium Product Revenue =
CALCULATE([Total Revenue], FILTER(Products, Products[UnitPrice] > 100))
```

`Products[UnitPrice]` is a real numeric column in the generated dataset
(`UnitCost` × a 1.3–2.2 markup, see `generateRetailDataset.ts`), so the
`FILTER` threshold genuinely partitions the catalog rather than matching
everything or nothing.

## Known DAX compatibility limitations

- **No context transition**: `CALCULATE` (and its filter modifiers) work in
  measure context only — see "Context transition boundary" above.
- **`ALL` is CALCULATE-modifier-only** — not a general table expression yet.
- **`FILTER`'s table-wide replacement is a bounded simplification**: it
  replaces *every* filter on the named table, not just the columns its
  predicate happens to touch (real DAX is more nuanced here) — see
  "Table-wide vs. column-scoped replacement" above.
- **`REMOVEFILTERS`/`ALL(Column)` cannot partially undo a multi-column
  predicate selection**: removing any one of several columns a compound
  direct filter (`Price > 50 && Category = "X"`) referenced removes the
  *whole* resulting table selection, not just that column's contribution.
- **No `ALLEXCEPT`, `ALLSELECTED`, `CALCULATETABLE`** — explicitly rejected
  with `UNSUPPORTED_FUNCTION`, never silently misinterpreted.
  **`USERELATIONSHIP`/`CROSSFILTER` are now implemented** (Sprint 11) — see
  "Sprint 11 addendum" below and
  [`docs/USERELATIONSHIP.md`](./USERELATIONSHIP.md). **`KEEPFILTERS` is now
  implemented** (Sprint 15), bounded to a direct equality shape — see
  "KEEPFILTERS (Sprint 15)" below.
- **Blank comparison semantics are simplified** — see "Boolean runtime"
  above; real DAX's blank-coercion rules (e.g. blank treated as 0 in some
  arithmetic contexts) are not replicated.
- **No cross-type coercion** in comparisons (`"10" = 10` is `false`, not
  `true`) — a deliberate simplification per sprint brief §52, not a bug.
- **Context Explorer's diagram substitution is top-level-only** — see
  "Context Explorer integration" above.
- **`SUMX`/`AVERAGEX`/`MINX`/`MAXX`/`COUNTX`, `VALUES`/`DISTINCT`,
  `SELECTEDVALUE`, `IF`/`SWITCH`/`BLANK` are now implemented** — see
  [`docs/ITERATORS.md`](./ITERATORS.md) and
  [`docs/TABLE_EXPRESSIONS.md`](./TABLE_EXPRESSIONS.md) (Sprint 9).
- **Classic Date Table time intelligence is now implemented** (Sprint 10):
  `SAMEPERIODLASTYEAR`, `DATEADD`, `PREVIOUSMONTH`, `PREVIOUSYEAR`,
  `DATESYTD` and `TOTALYTD` — see
  [`docs/DATE_TABLES.md`](./DATE_TABLES.md) and
  [`docs/TIME_INTELLIGENCE.md`](./TIME_INTELLIGENCE.md), including the new
  `DateTableReplace` `FilterModifier` variant this section's "Modifier
  ordering"/"Table-wide vs. column-scoped replacement" rules extend to.
- **Generic relationships (1:1, *:*, bidirectional cross-filter) and
  `USERELATIONSHIP`/`CROSSFILTER` are now implemented** (Sprint 11) — see
  [`docs/ADVANCED_RELATIONSHIPS.md`](./ADVANCED_RELATIONSHIPS.md) and
  [`docs/USERELATIONSHIP.md`](./USERELATIONSHIP.md).
- **Calculated tables, calendar-based (Auto date/time) time intelligence,
  `ALLSELECTED`/`ALLEXCEPT`/`CALCULATETABLE`, `TREATAS`, `EARLIER`/
  `EARLIEST` and nested iterator row-context stacks remain out of scope** —
  not started here (see [`docs/ITERATORS.md`](./ITERATORS.md) "Known
  limitations" for the iterator-specific boundaries, e.g.
  `SUMX(table, CALCULATE(...))`).
