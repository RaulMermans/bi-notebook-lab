# Iterators & Conditional Logic (Sprint 9)

This document covers Sprint 9's row-iterating DAX subset: `SUMX`, `AVERAGEX`,
`MINX`, `MAXX`, `COUNTX`, the implicit measure-reference context transition
they enable, and the conditional-logic functions (`IF`, `SWITCH`, `BLANK`,
`TRUE()`/`FALSE()`) that ship alongside them. See
[`docs/TABLE_EXPRESSIONS.md`](./TABLE_EXPRESSIONS.md) for the table-expression
layer iterators consume, and [`docs/CALCULATE.md`](./CALCULATE.md) for how
`CALCULATE`/`FILTER` relate to (and stay separate from) this layer.

## What an iterator is

Every other aggregation the engine had before Sprint 9 (`SUM`, `AVERAGE`,
`COUNTROWS`, ...) reads one pre-existing column's value vector and folds it.
An **iterator** is different: it evaluates an arbitrary scalar expression
**once per row** of a table expression, in a real Row Context, and folds
*those* per-row results:

```text
TABLE EXPRESSION  (Sales, or FILTER(Sales, ...), or VALUES(Products[Category]))
        │
        ▼
  for each visible row  →  Row Context  →  evaluate the row expression
        │
        ▼
  per-row results  →  aggregate (SUM / AVERAGE / MIN / MAX / COUNT)
```

`SUM(Sales[Revenue])` and `SUMX(Sales, Sales[Revenue])` produce the same
number for a plain column, but they are not the same mechanism: `SUMX` can
evaluate *any* row expression (arithmetic, `RELATED`, a measure reference,
`IF`/`SWITCH`), not just read one column.

## Pipeline

```text
FUNCTIONX(table, rowExpression)                       -- FunctionCallNode, no grammar change needed
       │
       ├─ table          → bindTableExpression()        (docs/TABLE_EXPRESSIONS.md)
       │
       └─ rowExpression  → bindIteratorRowExpression()   src/runtime/iterator/iteratorBinder.ts
                                  │
                                  ▼
                          BoundIteratorCall              src/runtime/iterator/iteratorTypes.ts
                                  │
                                  ▼ (per visible row)
                          evaluateIteratorRowExpression() src/runtime/iterator/iteratorEvaluator.ts
                                  │
                                  ▼
                          computeIteratorAggregation()    src/runtime/measure/aggregation.ts
```

`measureEvaluator.ts` dispatches `BoundMeasureExpression`'s `'Iterator'` case
to `evaluateIteratorCall` (defined in `measureEvaluator.ts` itself, since it
needs `MeasureEvalContext` — the model-dependent pieces of iteration, not the
per-row evaluator). The per-row evaluator in `iteratorEvaluator.ts` is
deliberately **pure and model-free**: it only knows how to read a
pre-resolved column value, walk a pre-built RELATED index, and delegate a
measure reference to an injected callback. All model/dataset lookups (which
columns exist, which relationship to use, how to build a context-transitioned
filter) happen exactly once per `SUMX` call, before the per-row loop starts —
see "Performance" below.

## Row Context

For:

```dax
SUMX(Sales, Sales[Revenue] - Sales[Cost])
```

execution is: resolve `Sales`'s currently-visible rows (respecting the
current FilterContext — `docs/TABLE_EXPRESSIONS.md` "Base table semantics"),
then for each row build an `IteratorRowData` (`{ kind: 'model', row,
rowIndex }`) and evaluate the bound row expression against it — a real Row
Context, structurally the same idea as a calculated column's `RowContext`
(`src/expression/rowContext.ts`), just scoped to one `SUMX` call instead of
persisted on the model.

For a `VALUES`/`DISTINCT`-rooted iterator (`SUMX(VALUES(Products[Category]),
...)`), the row is virtual: `IteratorRowData` is `{ kind: 'value', value }` —
there is no physical row, only the one distinct value. Column reads inside
the row expression are restricted to exactly the source column
(`Products[Category]` itself) — reading any other column is
`ITERATOR_ROW_SCOPE_VIOLATION`, since a virtual row simply doesn't carry
other columns' values.

## What a row expression can contain (sprint brief §18)

- literals, arithmetic (`+ - * /`), comparison (`= <> > >= < <=`), logical
  (`&& ||`)
