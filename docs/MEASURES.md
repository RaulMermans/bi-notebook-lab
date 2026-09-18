# Measures (Sprint 4)

This document describes `Measure`, the Sprint 4 counterpart to
`CalculatedColumn`. It reuses the exact same parser/AST/diagnostics/trace
machinery described in [`EXPRESSION_ENGINE.md`](./EXPRESSION_ENGINE.md) —
binding and evaluation are the only things that diverge.

## Measure vs. Calculated Column

|                     | CalculatedColumn                          | Measure                                    |
|---------------------|--------------------------------------------|---------------------------------------------|
| Evaluated           | once per row                                | once per query/filter context                |
| Context             | `RowContext` (one row, one table)           | `FilterContext` (see [`FILTER_CONTEXT.md`](./FILTER_CONTEXT.md)) |
| `Table[Column]`     | reads the current row's own table only      | rejected unless wrapped in an aggregation    |
| `[Name]`            | current-row column shorthand                | a reference to another **measure**           |
| Storage             | `SemanticModel.calculatedColumns`           | `SemanticModel.measures`                     |
| Result shape        | one value per row                           | a single scalar                              |

This is the core semantic distinction Sprint 4 exists to teach.

## Domain contract (`src/domain/model.ts`)

```ts
interface Measure {
  id: string
  homeModelTableId: string
  name: string
  expression: string
  dataType: DataType | 'unknown'
  createdAt: string
  updatedAt: string
}

interface SemanticModel {
  // ...
  measures: Measure[]
}
```

