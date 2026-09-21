# Expression Engine (Sprint 3 + Sprint 4 + Sprint 8)

This document describes the reusable expression system introduced in
Sprint 3 to execute calculated-column formulas, how Sprint 4 (Measures)
extends it with aggregation and filter-context semantics, and how Sprint 8
(`CALCULATE`) extends the *same* grammar a second time with comparison/
logical operators — all without introducing a second parser. See
[`MEASURES.md`](./MEASURES.md), [`FILTER_CONTEXT.md`](./FILTER_CONTEXT.md)
and [`CALCULATE.md`](./CALCULATE.md) for the runtime built on top of this
engine.

## Pipeline

```text
Source expression (string)
  → lib/lexer (src/expression/lexer.ts)        tokens
  → parser (src/expression/parser.ts)          AST (src/expression/ast.ts)
  → binder (src/expression/binder.ts)          BoundExpression (stable ColumnRefs)
  → evaluator (src/expression/evaluator.ts)    values + RowEvaluationError[] + traces
```

Each stage has one job:

- **Parser**: `text -> syntax tree`. Knows nothing about the semantic model.
- **Binder**: `syntax tree -> semantic references`. Resolves table/column
  names against the actual `SemanticModel` + `Dataset` registry into stable
  `ColumnRef`s (`{ datasetId, tableId, columnId }`), and resolves `RELATED`
  calls to a specific `Relationship`.
- **Evaluator**: `bound tree + row context -> result`. Reads actual row
  values and computes.

Sprint 4 diverges at the binder step only:

```text
                    Expression AST
                          │
              ┌───────────┴───────────┐
              │                       │
      bind()                 bindMeasureExpression()
   (calculated column)              (measure)
              │                       │
        RowContext              FilterContext
              │                       │
   evaluateBoundExpressionOverTable   measureEvaluator.ts
        (evaluator.ts)          (runtime/measure/)
```

Both binders share the same lexer, parser, AST, diagnostics factory and
name-resolution helpers (`findModelTableByName`,
`resolveTableRef`/`resolveColumnRef`). See
[`MEASURES.md`](./MEASURES.md) for the measure-side pipeline.

## BI Notebook DAX Subset — Sprint 3

Supported grammar:

```text
numeric literals        42, 3.5
string literals          "Spain"      (double or single quotes; "" escapes a quote)
boolean literals          TRUE, FALSE  (case-insensitive, only when not followed by "[")
parentheses               ( expr )
binary operators          +  -  *  /
unary operator             -
column reference           Table[Column]
current-table shorthand    [Column]
function call              RELATED(Table[Column])
```

Column names inside `[...]` may contain spaces (`Products[Unit Cost]`), the
way real DAX bracket syntax works — the lexer reads everything up to the
closing `]` as one token rather than splitting on whitespace.

Operator precedence (highest to lowest): unary `-`, then `*`/`/`, then
`+`/`-`. Same-precedence operators are left-associative
(`10 - 2 - 3` is `(10 - 2) - 3`).