- physical **and calculated** column reads on the iterator's own table
  (`Sales[Revenue]`, or a Sprint 3 calculated column like `Sales[Margin]`) —
  reuses `resolveLogicalColumn`/`getLogicalColumnValues`
  (`runtime/measure/logicalColumn.ts`), never reimplemented
- `RELATED(Table[Column])` — reuses the exact Sprint 3
  index/relationship-resolution machinery (`src/expression/relatedLookup.ts`)
- `IF`, `SWITCH`, `BLANK()`
- `[Measure Name]` — a measure reference, which triggers the implicit context
  transition below

Column references are scoped to the iterator's own table — no implicit
relationship traversal (`Products[Category]` inside `SUMX(Sales, ...)` is
`ITERATOR_ROW_SCOPE_VIOLATION`; use `RELATED` instead). Bracket-only `[Name]`
always means a measure reference here, never a row column, even though it
would be a row column inside a *calculated column* — the two grammars
diverge on this one point because a measure iterator needs measure
references to work, and there is no ambiguity to protect against inside a
calculated column's unqualified-column shorthand (sprint brief §19).

## SUMX

```dax
Gross Margin X =
SUMX(
    Sales,
    Sales[Revenue] - Sales[Cost]
)
```

Evaluates the row expression once per visible row, ignores `BLANK` results,
and sums the rest. A non-numeric row result (a string, a boolean from a
comparison, ...) is rejected with a structured `ITERATOR_EXPRESSION_TYPE_ERROR`
diagnostic — never coerced.

## AVERAGEX

```dax
Average Margin per Sale =
AVERAGEX(
    Sales,
    Sales[Revenue] - Sales[Cost]
)
```

Numeric, non-blank results contribute to the average; **zero counts as a
real value**, blank does not. Zero visible rows (or every row's result is
blank) yields `BLANK`, not zero or a division error.

## MINX / MAXX

```dax
MINX(table, expression)
MAXX(table, expression)
```

Accept numeric **or** string-comparable results (dates/datetimes are stored
as ISO strings at runtime, so lexicographic string ordering already sorts
them correctly — the same representation `MIN`/`MAX` already relied on, see
`docs/MEASURES.md` "Known limitations"). Blank values are skipped. The
optional modern `variant` third argument (`MAXX(table, expr, TRUE)`) is
**not implemented** — passing a third argument is rejected as
`INVALID_ITERATOR_ARGUMENT`, not silently ignored.

## COUNTX

```dax
COUNTX(table, expression)
```

Counts non-blank results whose type is number, string or boolean. Never
counts `BLANK`, and a type-error result (see `ITERATOR_EXPRESSION_TYPE_ERROR`
above) aborts the whole `COUNTX`, not just that one row.

## Implicit context transition for measure references (sprint brief §40-§43)

```dax
SUMX(
    Products,
    [Total Revenue]
)
```

A measure referenced inside an iterator's row expression must evaluate under
a filter context that reflects the *current row*, not the iterator's outer
filter context — otherwise every row would just return the same grand total.

### Bounded context transition semantics

**Model-table iterator row:** the current row's own **physical column
values** become `ReplaceColumnFilter` modifiers on that table (reusing
`contextModifier.ts`'s existing `applyFilterModifier`/`EffectiveContext`
machinery — the exact same mechanism `CALCULATE` uses for its own filter
modifiers). These are layered **on top of** the enclosing, already-resolved
FilterContext (`ctx.filterState` is the `ambientState` the new filters
compose against), so an external slicer (`Country = Spain`) survives the
transition:

```text
Products row (ProductID=17, Category=Furniture, UnitCost=…, UnitPrice=…)
        │
        ▼ context transition
Products[ProductID]=17, Products[Category]=Furniture, ... become filters
        │
        ▼ relationship propagation (unchanged mechanism)
Products → Sales
        │
        ▼
[Total Revenue] evaluated under that narrowed context
```

**VALUES/DISTINCT virtual row:** the lineage filter is just `sourceColumn =
currentValue` — a single `ReplaceColumnFilter`:

```dax
SUMX(
    VALUES(Products[Category]),
    [Total Revenue]
)
```

filters `Products[Category] = <that category>` per row, which is exactly
what makes `SUMX(VALUES(Products[Category]), [Total Revenue])` equal
`[Total Revenue]` when categories fully partition Products (and equal the
Spain subtotal when an external `Country = Spain` filter is also active).

### Compatibility boundary (sprint brief §42)

