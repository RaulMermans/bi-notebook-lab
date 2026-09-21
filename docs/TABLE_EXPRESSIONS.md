# Table Expressions (Sprint 9)

Before Sprint 9, "a set of rows" wasn't a first-class value anywhere in the
engine: `FILTER(Table, predicate)` bound straight into a CALCULATE-only
`PredicateFilterModifier` (`src/runtime/measure/contextModifier.ts`), and
nothing else produced or consumed a table value at all. Sprint 9 introduces a
canonical **table-expression** abstraction — `BoundTableExpression` — that
`FILTER`, `VALUES`, `DISTINCT` and a bare model table all bind to, and one
evaluator (`evaluateTableExpression`) that every consumer shares: CALCULATE's
`FILTER` modifier, `COUNTROWS`, and the iterator functions (`SUMX`,
`AVERAGEX`, `MINX`, `MAXX`, `COUNTX` — see [`docs/ITERATORS.md`](./ITERATORS.md)).

No parallel implementation exists anywhere in the codebase: **one bind, one
evaluate**.

## Pipeline

```text
Expression AST (FunctionCallNode | TableReferenceNode)
       │
       ▼
bindTableExpression()                    src/runtime/tableExpression/tableExpressionBinder.ts
       │
       ▼
BoundTableExpression                     src/runtime/tableExpression/tableExpressionTypes.ts
       │
       ▼
evaluateTableExpression()                src/runtime/tableExpression/tableExpressionEvaluator.ts
       │
       ▼
EvaluatedTableExpression { rows, modelTableId, trace }
```

Three consumers plug into the *same* two functions:

```text
CALCULATE's FILTER modifier   ──┐
COUNTROWS(tableExpr)           ─┼─►  bindTableExpression / evaluateTableExpression
SUMX/AVERAGEX/MINX/MAXX/COUNTX ─┘
```

## `BoundTableExpression` (`tableExpressionTypes.ts`)

```ts
type BoundTableExpression =
  | BoundBaseTable     // a bare model table, e.g. `Sales`
  | BoundFilterTable   // FILTER(tableExpr, predicate)
  | BoundValuesTable   // VALUES(Table[Column])
  | BoundDistinctTable // DISTINCT(Table[Column])

interface BoundBaseTable { kind: 'BaseTable'; modelTableId: string; tableName: string }

interface BoundFilterTable {
  kind: 'FilterTable'
  input: BoundTableExpression       // recursive — FILTER(FILTER(...), ...) composes for free
  modelTableId: string              // == input's own model table
  predicate: BoundPredicateNode     // reused from booleanFilter.ts, unchanged since Sprint 8
  referencedColumns: ColumnRef[]
}

interface BoundValuesTable { kind: 'ValuesTable'; column: ColumnRef; modelTableId: string; columnName: string; tableName: string }
interface BoundDistinctTable { kind: 'DistinctTable'; /* same shape as BoundValuesTable */ }
```

`FILTER`'s predicate binding is **unchanged from Sprint 8** — it still calls
`bindPredicateExpression` from `runtime/measure/booleanFilter.ts` with a
`fixedTable` scope, so a predicate may only reference physical columns of the
one table being filtered (no implicit relationship traversal — the same rule
`FILTER` already enforced). `VALUES`/`DISTINCT` require their argument to be
exactly `Table[Column]` — `VALUES(Table)`/`DISTINCT(TableExpression)` are
Sprint 9 scope boundaries (see "Known limitations" below), reported as
`INVALID_VALUES_ARGUMENT`/`INVALID_DISTINCT_ARGUMENT`.

## Evaluated rows and lineage (`tableExpressionTypes.ts`)

```ts
interface EvaluatedTableExpression { rows: TableExpressionRow[]; modelTableId: string; trace: ExecutionTraceNode }

type TableExpressionRow = ModelTableExpressionRow | ValueTableExpressionRow

interface ModelTableExpressionRow { kind: 'model-row'; modelTableId: string; rowIndex: number; row: Record<string, unknown> }
interface ValueTableExpressionRow { kind: 'value-row'; sourceColumn: ColumnRef; sourceModelTableId: string; value: unknown }
```

