# Calculated Columns (Sprint 3)

This document describes the calculated-column domain/runtime/UI layer built
on top of `docs/EXPRESSION_ENGINE.md`. It is the first place the product
genuinely *executes* a Power BI-style formula against real row data, rather
than just representing data or a model.

## Domain contract (`src/domain/model.ts`)

```ts
interface CalculatedColumn {
  id: string
  modelTableId: string
  name: string
  expression: string
  dataType: DataType | 'unknown'
  createdAt: string
  updatedAt: string
}

interface SemanticModel {
  ...
  calculatedColumns: CalculatedColumn[]
}
```

Calculated columns belong to the `SemanticModel`, not to `Dataset`/
`DataTable` — `Dataset.rows` and `DataTable.columns` are never mutated to
pretend a calculated column is a physical one. The definition (name,
expression, target table, inferred type) is what's persisted; the
evaluated *output* is a separate, recomputable structure (see
"Execution output" below).

## Notebook cell contract (`src/domain/notebook.ts`)

```ts
interface CalculatedColumnCell extends BaseNotebookCell {
  kind: 'calculated-column'
  modelId: string
  calculatedColumnId: string
}
```

`calculated-column` was removed from `GenericCellKind` — it's now a fully
typed cell, like `DataCell`/`ModelCell`. Both `modelId` and
`calculatedColumnId` are always required: **there is no draft
`CalculatedColumnCell`**. A `CalculatedColumnCell` always references an
already-valid, already-created `CalculatedColumn`.

### Where invalid drafts live