`homeModelTableId` only decides where the measure is displayed on the
model canvas (Power BI's "home table" convention) — it never restricts
what the measure's expression can read. A measure's execution semantics
are model-wide by design.

## MeasureCell (`src/domain/notebook.ts`)

```ts
interface MeasureCell extends BaseNotebookCell {
  kind: 'measure'
  modelId: string
  measureId: string
}
```

Mirrors `CalculatedColumnCell` exactly: the cell stores references only,
both ids are always required, and there is no "draft" `MeasureCell` — an
expression that fails to validate stays in UI-only editor state
(`CreateMeasurePanel`) until it validates.

## Measure binding (`src/expression/measureBinder.ts`)

Sprint 3's `bind()`/`BoundExpression` (calculated columns) are untouched.
Measures get a parallel, separate entry point — `bindMeasureExpression()` —
that shares the parser, AST, diagnostics factory, and
`findModelTableByName`/`resolveTableRef`/`resolveColumnRef` from
`binder.ts`/`modelRuntime.ts`, but applies different rules:

- **`Table[Column]` used directly** (not as the sole argument of an
  aggregation function) → `COLUMN_REQUIRES_AGGREGATION`. Measures have no
  row context, so a naked column has no defined value.
- **`[Name]`** always resolves to a `Measure` by name (case-insensitive),
  never to a column → `BoundMeasureReference`, or `UNKNOWN_MEASURE` if no
  measure with that name exists.
- **A bare table name** (`Sales`, via the new `TableReferenceNode` AST
  kind — see `EXPRESSION_ENGINE.md`) is only valid as the sole argument of
  `COUNTROWS`; anywhere else it's `BARE_TABLE_REFERENCE`.
- **`RELATED`** is rejected with `RELATED_REQUIRES_ROW_CONTEXT` — see
  "No RELATED in measures" below.

Bound measure AST (`BoundMeasureExpression`):

```ts
type BoundMeasureExpression =
  | { kind: 'Literal'; value }
  | { kind: 'Unary'; operator; operand }
  | { kind: 'Binary'; operator; left; right }
  | { kind: 'MeasureReference'; measureId; measureName }
  | { kind: 'Aggregation'; function: 'SUM'|'AVERAGE'|'MIN'|'MAX'|'COUNT'|'DISTINCTCOUNT'; modelTableId; column: LogicalColumnRef }
  | { kind: 'CountRows'; modelTableId }
  | { kind: 'Divide'; numerator; denominator; alternate? }
```

## Logical column access (`src/runtime/measure/logicalColumn.ts`)

Aggregations must accept both a physical column and a Sprint 3
`CalculatedColumn` (e.g. `SUM(Sales[Margin])`) without mutating
`DataTable.columns` to fake one as the other. `LogicalColumnRef` is the
small abstraction that makes both look the same to the binder/evaluator:

```ts
interface LogicalColumnRef {
  modelTableId: string
  kind: 'physical' | 'calculated'
  columnId: string   // DataColumn.id or CalculatedColumn.id
  name: string
  dataType: DataType | 'unknown'
}

resolveLogicalColumn(model, datasets, modelTableId, columnName): LogicalColumnRef | undefined
getLogicalColumnValues(model, datasets, ref): unknown[]   // aligned to the table's row order
```

`getLogicalColumnValues` for a calculated column reuses
`evaluateCalculatedColumn` from Sprint 3 directly — the Sprint 3
row-by-row evaluator is never reimplemented.

## Supported functions (Sprint 4)

```text
SUM(Table[Column])           numeric only, blank ignored
AVERAGE(Table[Column])       numeric only, blank ignored
MIN(Table[Column])           numeric or date/datetime
MAX(Table[Column])           numeric or date/datetime
COUNT(Table[Column])         any type, counts nonblank visible values
COUNTROWS(Table)             visible row count (TableReferenceNode argument)
DISTINCTCOUNT(Table[Column]) any type, counts distinct nonblank visible values
DIVIDE(a, b)                 blank if b is blank/0
DIVIDE(a, b, alternate)      alternate if b is blank/0
[Measure Name]               measure reference
+ - * /  unary -  ( )        arithmetic between measures/aggregations
= <> > >= < <=                comparison (Sprint 8) — also valid as a general scalar result
&& ||                          logical composition (Sprint 8)
CALCULATE(expr, filters...)   modifies the filter context (Sprint 8 — see docs/CALCULATE.md)
FILTER / REMOVEFILTERS / ALL   CALCULATE filter modifiers only (Sprint 8)
```

All aggregations restrict themselves to rows visible under the current
`FilterContext` (see `FILTER_CONTEXT.md`) — never the whole table.

### DIVIDE semantics

Unlike the `/` operator (which produces a `DIVISION_ERROR` diagnostic on a
literal zero denominator, matching Sprint 3's row-level behavior),
`DIVIDE` never errors: a blank or zero denominator produces blank (`null`),
or the third `alternateResult` argument if supplied. This is the one
Sprint 4 function whose whole purpose is safe division.

### Known limitations vs. real DAX

- `DISTINCTCOUNT` excludes blanks from the distinct set. Real DAX's
  `DISTINCTCOUNT` counts blank as one distinct value (`DISTINCTCOUNTNOBLANK`
  is the one that excludes it) — Sprint 4 picked the simpler, more
  intuitive-for-beginners behavior and documents the divergence here.
- `MIN`/`MAX` compare with JS `<`/`>`, which works correctly for numbers and
  ISO-8601 date/datetime strings, but not for arbitrary types.

See [`CALCULATE.md`](./CALCULATE.md) for `CALCULATE`/`FILTER`/
`REMOVEFILTERS`/`ALL` (Sprint 8), [`docs/ITERATORS.md`](./ITERATORS.md) for
`SUMX`/`AVERAGEX`/`MINX`/`MAXX`/`COUNTX` and [`docs/TABLE_EXPRESSIONS.md`](./TABLE_EXPRESSIONS.md)
for `VALUES`/`DISTINCT` as reusable table expressions (Sprint 9). Measures
also now support `IF`, `SWITCH`, `BLANK()` and `SELECTEDVALUE` — see
"Conditional logic and SELECTEDVALUE" below. Time intelligence remains out of
scope.

### Conditional logic and SELECTEDVALUE (Sprint 9)

`IF(condition, whenTrue, [whenFalse])` and `SWITCH(expression, value1,
result1, ..., [default])` — including the canonical `SWITCH(TRUE(), cond1,
r1, cond2, r2, ..., default)` shape — work as ordinary scalar measure
expressions, react to the current FilterContext through whatever measures
their branches reference, and evaluate branches lazily (only the taken
branch's diagnostics/side effects apply). `BLANK()` returns the same internal
`null` every other blank result already uses — there is no second blank
representation.

`SELECTEDVALUE(Table[Column], [alternateResult])` returns the column's single
distinct visible value under the current FilterContext, or `alternateResult`
(default `BLANK`) when zero or more than one distinct value is visible. It
shares its "distinct visible values" computation with `VALUES(Column)`
(`docs/TABLE_EXPRESSIONS.md`) rather than a second value-resolution
mechanism — `SELECTEDVALUE(Customers[Country], "Multiple Countries")` is
conceptually "if `COUNTROWS(VALUES(Customers[Country]))` = 1, return that one
value, else the alternate."

## Measure references and dependencies

A measure's expression may reference other measures by name (`[Total
Revenue]`). Dependency discovery
(`src/runtime/measure/dependencyGraph.ts#buildMeasureDependencyGraph`) walks
each measure's parsed AST for bracket-only `ColumnReferenceNode`s (which
always mean "measure reference" in measure mode — no binding pass needed)
and resolves them to measure ids by name.

### Cycle detection

`detectMeasureDependencyCycle` runs the same white/gray/black DFS as
`runtime/model/graphAnalysis.ts`'s relationship-cycle check (both share
`src/lib/graph/cycle.ts#detectCycle` — one graph algorithm, two domains).
A direct self-reference (`Revenue = [Revenue] + 1`) is a 1-node cycle and
is caught the same way as a longer chain.