A row never loses lineage: a `model-row` knows exactly which physical row of
which table it came from (enough to build Row Context and, for a measure
reference, a context transition — see `docs/ITERATORS.md`); a `value-row`
knows the exact source column and distinct value it represents. This is what
lets an iterator turn either kind of row into a filter for a nested measure
reference without inventing a second lineage mechanism.

## Base table semantics — always respects the current FilterContext

`BoundBaseTable` evaluates to the rows of its model table **currently visible
under the caller's `ResolvedFilterState`** — never the full unfiltered
source table:

```text
SUMX(Sales, ...)  under  Country = Spain
        │
        ▼
only the Sales rows visible after Country → Customers → Sales propagation
```

`evaluateTableExpression` takes a `filterState: ResolvedFilterState` in its
context and calls the exact same `visibleRowIndices`
(`runtime/measure/filterPropagation.ts`) every other measure-evaluation path
already uses — no separate "iterate all rows" fallback exists.

## FILTER — one implementation, two callers

Sprint 8's CALCULATE `FILTER(Table, predicate)` and Sprint 9's standalone
`FILTER(...)` (as a `COUNTROWS`/iterator table argument) are **the same
binder and the same evaluator**:

- `measureBinder.ts`'s `bindFilterFunction` (CALCULATE's filter-argument
  path) now calls `bindTableExpression` and unpacks the resulting
  `BoundFilterTable` into a `PredicateFilterModifier` — it does not bind the
  predicate itself anymore.
