# Expression Engine (Sprint 3)

This document describes the reusable expression system introduced in
Sprint 3 to execute calculated-column formulas. It is designed to be the
same parser/AST/binder/diagnostics/trace machinery Sprint 4 (Measures)
extends with aggregation and filter-context semantics — not a one-off
calculated-column parser.

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

Not supported in Sprint 3 (see AGENTS.md/ROADMAP.md "Explicitly out of
scope"): `SUM`/`COUNT`/`AVERAGE`/`DISTINCTCOUNT`/`DIVIDE`, measure
references, filter context, `CALCULATE`, `FILTER`, `ALL`, time
intelligence, and any function other than `RELATED`.

## AST (`src/expression/ast.ts`)

```text
Expression =
  | NumberLiteralNode | StringLiteralNode | BooleanLiteralNode
  | ColumnReferenceNode  { table: string | null; column: string }
  | UnaryExpressionNode  { operator: '-'; operand }
  | BinaryExpressionNode { operator: '+'|'-'|'*'|'/'; left; right }
  | FunctionCallNode     { name: string; args: Expression[] }
```

Every node carries a `span: { start, end }` (character offsets into the
source string), and `ColumnReferenceNode` additionally carries
`tableSpan`/`columnSpan` so diagnostics can point at the exact substring
that's wrong (e.g. the `Revenu` in `Sales[Revenu]`).

## Parser (`src/expression/parser.ts`, `lexer.ts`)

A small hand-written recursive-descent parser over a hand-written
tokenizer — no `eval`, no `new Function`, no external DAX grammar
dependency. `parseExpression(source)` never throws: a malformed expression
returns `{ diagnostics: [{ code: 'SYNTAX_ERROR', ... }] }` with no
`expression`.

## Semantic binding (`src/expression/binder.ts`)

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
  label: string
  value?: unknown
  children?: ExecutionTraceNode[]
  metadata?: Record<string, unknown>
}
```

This is real runtime output — the row-context visualizer renders exactly
this tree, never a reconstructed explanation string. Sprint 4 is expected
to add `aggregation`, `filter-context`, `relationship-propagation` and
`calculate` trace kinds on top of the same shape.

## Diagnostics (`src/expression/diagnostics.ts`)

```ts
type ExpressionDiagnosticCode =
  | 'SYNTAX_ERROR' | 'UNKNOWN_TABLE' | 'UNKNOWN_COLUMN' | 'COLUMN_OUTSIDE_ROW_CONTEXT'
  | 'TYPE_MISMATCH' | 'DIVISION_ERROR' | 'COLUMN_NAME_CONFLICT' | 'DUPLICATE_CALCULATED_COLUMN'
  | 'UNSUPPORTED_FUNCTION' | 'INVALID_FUNCTION_ARGUMENT'
  | 'RELATED_NO_RELATIONSHIP' | 'RELATED_INACTIVE_RELATIONSHIP'
  | 'RELATED_WRONG_DIRECTION' | 'RELATED_AMBIGUOUS_RELATIONSHIP'
```

`UNSUPPORTED_FUNCTION` (calling anything other than `RELATED`) and
`INVALID_FUNCTION_ARGUMENT` (`RELATED` called with the wrong shape of
argument) are additions beyond the sprint brief's suggested list — the
brief calls its list "suggested categories", and the binder needs
*something* structured to return for those cases without perfectly
DAX-compatible functions.

Every diagnostic carries `severity`, `code`, `message`, and (when it
applies to a specific piece of source) a `span`. `TYPE_MISMATCH` and
`DIVISION_ERROR` are the two codes that show up as *row-level*
`RowEvaluationError`s instead of expression-level diagnostics, since they
depend on an actual row's values, not just static structure.

## Known incompatibilities with full DAX

- No aggregation functions (`SUM`, `COUNTROWS`, ...), no measures, no
  filter context, no `CALCULATE` — Sprint 4 scope.
- Blank/`BLANK()` coercion rules are simplified (see above).
- Table/column name matching is case-insensitive; real DAX is
  case-insensitive for identifiers too, but the exact edge cases (e.g.
  Unicode normalization) aren't specially handled here.
- `RELATED` only follows a *direct*, *active*, *unambiguous* many→one
  relationship — no multi-hop relationship chains.
- No calculated-column-to-calculated-column references (see
  `docs/CALCULATED_COLUMNS.md` "Dependency scope").