Sprint 9's context transition covers the current iterator row's **physical
table/column lineage only**. Power BI's deeper *expanded-table* DAX
context-transition semantics (which additionally propagate through every
relationship reachable from the row, not just the row's own table's direct
columns) are **out of scope**. For every relationship shape this engine
supports (single-direction `1 → *`), the bounded version and the full
expanded-table version agree — the divergence only matters for scenarios
this engine doesn't model yet (bidirectional/many-to-many relationships),
which remain out of scope anyway (see `docs/CALCULATE.md`).

### Context-safe caching — no row-to-row leakage (sprint brief §43)

Each measure-reference evaluation inside an iterator gets a **fresh**
`cache: new Map()` (the same pattern `evaluateCalculate` already uses for
`CALCULATE`'s nested scope), while `visiting` (cycle detection) and
`columnValuesCache` (context-independent raw column values) are shared with
the enclosing scope. A measure evaluated for Category "Electronics" can
therefore never accidentally return the cached result from Category
"Furniture" — they're different `Map` objects, not different cache keys.
`tests/runtime/measure/iteratorContextTransition.test.ts` asserts two
different categories produce different, correctly-attributed results and
that the cross-category sum equals the ungrouped total (a leak would either
double-count or silently repeat one category's value).

### `SUMX(table, CALCULATE(...))` boundary (sprint brief §47)

An **explicit** `CALCULATE(...)` written directly as an iterator's row
expression is not supported — the row-expression binder
(`iteratorBinder.ts`) doesn't recognize `CALCULATE` as a valid row-expression
function at all, so it's rejected as `UNSUPPORTED_FUNCTION` at bind time
rather than silently producing an incorrect result. A **measure reference**
that happens to be `CALCULATE`-defined (e.g. `SUMX(VALUES(Products[Category]),
[Spain Revenue])` where `Spain Revenue = CALCULATE([Total Revenue],
Customers[Country] = "Spain")`) *is* supported and composes correctly: the
iterator's own context transition applies first (as `ambientState`), then
`Spain Revenue`'s own `CALCULATE` modifier applies on top of that, exactly
like any other nested `CALCULATE` scope. See
`tests/runtime/measure/iteratorContextTransition.test.ts` for the regression
proving this composition.

## Conditional logic

### IF

```dax
IF(condition, valueIfTrue, [valueIfFalse])
```

Available in **both** measures and calculated columns, and inside iterator
row expressions. The condition must evaluate to a real boolean (from a
comparison, a logical combination, or a boolean-typed column/measure) — a
non-boolean condition is `IF_CONDITION_NOT_BOOLEAN`, never truthy-coerced.
Branches are evaluated **lazily**: only the taken branch runs, so
`IF(x = 0, 0, 100 / x)` never divides by zero. Omitting the false branch
evaluates to `BLANK` when the condition is false.

### SWITCH

```dax
SWITCH(expression, value1, result1, value2, result2, ..., [default])
```

including the canonical:

```dax
SWITCH(TRUE(), condition1, result1, condition2, result2, ..., default)
```

Cases are evaluated **in order**; the first match wins and later cases are
never evaluated (lazy, same as `IF`). `SWITCH(TRUE(), ...)` works because
case-matching is always plain equality (`compareScalarValues('=', ...)`)
against the leading expression — when that expression is the literal `TRUE`
and each "value" is itself a boolean comparison, equality-against-`true`
reproduces exactly the "first true condition wins" behavior, with no special
second code path. No match and no default evaluates to `BLANK`.

### BLANK / TRUE / FALSE

`BLANK()` returns the engine's existing internal `null` blank
representation — there is no second blank value anywhere. `TRUE`/`FALSE`
already parsed as boolean literals before Sprint 9; the one small parser
addition is recognizing `TRUE()`/`FALSE()` (a zero-argument call, needed for
`SWITCH(TRUE(), ...)`) as the same literal (`src/expression/parser.ts`).

### Calculated columns gain comparison/logical/conditional support

Sprint 8 deliberately rejected comparison/logical operators in calculated
columns (`UNSUPPORTED_FUNCTION`) as a stopgap. Sprint 9 lifts it: calculated
columns now bind `Comparison`/`Logical`/`If`/`Switch`/`Blank` nodes
(`src/expression/binder.ts`) and evaluate them row-by-row
(`src/expression/evaluator.ts`), sharing the identical scalar-comparison
semantics measures use (`src/expression/scalarComparison.ts`'s
`compareScalarValues` — one implementation, not two, per sprint brief §33).
`CALCULATE` itself remains rejected in calculated columns — this lift is
about scalar branching, not context transition (see `docs/CALCULATE.md`
"Context transition boundary").

## SELECTEDVALUE

```dax
SELECTEDVALUE(Table[Column], [alternateResult])
```

Measure-only (it reads the current FilterContext, which only measures have).
Semantics:

```text
exactly 1 distinct visible value   → that value
0 or >1 distinct visible values    → alternateResult (or BLANK if omitted)
```

Shares its "distinct visible values" computation with `VALUES(Column)`
(`docs/TABLE_EXPRESSIONS.md`) conceptually — both answer "what values of this
column are visible right now" — though each has its own small
evaluation path (`SELECTEDVALUE` only needs to know *how many* distinct
values there are and, if exactly one, *which* one; it doesn't need to
materialize a full table-expression row set to answer that).

`SELECTEDVALUE` reads `FilterContext` directly, never slicer UI state — a
grouped Visual (Table/Bar) already supplies the relevant per-member
FilterContext through the same `evaluateMeasure` path every other measure
uses, so `SELECTEDVALUE` "just works" per group with zero Visual-specific
code (see "Visual Cell integration" below).

## Iterator diagnostics

| Code | Meaning |
| --- | --- |
| `INVALID_ITERATOR_ARGUMENT` | Wrong arity (not exactly 2 args), or an unsupported 3rd `MINX`/`MAXX` variant argument |
| `ITERATOR_TABLE_REQUIRED` | First argument isn't table-shaped (a bare table, `FILTER`, `VALUES` or `DISTINCT`) |
| `ITERATOR_EXPRESSION_TYPE_ERROR` | A row expression produced a value the aggregation function can't use (e.g. a string for `SUMX`) |
| `ITERATOR_ROW_SCOPE_VIOLATION` | A column reference outside the iterator's own table/source column, or `RELATED` inside a virtual `VALUES`/`DISTINCT` row |
| `ITERATOR_UNSUPPORTED_TABLE_EXPRESSION` | `FILTER(VALUES(...)/DISTINCT(...), ...)` — Sprint 9 scope boundary |
| `ITERATOR_CONTEXT_TRANSITION_ERROR` | Reserved for a context-transition failure the bounded mechanism can't represent (not currently reachable — every supported row/lineage shape transitions successfully) |
| `IF_INVALID_ARITY` / `IF_CONDITION_NOT_BOOLEAN` | Malformed `IF`, or a non-boolean condition |
| `INVALID_SWITCH_ARGUMENT` | Malformed `SWITCH` shape (fewer than 3 arguments) |
| `SELECTEDVALUE_INVALID_ARGUMENT` | First argument isn't `Table[Column]`, or wrong arity |

## Execution trace

New `TraceNodeKind`s (`src/expression/trace.ts`), all real execution output:

```text
iterator            SUMX/AVERAGEX/MINX/MAXX/COUNTX itself
table-expression     the resolved table argument (docs/TABLE_EXPRESSIONS.md)
context-transition   a measure reference inside a row, with its applied filters
conditional          IF
switch-case          a matched/defaulted/unmatched SWITCH branch
```

Example:

```text
SUMX(Sales, Sales[Revenue] - Sales[Cost])      kind: iterator
  metadata: { visibleRows: 341, evaluated: 341 }
  value: 84211
  children:
    table-expression (Sales)                    metadata: { visibleRows: 341 }
    result (Row 0)                               <first 10 rows only>
    result (Row 1)
    ...
```

### Bounded trace sampling (sprint brief §26-§27, §44)

The runtime still evaluates **every** required row/measure-reference; only
the *trace* is sampled. `ITERATOR_PREVIEW_LIMIT` and
`CONTEXT_TRANSITION_TRACE_LIMIT` (both `10`, `measureEvaluator.ts`) bound how
many per-row execution traces and how many context-transition traces are
kept, so a 100,000-row `SUMX` doesn't hold 100,000 trace nodes in memory.

### Context transition trace

```text
[Total Revenue]                                  kind: context-transition
  metadata: { appliedFilters: ["Products[ProductID] = 17", "Products[Category] = Furniture", ...] }
  children: [ <the nested measure-reference trace, itself possibly a `calculate`> ]
```

## Performance (sprint brief §69-§70)

- The iterator's row expression is **parsed and bound once** per `SUMX` call,
  never once per row.
- Calculated-column vectors the row expression reads are **prefetched once**
  (`collectIteratorCalculatedColumns` walks the bound tree; each distinct
  column's vector is computed once via the existing
  `MeasureEvalContext.columnValuesCache`), not recomputed per row.
- The `RELATED` index is built **once per relationship per `SUMX` call**
  (a local cache keyed by `relationshipId`), not rebuilt per row — the same
  O(n) discipline `evaluator.ts`'s calculated-column `RELATED` already uses.
- A simple iterator (`SUMX(Sales, Sales[Revenue] - Sales[Cost])`) is O(n) in
  the number of visible rows.
- **Measure references inside iterators are inherently more expensive**:
  each one performs a full nested `evaluateMeasureById` call (its own
  `resolveFilterContextUnchecked` pass) per row. At Retail sample scale
  (1,500 Sales rows, 20 Products, 10 Countries) this remains fast; a
  `SUMX`-over-measure-reference workload against a much larger, more
  relationally complex model is **not yet optimized like a real in-memory
  column-store engine (VertiPaq)** — this is a documented, deliberate
  boundary (sprint brief §70), not a bug. No DuckDB or other engine was
  introduced to work around it.

## Visual Cell integration

No Visual-specific iterator/conditional implementation exists. A Visual
computing a `SUMX`/`SELECTEDVALUE`/`IF`/`SWITCH` measure calls the same
`evaluateMeasure` every other measure goes through — see
`docs/VISUAL_CELLS.md` "Sprint 9 update" and
`tests/runtime/visual/iteratorVisual.test.ts`.

## Context Explorer integration

Same story — see `docs/CONTEXT_VISUALIZER.md` "Sprint 9 compatibility." The
generic `TraceTree` component renders the new trace kinds automatically.

## Validation Engine compatibility

`evaluateMeasureResultRule`/`evaluateExpressionSemanticRule` call
`evaluateMeasure`/AST-walk the parsed expression generically — a `SUMX`,
`IF`, or `SELECTEDVALUE`-based measure needs zero validation-engine changes
to be gradeable, including `uses-function` detection (every new function
stays an ordinary `FunctionCallNode`, which the existing AST walkers already
recurse into). See `tests/runtime/validation/semanticValidation.test.ts` and
`tests/runtime/validation/measureValidation.test.ts`.

## Known DAX compatibility limitations (this document's scope)

- Nested iterators (`SUMX(Products, SUMX(Sales, ...))`) are not implemented.
  The architecture doesn't *prevent* a future row-context stack — there's
  just one row context at a time right now — but `EARLIER`/`EARLIEST` (which
  would need that stack) are not implemented either.
- `MINX`/`MAXX`'s optional `variant` third argument isn't implemented.
- Context transition covers the iterator row's own physical table/column
  lineage only — not full expanded-table DAX semantics (see above).
- An explicit `CALCULATE(...)` written directly as an iterator's row
  expression is rejected, not silently miscomputed (see above).
- Very large iterator-with-measure-reference workloads are not optimized
  like VertiPaq.
- `HASONEVALUE`, `ISFILTERED`, `ISCROSSFILTERED`, `COALESCE`, `ISBLANK` are
  not implemented — `SELECTEDVALUE` and `IF`/`BLANK` cover the pedagogically
  important overlap.

## Tests

- `tests/runtime/measure/iterators.test.ts` — `SUMX`/`AVERAGEX`/`MINX`/
  `MAXX`/`COUNTX` happy paths, blank handling, filtered/empty tables, type
  errors, calculated-column row expressions, `RELATED`, `COUNTROWS`
  generalization.
- `tests/runtime/measure/iteratorContextTransition.test.ts` — model-row and
  virtual-row context transition, cache-leakage regression, external filter
  survival, `SUMX(VALUES(...), [CALCULATE-defined measure])` composition.
- `tests/runtime/measure/conditionals.test.ts` — `IF`/`SWITCH`/`BLANK`/
  `SELECTEDVALUE` in measures, including filter-context dependence and
  slicer reaction.
- `tests/expression/calculatedColumnConditionals.test.ts` — comparison/
  logical/`IF`/`SWITCH`/`BLANK` in calculated columns.
- `tests/runtime/measure/iteratorRetailSample.test.ts` — every sprint brief
  §55-§56 acceptance measure/column against the real bundled Retail sample,
  each checked against an independently-derived expected value.
- `tests/runtime/visual/iteratorVisual.test.ts`,
  `tests/runtime/validation/semanticValidation.test.ts`,
  `tests/runtime/validation/measureValidation.test.ts` — zero-new-code
  integration proofs for Visual Cells and the Validation Engine.