An expression that fails to parse or bind never becomes canonical model
state, and never becomes a cell. While the learner is typing (in the
"+ New calculated column" panel, or editing an existing cell's expression),
the draft lives only in local React component state
(`CreateCalculatedColumnPanel`/`CalculatedColumnCellCard`). Only a
successful `createCalculatedColumn`/`updateCalculatedColumn` call — no
error-severity diagnostics — mutates the `SemanticModel` and (for create)
appends the cell.

## Grammar, AST, binding, row context

See `docs/EXPRESSION_ENGINE.md` for the full expression pipeline. The
summary relevant to calculated columns specifically:

- A calculated column always evaluates in the row context of exactly one
  table — its `modelTableId`.
- `Sales[Revenue]` and `[Revenue]` are equivalent inside a calculated
  column on `Sales`; a bare `Products[Category]` reference from that same
  column is rejected (`COLUMN_OUTSIDE_ROW_CONTEXT`) — the learner must
  write `RELATED(Products[Category])` instead. This is the whole point of
  Sprint 3's row-context teaching goal (`docs/LEARNING_MODEL.md` Level 3).

### Conditional and comparison logic (Sprint 9)

Sprint 8 rejected comparison (`=`, `<>`, `>`, `>=`, `<`, `<=`) and logical
(`&&`, `||`) operators in calculated columns with `UNSUPPORTED_FUNCTION` — a
deliberate stopgap, not a permanent restriction. Sprint 9 lifts it: a
calculated column can now use them directly (`Sales[Revenue] > Sales[Cost]`),
plus `IF(condition, whenTrue, [whenFalse])`, `SWITCH(expression, value1,
result1, ..., [default])` (including `SWITCH(TRUE(), ...)`) and `BLANK()`.
None of this needs row-context → filter-context transition — it's pure
per-row scalar branching, unlike `CALCULATE`, which stays rejected here (see
`docs/CALCULATE.md` "Context transition boundary"). Scalar comparison
semantics (blank handling, no cross-type coercion) are shared with measures
via `compareScalarValues` (`src/expression/scalarComparison.ts`), not
reimplemented — see `docs/ITERATORS.md` "Conditional logic" for the full
behavior table (it applies identically here).

## RELATED rules

`RELATED(Table[Column])` resolves the single active relationship connecting
the calculated column's own table to the named table
(`src/expression/relatedLookup.ts#resolveRelatedRelationship`). Sprint 3
only supported a direct active unambiguous many-side lookup; Sprint 11
generalized this to be cardinality-aware, branching on the resolved
relationship's `cardinality`:

- **`one-to-many`** (unchanged from Sprint 3): only many→one is ever a
  valid `RELATED` direction — a many-side row unambiguously looks up its
  one-side row, and the reverse has no such guarantee
  (`RELATED_WRONG_DIRECTION` for the reverse).
- **`one-to-one`** (Sprint 11): both endpoints are unique, so `RELATED` is
  valid from either side — no `RELATED_WRONG_DIRECTION` for a 1:1
  relationship.
- **`many-to-many`** (Sprint 11): neither side is guaranteed unique, so
  `RELATED` could only ever pick an arbitrary matching row — always
  rejected with `RELATED_UNSUPPORTED_CARDINALITY` rather than silently
  choosing one.

| Situation | Diagnostic |
|---|---|
| No relationship at all between the two tables | `RELATED_NO_RELATIONSHIP` |
| A relationship exists in a valid direction but is inactive | `RELATED_INACTIVE_RELATIONSHIP` |
| A `one-to-many` relationship exists but runs the other way (current table is the "1" side) | `RELATED_WRONG_DIRECTION` |
| More than one active relationship connects the same two tables | `RELATED_AMBIGUOUS_RELATIONSHIP` |
| The relationship connecting the two tables is `many-to-many` | `RELATED_UNSUPPORTED_CARDINALITY` |
| The named table/column doesn't exist | `UNKNOWN_TABLE` / `UNKNOWN_COLUMN` |

`RELATED` deliberately ignores `crossFilterDirection` in every case — it's a
row-context lookup concept, not a visual filter-propagation concept. The
actual index-building (`resolveRelatedIndexAndKey`) is generic across every
supported cardinality: it resolves whichever side matches the requested
target column as the index side, and the other side as the current row's
own foreign-key column — one implementation, shared with iterator row
expressions (`SUMX`/etc., see [`docs/ITERATORS.md`](./ITERATORS.md)). See
[`docs/ADVANCED_RELATIONSHIPS.md`](./ADVANCED_RELATIONSHIPS.md) "RELATED
compatibility" for the full design.

If the current row's foreign key has no matching row on the other side
(e.g. a `ProductID` that doesn't exist in `Products`), `RELATED` returns
blank (`null`) for that row rather than an error — this is normal, expected
data, not a failure, and it's shown in the trace as
`metadata: { matched: false }`.

`RELATED` uses an indexed one-side lookup
(`src/expression/relatedLookup.ts#buildRelatedIndex`), built once per
relationship per evaluation, so a `RELATED` calculated column stays O(n)
across the whole table rather than scanning the one-side table per row.

## Execution output (not persisted)

```ts
interface CalculatedColumnExecution {
  calculatedColumnId: string
  dataType: DataType | 'unknown'
  values: unknown[]                 // one per row, in table row order
  errors: RowEvaluationError[]      // TYPE_MISMATCH / DIVISION_ERROR, per row
  previewTraces: RowTrace[]         // full trace tree, first 100 rows only
  columnDiagnostics: ExpressionDiagnostic[]
}
```

`columnDiagnostics` is non-empty only when the *whole column* can no
longer bind right now — most commonly because a `RELATED` relationship it
depends on was disabled or removed after the column was created. In that
case `values`/`errors`/`previewTraces` are empty and the cell shows the
diagnostic instead of a preview. This is re-derived from the model every
time (`runtime/calculatedColumn/calculatedColumnRuntime.ts#evaluateCalculatedColumn`)
— it is never a stale cached failure.

Only the `CalculatedColumn` definition is persisted (inside
`SemanticModel.calculatedColumns`, via the existing `modelStore.ts`).
Execution output is always recomputed from the current model + dataset
state — cheap enough for the sprint's data sizes (100k rows, simple
arithmetic) that no execution cache is needed yet. Correctness over
caching, per the sprint brief.

## Result type inference

A calculated column's `dataType` is inferred from its *actual evaluated
values* using the existing `lib/profiling/inferType.ts#inferColumnType` —
the same reducer Sprint 1 uses for imported columns. No separate type
vocabulary was introduced.

## Runtime API (`src/runtime/calculatedColumn/calculatedColumnRuntime.ts`)

Pure `(model, datasets, ...) => result` functions, mirroring the pattern
`runtime/model/modelRuntime.ts` established in Sprint 2:

- `validateCalculatedColumn` — name-conflict checks + parse + bind, no
  mutation. Shared by create/update and reusable by the UI for live
  diagnostics.
- `createCalculatedColumn` — validate → evaluate → infer type → append to
  `model.calculatedColumns`, only if there are no error diagnostics.
- `updateCalculatedColumn` — same flow against an existing definition
  (name-conflict check excludes the column being edited).
- `removeCalculatedColumn` — removes the definition only; removing the
  cell is the caller's job (see `NotebookRuntime.removeCalculatedColumnCell`).
- `evaluateCalculatedColumn` — recomputes a *persisted* definition's output
  from scratch (used after reload, and by the UI on every render so the
  preview always reflects current model state).

`NotebookRuntime` (Sprint 1/2) gained
`createCalculatedColumnCell`/`updateCalculatedColumn`/
`removeCalculatedColumnCell`, which are thin wrappers: call the pure
runtime function, and only touch notebook/model state when it reports
success — exactly like the Sprint 2 model actions.

## Name validation

Within a `SemanticModel`, a calculated column's name (case-insensitive)
must not collide with:

- a physical column on the same target table (`COLUMN_NAME_CONFLICT`), or
- another calculated column on the same table (`DUPLICATE_CALCULATED_COLUMN`).

## Dependency scope

Sprint 3 calculated columns may reference physical columns on their own
table, and physical columns on other tables through `RELATED`. They may
**not** reference another calculated column
(`[Margin] / [Revenue]` where `Margin` is itself calculated is out of
scope) — there is no dependency graph or cycle detection yet. This keeps
binding a single pass with no risk of a cycle between calculated columns;
Sprint 4+ can revisit this once it's actually needed.

## Model canvas integration

`ModelTableNode` renders each table's calculated columns beneath its
physical columns, each prefixed with an `fx` badge
(`components/notebook/model/ModelTableNode.tsx`). Calculated columns don't
participate in relationships — the relationship form still only offers
physical columns.

## Performance

- Arithmetic over the full 100,000-row dataset limit is a single linear
  pass per calculated column; no quadratic behavior.
- `RELATED` is indexed (see above), so it's linear too.
- Full execution traces are only retained for the first 100 rows
  (`DEFAULT_PREVIEW_LIMIT` in `expression/evaluator.ts`) to avoid holding a
  trace tree per row for large tables; `values`/`errors` still cover every
  row.

## Known limitations

- No calculated-column-to-calculated-column references (see above).
- No dependency graph / invalidation ordering — this doesn't matter yet
  since columns can't depend on each other.
- Blank/type-mismatch semantics are a deliberate Sprint 3 simplification,
  not full DAX compatibility (`docs/EXPRESSION_ENGINE.md` "Null/blank
  semantics").
- The expression editor is a plain textarea, not an IDE — no autocomplete,
  no inline squiggles at the exact span yet (spans are already tracked in
  diagnostics for a future editor to use).