Cycle detection runs during `validateMeasure` (`measureRuntime.ts`)
against a **candidate model** that already contains the proposed
create/update — so a self-reference resolves as a real
`BoundMeasureReference` (not `UNKNOWN_MEASURE`) and the dependency graph
catches it explicitly as `MEASURE_DEPENDENCY_CYCLE`. Detection is always
explicit graph traversal, never a runtime recursion-depth guard (the
evaluator still carries a `visiting` set as defense in depth, but
`validateMeasure` should never let a cyclic definition become canonical
model state in the first place).

### Shared dependencies evaluated once

`measureEvaluator.ts`'s per-evaluation `cache: Map<measureId, NodeResult>`
means that if two measures both reference `[Total Revenue]`, it's computed
once per `evaluateMeasure` call and reused — not re-evaluated per
reference. Since Sprint 8, this cache is scoped **per filter-context scope**,
not per whole `evaluateMeasure` call: a `CALCULATE`-modified scope always
gets a fresh cache, so `[Total Revenue]` computed under an external context
is never reused for the same measure evaluated again inside a `CALCULATE`
with a different context (or vice versa) — see
[`CALCULATE.md`](./CALCULATE.md) "Measure dependencies and the context-safe
cache".

## No RELATED in measures

`RELATED` is a row-context function — it reads the "one" side of a
relationship relative to *the current row*, and measures have no current
row. Using it in a measure produces:

```text
RELATED_REQUIRES_ROW_CONTEXT

RELATED requires row context. Measures are evaluated in filter context —
use an aggregation over the related table instead.
```

## Measure name validation

Within a model, measure names must be unique case-insensitively
(`DUPLICATE_MEASURE`), and a measure may not share a name with a physical
or calculated column on its own home table — even though the parser could
technically still resolve `[Name]` unambiguously to a measure, allowing
the collision would be confusing to a learner reading the model canvas.

## Canonical state

Mirrors `CalculatedColumn` exactly: `validateMeasure` runs
name-conflict → parse → bind → dependency-cycle checks without mutating
anything; `createMeasure`/`updateMeasure` only write to
`SemanticModel.measures` when every diagnostic is a warning/info, never an
error. An invalid draft never reaches persisted model state.

## Execution (`src/runtime/measure/measureEvaluator.ts`)

```ts
interface MeasureExecution {
  measureId: string
  value: unknown
  dataType: DataType | 'unknown'
  diagnostics: ExpressionDiagnostic[]
  trace?: ExecutionTraceNode
  filterState?: ResolvedFilterState
}

evaluateMeasure(model, datasets, measureId, filterContext = { filters: [] }): MeasureExecution
```

Like `evaluateCalculatedColumn`, this recomputes everything from the
persisted `expression` string on every call — no cached result is ever
persisted, only the definition. `dataType` is inferred from the evaluated
value (`integer`/`decimal`/`boolean`/`string`/`unknown`) since a measure's
declared type isn't known until it's actually computed once.

## Model Canvas integration

`ModelTableNode` renders a measure's home table with a `∑` badge (parallel
to the calculated column `fx` badge). Measures are display-only on the
canvas — like calculated columns, they never become relationship
endpoints.

## Persistence

`Measure[]` lives inside `SemanticModel.measures` and round-trips through
the existing `modelStore.ts` automatically — no new IndexedDB store was
needed. Models persisted before Sprint 4 have no `measures` field on disk
at all; `runtime/model/modelRuntime.ts#hydrateSemanticModel` normalizes
`measures ?? []` and every load path (`persistence/modelStore.ts#loadModel`)
routes through it, so reloading an old notebook never crashes.

## UI

- `CreateMeasurePanel.tsx` — the only way a `MeasureCell` comes into
  existence (mirrors `CreateCalculatedColumnPanel.tsx`).
- `MeasureCellCard.tsx` — expression editor, no-filter/current-context
  result comparison, and the evaluation-context panel below.
- `components/context/ContextFilterEditor.tsx` — an
  add-filter/remove-filter editor over `ColumnFilter[]` (see
  `FILTER_CONTEXT.md`), with a value picker for low-cardinality columns.
  Shared with the Sprint 6 `ContextExplorer` (see
  [`CONTEXT_VISUALIZER.md`](./CONTEXT_VISUALIZER.md)).
- `components/notebook/measure/MeasureTraceVisualizer.tsx` — renders the
  runtime's own `ExecutionTraceNode` tree (shared `TraceNodeView` component
  with the Sprint 3 row-context visualizer).

Filter context used to test a measure in the UI is transient component
state — it is never persisted, per spec.