- `contextModifier.ts`'s `applyFilterModifier` `PredicateFilter` case builds
  a `BoundFilterTable` from the modifier's stored predicate and calls
  `evaluateTableExpression` (with the CALCULATE call's *ambient* — i.e.
  already-filtered — state as the table's visibility) instead of scanning
  rows itself.

This is a refactor into a reusable abstraction, not a semantic rewrite: every
Sprint 8 CALCULATE/FILTER example and test still passes unchanged (sprint
brief §7). `FILTER`'s "ambient context" behavior — a `FILTER` argument
automatically intersects with whatever the caller already had filtered — is
unchanged too, because it falls out of the same mechanism it always did:
`BoundBaseTable`'s evaluation reads the ambient `ResolvedFilterState`.

`FILTER(FILTER(Table, p1), p2)` composes because `BoundFilterTable.input` is
itself a `BoundTableExpression` — the second `FILTER`'s predicate is bound
against the same underlying model table (row-context scope is per *table*,
not per intermediate filter step), and evaluation just filters the first
`FILTER`'s already-narrowed row list further.

`FILTER(VALUES(...), ...)` / `FILTER(DISTINCT(...), ...)` are **not**
supported (sprint brief §9 — not required, and the value-row shape has no
physical row for a predicate to scan) — rejected at bind time with
`ITERATOR_UNSUPPORTED_TABLE_EXPRESSION`.

## VALUES

```dax
VALUES(Table[Column])
```

A one-column table expression: the column's **distinct values actually
visible** under the current FilterContext, in first-seen order, including a
real blank/null value if present in the visible rows.

```text
No filter:              VALUES(Customers[Country])  → 10 rows (10 countries)
Country = Spain:        VALUES(Customers[Country])  → 1 row  ("Spain")
```

### Bounded VALUES compatibility

Full DAX `VALUES` can synthesize a special blank/unknown member when
referential integrity is violated (e.g. a many-side foreign key with no
matching one-side row). **Sprint 9 does not fake that behavior.**
`VALUES(Column)` returns exactly the distinct values present in the
underlying table's visible rows — real blanks are retained if the data
itself has them, but no synthetic "unknown member" is ever manufactured.
Future relationship-fidelity work can add it; this is a documented
compatibility boundary, not an oversight.

## DISTINCT

```dax
DISTINCT(Table[Column])
```

For the current bounded model, `DISTINCT(Column)` computes the same visible
distinct values as `VALUES(Column)` — but it is a **separate bound/runtime
node kind** (`BoundDistinctTable`/`'DistinctTable'` rows), not an alias.
Real DAX's `VALUES`/`DISTINCT` diverge in their full-fidelity semantics
(around the synthetic blank row `VALUES` can produce); keeping them distinct
here means a future sprint can diverge their behavior without a breaking
rename.

## COUNTROWS generalization

Sprint 4's `COUNTROWS(Sales)` only accepted a bare model table. Sprint 9
generalizes `BoundCountRows.table` from a `modelTableId: string` to a full
`BoundTableExpression`, so:

```dax
COUNTROWS(Sales)                                  -- unchanged behavior
COUNTROWS(FILTER(Sales, Sales[Quantity] >= 5))
COUNTROWS(VALUES(Customers[Country]))
```

all work, sharing `evaluateTableExpression`. `COUNTROWS(Sales)`'s existing
behavior is byte-for-byte identical — it now binds to a plain `BoundBaseTable`
and counts `evaluated.rows.length`, which equals the old
`visibleRowIndices(...).length` computation exactly.

## Sprint 9 scope boundaries

- `VALUES`/`DISTINCT` are **column-only** — `VALUES(Table)`/
  `DISTINCT(TableExpression)` are not supported (`INVALID_VALUES_ARGUMENT`/
  `INVALID_DISTINCT_ARGUMENT`). The goal was a robust column-table primitive
  first, not full table-value generality.
- `FILTER` must be rooted at a model table (directly, or through nested
  `FILTER`s) — `FILTER(VALUES(...), ...)` is rejected.
- `ALL`/`REMOVEFILTERS` remain CALCULATE-modifier-only and were **not**
  folded into `BoundTableExpression` — see `docs/CALCULATE.md` "`ALL` scope
  limitation."
- No calculated tables (`ADDCOLUMNS`, `SELECTCOLUMNS`, `SUMMARIZE`,
  `SUMMARIZECOLUMNS`, `TOPN`, `RANKX`, `CALCULATETABLE`) — none of these
  produce or consume a `BoundTableExpression`.

## Execution trace

Every consumer's trace nests an `EvaluatedTableExpression.trace` node
(`kind: 'table-expression'`) describing what actually executed:

```text
FILTER(Sales, Quantity >= 5)          kind: table-expression
  metadata: { inputRows: 5, matched: 2 }
  children: [ <input table's own table-expression trace> ]

VALUES(Customers[Country])            kind: table-expression
  metadata: { visibleSourceRows: 27, distinctValues: 1 }
```

These are always real execution output — never reconstructed from source
text — matching the rest of the engine's trace conventions
(`docs/EXPRESSION_ENGINE.md`).

## Tests

- `tests/runtime/tableExpression/tableExpressionBinder.test.ts` — binding:
  base table, `FILTER`, `VALUES`, `DISTINCT`, nested `FILTER`, unknown
  table/column, invalid `VALUES`/`DISTINCT` arguments, `FILTER(VALUES(...))`
  rejection.
- `tests/runtime/tableExpression/tableExpressionEvaluator.test.ts` —
  execution: FilterContext respected by base tables and `FILTER`, `FILTER`
  intersects the ambient context, nested `FILTER`, `VALUES`/`DISTINCT`
  dedup + context sensitivity, real blank retained.
- `tests/runtime/measure/iterators.test.ts` — `COUNTROWS` generalization
  regression (`COUNTROWS(Sales)` unchanged, `COUNTROWS(FILTER(...))`,
  `COUNTROWS(VALUES(...))`).
- All pre-existing Sprint 8 CALCULATE/FILTER tests
  (`tests/runtime/measure/calculate.test.ts`,
  `tests/runtime/measure/calculateRetailSample.test.ts`,
  `tests/expression/calculateBinder.test.ts`) pass unchanged, proving the
  refactor didn't regress CALCULATE.

## Sprint 10 addendum

`BoundTableExpression` gained one more variant,
`BoundTimeIntelligenceTable` (`SAMEPERIODLASTYEAR`/`DATEADD`/
`PREVIOUSMONTH`/`PREVIOUSYEAR`/`DATESYTD`) — bound and evaluated through
this same single dispatch, not a second table-expression abstraction. See
[`docs/TIME_INTELLIGENCE.md`](./TIME_INTELLIGENCE.md) for the full design;
`EvaluatedTableExpression` also gained an optional `diagnostics` field for
`DATEADD`'s runtime-only non-contiguous-context check, which no other
table expression kind needs (every other kind's failures are caught at
bind time).