Not supported in **calculated columns** (`binder.ts`'s `bind()`), still:
`SUM`/`COUNT`/`AVERAGE`/`DISTINCTCOUNT`/`DIVIDE`, measure references,
filter context, and any function other than `RELATED` — calculated-column
semantics are unchanged from Sprint 3.

Sprint 4 adds a **second binding mode for measures**
(`measureBinder.ts`'s `bindMeasureExpression()`), sharing this same
lexer/parser/AST, that supports `SUM`/`AVERAGE`/`MIN`/`MAX`/`COUNT`/
`COUNTROWS`/`DISTINCTCOUNT`/`DIVIDE` and measure references but rejects
`RELATED` and naked physical columns — see [`MEASURES.md`](./MEASURES.md)
"Measure binding" for the full rules.

Sprint 8 adds `CALCULATE`, `FILTER`, `REMOVEFILTERS` and `ALL` to measure
mode only (comparison/logical operators are also valid as a *general* scalar
measure result, e.g. `[Total Revenue] > 100`) — see
[`CALCULATE.md`](./CALCULATE.md) for the full grammar, binding rules and
context-modification architecture. Using `CALCULATE` inside a **calculated
column** is rejected with `CALCULATE_CONTEXT_TRANSITION_NOT_SUPPORTED` —
context transition remains out of scope for calculated columns.

Sprint 9 adds a **third layer** on top of the same lexer/parser/AST: a
table-expression binder/evaluator (`FILTER`/`VALUES`/`DISTINCT`, reused by
both `CALCULATE` and the iterator functions — see
[`TABLE_EXPRESSIONS.md`](./TABLE_EXPRESSIONS.md)) and an iterator row-context
binder/evaluator (`SUMX`/`AVERAGEX`/`MINX`/`MAXX`/`COUNTX` — see
[`ITERATORS.md`](./ITERATORS.md)). It also extends **both** existing binder
modes with `IF`/`SWITCH`/`BLANK`/`TRUE()`/`FALSE()`, and lifts calculated
columns' Sprint 8 restriction on comparison/logical operators (`Sales[Revenue]
> 100` now binds in a calculated column, sharing the same
`compareScalarValues` scalar semantics measures already used — see
`src/expression/scalarComparison.ts`). `SELECTEDVALUE` is measure-only (it
reads the current FilterContext, which only measures have). No grammar
changes were needed for any of this — every new function is an ordinary
`FunctionCallNode` the existing parser already produces (the one small parser
addition is `TRUE()`/`FALSE()` as a zero-argument literal call, needed for the
canonical `SWITCH(TRUE(), ...)` shape). `DATEADD`'s bare `YEAR`/`QUARTER`/
`MONTH`/`DAY` interval keyword (Sprint 10) needed no parser addition either
— it parses as an ordinary `TableReferenceNode`, the same bare-identifier
shape a table name already produces. Classic Date Table time intelligence
is implemented as of Sprint 10 (measure mode only) — see
[`docs/TIME_INTELLIGENCE.md`](./TIME_INTELLIGENCE.md); calendar-based time
intelligence remains out of scope for both modes.

## AST (`src/expression/ast.ts`)

```text
Expression =
  | NumberLiteralNode | StringLiteralNode | BooleanLiteralNode
  | ColumnReferenceNode  { table: string | null; column: string }
  | UnaryExpressionNode  { operator: '-'; operand }
  | BinaryExpressionNode { operator: '+'|'-'|'*'|'/'; left; right }
  | FunctionCallNode     { name: string; args: Expression[] }
  | TableReferenceNode   { table: string }
  | ComparisonExpressionNode { operator: '='|'<>'|'>'|'>='|'<'|'<='; left; right }  // Sprint 8
  | LogicalExpressionNode    { operator: '&&'|'\|\|'; left; right }                  // Sprint 8
```

`ComparisonExpressionNode`/`LogicalExpressionNode` are a Sprint 8 addition —
see [`CALCULATE.md`](./CALCULATE.md) "Operator precedence" for the full
precedence table (relational binds tighter than equality, which binds
tighter than `&&`, which binds tighter than `\|\|`). `=` inside an expression
is always this comparison node, never assignment — measure-name assignment
stays outside the parser, unchanged.

Every node carries a `span: { start, end }` (character offsets into the
source string), and `ColumnReferenceNode` additionally carries
`tableSpan`/`columnSpan` so diagnostics can point at the exact substring
that's wrong (e.g. the `Revenu` in `Sales[Revenu]`).

`TableReferenceNode` is a Sprint 4 addition: a bare table name with no
`[...]`/`(...)` following it, e.g. the `Sales` in `COUNTROWS(Sales)`.
Sprint 3's parser threw a `SYNTAX_ERROR` for a bare identifier in that
position; the parser now accepts it unconditionally as a
`TableReferenceNode`, and whether it's valid where it appears (only as a
`COUNTROWS` argument in measure mode) is a **binder** decision, not a
parser one — see `measureBinder.ts`'s `BARE_TABLE_REFERENCE` diagnostic.
This is a pure grammar extension: no calculated-column expression that
parsed before Sprint 4 parses differently now.

## Parser (`src/expression/parser.ts`, `lexer.ts`)

A small hand-written recursive-descent parser over a hand-written
tokenizer — no `eval`, no `new Function`, no external DAX grammar
dependency. `parseExpression(source)` never throws: a malformed expression
returns `{ diagnostics: [{ code: 'SYNTAX_ERROR', ... }] }` with no
`expression`.

## Semantic binding (`src/expression/binder.ts`, `src/expression/measureBinder.ts`)

Sprint 4 does **not** add a `mode` flag to `bind()`. Instead it adds a
second, separate public entry point — `bindMeasureExpression()` in its own
module — that shares internals (`findModelTableByName`, the diagnostic
factory, `resolveTableRef`/`resolveColumnRef`) but implements different
rules, because a calculated column's row-context scoping
(`COLUMN_OUTSIDE_ROW_CONTEXT`) has no meaning for a measure — a measure's
whole point is reading any table in the model via `CALCULATE`(-adjacent)
constructs, later. See [`MEASURES.md`](./MEASURES.md) "Measure binding"
for `bindMeasureExpression`'s rules in full; this section covers only
`bind()` (calculated columns), unchanged from Sprint 3.

`bind(expression, { model, datasets, currentModelTableId })` resolves
every `ColumnReferenceNode`/`FunctionCallNode` against the real
`SemanticModel`:

- `Sales[Revenue]` (or `[Revenue]`) inside a calculated column that belongs
  to `Sales` resolves to a `ColumnRef` on `Sales`.
- `Products[Category]` referenced *directly* from a `Sales`-scoped column
  is rejected with `COLUMN_OUTSIDE_ROW_CONTEXT` — a physical column
  reference only ever resolves to the calculated column's own table. This
  is the row-context scope rule from `docs/CALCULATED_COLUMNS.md`.
- `RELATED(Products[Category])` resolves the *target* table/column freely
  (it's allowed to name any table in the model), then looks up the single
  active many→one relationship connecting the current table to it via
  `src/expression/relatedLookup.ts#resolveRelatedRelationship`. See
  `docs/CALCULATED_COLUMNS.md` for the full RELATED resolution rules and
  diagnostic codes.

Binding never coerces types and never guesses a name: an unresolved table
or column always produces a diagnostic instead of silently picking a
default.

## Evaluation (`src/expression/evaluator.ts`)

`evaluateBoundExpressionOverTable(bound, model, datasets, modelTableId)`
walks the target table's rows once, building an explicit `RowContext`
(`src/expression/rowContext.ts`) per row:

```ts
interface RowContext {
  modelId: string
  modelTableId: string
  rowIndex: number
  row: Record<string, unknown>
}
```

and evaluates the bound tree against it, returning:

- `values: unknown[]` — one value per row, same order as the table's rows.
- `errors: RowEvaluationError[]` — `{ rowIndex, code: 'TYPE_MISMATCH' |
  'DIVISION_ERROR', message }` for rows where arithmetic couldn't produce a
  value. The rest of the column still evaluates — one bad row never aborts
  the whole calculation.
- `previewTraces` — a full `ExecutionTraceNode` tree for the first
  `DEFAULT_PREVIEW_LIMIT` (100) rows only, so the UI's row-context
  visualizer has something to render without retaining a trace tree per
  row for a 100k-row table (see "Performance" below).

### Null/blank semantics

Sprint 3 uses plain JS `null` as blank, and picks the simplest deterministic
rule rather than replicating DAX's `BLANK()` coercion table: **any arithmetic
operator with a `null` operand returns `null`** (blank propagates). This is a
deliberate simplification — real DAX treats blank as `0` for `+`/`-` in some
contexts — documented here as a known Sprint 3 incompatibility. Division by
zero produces a `DIVISION_ERROR` row error and a `null` result rather than
`Infinity`/`NaN`.

### RELATED lookup index

`src/expression/relatedLookup.ts#buildRelatedIndex` builds a
`{ foreign key value -> one-side row }` `Map` for a relationship's one-side
table/column. `EvalContext.relatedIndexCache` builds this once per
relationship per evaluation pass (not per row), so a calculated column with
`RELATED` over N rows stays O(N) instead of re-scanning the one-side table
for every row. An unmatched foreign key returns `null` (blank) with
`metadata: { matched: false }` on its trace node — never a thrown error.

## Execution trace (`src/expression/trace.ts`)

```ts
interface ExecutionTraceNode {
  kind: 'literal' | 'column-read' | 'unary-operation' | 'binary-operation' | 'related-lookup' | 'result'
      | 'measure-reference' | 'aggregation' | 'filter-context' | 'relationship-propagation'
      | 'calculate' | 'filter-modifier' | 'boolean-filter' | 'table-filter' | 'remove-filters'
  label: string
  value?: unknown
  children?: ExecutionTraceNode[]
  metadata?: Record<string, unknown>
}
```

This is real runtime output — the row-context visualizer (calculated
columns) and the measure trace visualizer both render exactly this tree
through a shared `TraceNodeView` component, never a reconstructed
explanation string. `measure-reference`/`aggregation`/`filter-context`/
`relationship-propagation` are Sprint 4 additions — see
[`FILTER_CONTEXT.md`](./FILTER_CONTEXT.md) "Execution trace" for what each
one carries. `calculate`/`filter-modifier`/`boolean-filter`/`table-filter`/
`remove-filters` are Sprint 8 additions — see [`CALCULATE.md`](./CALCULATE.md)
"Execution trace" — rendered through the same `TraceNodeView` with no
component changes.

## Diagnostics (`src/expression/diagnostics.ts`)

```ts
type ExpressionDiagnosticCode =
  | 'SYNTAX_ERROR' | 'UNKNOWN_TABLE' | 'UNKNOWN_COLUMN' | 'COLUMN_OUTSIDE_ROW_CONTEXT'
  | 'TYPE_MISMATCH' | 'DIVISION_ERROR' | 'COLUMN_NAME_CONFLICT' | 'DUPLICATE_CALCULATED_COLUMN'
  | 'UNSUPPORTED_FUNCTION' | 'INVALID_FUNCTION_ARGUMENT'
  | 'RELATED_NO_RELATIONSHIP' | 'RELATED_INACTIVE_RELATIONSHIP'
  | 'RELATED_WRONG_DIRECTION' | 'RELATED_AMBIGUOUS_RELATIONSHIP'
  // Sprint 4 (measures / filter context)
  | 'BARE_TABLE_REFERENCE' | 'UNKNOWN_MEASURE' | 'DUPLICATE_MEASURE' | 'MEASURE_DEPENDENCY_CYCLE'
  | 'COLUMN_REQUIRES_AGGREGATION' | 'INVALID_AGGREGATION_ARGUMENT' | 'NON_NUMERIC_AGGREGATION'
  | 'FILTER_GRAPH_INVALID' | 'INVALID_FILTER_VALUE' | 'RELATED_REQUIRES_ROW_CONTEXT'
  // Sprint 8 (CALCULATE) — see docs/CALCULATE.md
  | 'INVALID_CALCULATE_ARITY' | 'CALCULATE_INVALID_FILTER_ARGUMENT'
  | 'BOOLEAN_FILTER_MULTIPLE_TABLES' | 'BOOLEAN_FILTER_MEASURE_REFERENCE' | 'BOOLEAN_FILTER_NESTED_CALCULATE'
  | 'FILTER_PREDICATE_NOT_BOOLEAN' | 'FILTER_ROW_CONTEXT_VIOLATION'
  | 'INVALID_REMOVEFILTERS_ARGUMENT' | 'INVALID_ALL_ARGUMENT' | 'CALCULATE_CONTEXT_TRANSITION_NOT_SUPPORTED'
```

`UNSUPPORTED_FUNCTION` (calling anything other than `RELATED`, or an
unrecognized function in measure mode) and `INVALID_FUNCTION_ARGUMENT`
(`RELATED`/`DIVIDE` called with the wrong shape of argument) are additions
beyond the sprint briefs' suggested lists — both briefs call their lists
"suggested categories" or "codes equivalent to", and the binder needs
*something* structured to return for cases the exact list doesn't name.
The Sprint 4 codes not in the sprint brief's literal list
(`BARE_TABLE_REFERENCE`, `RELATED_REQUIRES_ROW_CONTEXT`) follow the same
pattern — see [`MEASURES.md`](./MEASURES.md) for what each one means.

Every diagnostic carries `severity`, `code`, `message`, and (when it
applies to a specific piece of source) a `span`. `TYPE_MISMATCH` and
`DIVISION_ERROR` are the two codes that show up as *row-level*
`RowEvaluationError`s instead of expression-level diagnostics, since they
depend on an actual row's values, not just static structure.
`FILTER_GRAPH_INVALID` is unusual in that it has no `span` at all — it
describes a problem with the *model's* relationship graph, not a specific
piece of the measure's expression.

## Known incompatibilities with full DAX

- `CALCULATE`/`FILTER`/`ALL`/`REMOVEFILTERS` work in measure context only —
  no context transition (using them in a calculated column is rejected, not
  silently ignored). No time intelligence, no iterators (`SUMX`, etc.). See
  [`CALCULATE.md`](./CALCULATE.md) "Known DAX compatibility limitations" for
  the full, current list.
- Blank/`BLANK()` coercion rules are simplified (see above).
- Table/column name matching is case-insensitive; real DAX is
  case-insensitive for identifiers too, but the exact edge cases (e.g.
  Unicode normalization) aren't specially handled here.
- `RELATED` only follows a *direct*, *active*, *unambiguous* many→one
  relationship — no multi-hop relationship chains. (Filter propagation
  for measures, by contrast, *is* transitive — see `FILTER_CONTEXT.md`.)
- No calculated-column-to-calculated-column references (see
  `docs/CALCULATED_COLUMNS.md` "Dependency scope") — but a measure *can*
  aggregate a calculated column (see `MEASURES.md` "Logical column
  access").
