# Applied Steps (Sprint 12)

Each entry is one `QueryStep` union member (`domain/query.ts`) plus its pure
evaluator (`runtime/query/steps/*.ts`). See
[`docs/POWER_QUERY_RUNTIME.md`](./POWER_QUERY_RUNTIME.md) for the shared
architecture (evaluation order, stable identity, dependency graph). Every
step's config references columns by `columnId`, never by name — a rename
upstream never breaks a step that already resolved its column id (see
"Stable column identity").

Every evaluator has the same shape: `(frame, step[, context]) => { frame?,
diagnostics }`. On any error-severity diagnostic, `frame` is omitted, the
step is marked `'error'`, and every later step in the pipeline is marked
`'skipped'` — the Step Failure Boundary described in
`docs/POWER_QUERY_RUNTIME.md`.

## Rename Columns (`rename-columns`)

```ts
{ kind: 'rename-columns', renames: { columnId: string; newName: string }[] }
```

Preserves every `DataColumn.id` — only `name` changes, and row values are
re-keyed from the old name to the new one. Validates: every `columnId`
exists, every `newName` is non-blank, and no two resulting names collide
(case-insensitive) — `QUERY_COLUMN_NOT_FOUND` / `QUERY_INVALID_STEP_CONFIG`
/ `QUERY_DUPLICATE_COLUMN_NAME`.

## Remove Columns (`remove-columns`)

```ts
{ kind: 'remove-columns', columnIds: string[] }
```

Drops the named columns; the remaining columns keep their ids and relative
order. Removing every column fails with `QUERY_NO_COLUMNS` rather than
producing a zero-column table.

## Reorder Columns (`reorder-columns`)

```ts
{ kind: 'reorder-columns', columnOrder: string[] }
```

Pure schema-order operation — a stable sort against `columnOrder`; ids and
row values never change. `QUERY_COLUMN_NOT_FOUND` if a listed id no longer
exists.

## Change Type (`change-type`)

```ts
{ kind: 'change-type', changes: { columnId: string; dataType: DataType }[] }
```

Deterministic, non-lossy conversion (`steps/changeType.ts#convertValue`) —
never JavaScript loose coercion. `null`/`undefined` always stays `null`
regardless of target type. Accepted shapes per target:

- `integer` — an actual integer `number`, or a string matching `^[+-]?\d+$`
- `decimal` — a finite `number`, or a string matching `^[+-]?\d+(\.\d+)?$`
- `boolean` — an actual `boolean`, or `"true"`/`"false"` (case-insensitive)
- `date` — an ISO `YYYY-MM-DD` string (stored as-is) or an ISO datetime
  string (truncated to its date part); a real `Date` instance
- `datetime` — an ISO datetime or date string (stored as a full ISO
  string); a real `Date` instance
- `string` — anything, via `String(value)`

Ambiguous, locale-dependent formats like `01/02/2026` are rejected, not
guessed — see `docs/POWER_QUERY_RUNTIME.md` "Known compatibility
limitations". Any value that doesn't match its target's accepted shape
fails the **entire step** with `QUERY_TYPE_CONVERSION_FAILED`, carrying the
offending column name, up to 5 sample offending values, and a total failure
count — never a silent `0`/`false`/dropped row.

## Filter Rows (`filter-rows`)

```ts
{
  kind: 'filter-rows',
  logic: 'and' | 'or',
  conditions: { columnId: string; operator: QueryFilterOperator; value?: unknown }[],
}
```

`QueryFilterOperator`: `equals` · `not-equals` · `greater-than` ·
`greater-than-or-equal` · `less-than` · `less-than-or-equal` · `contains` ·
`starts-with` · `ends-with` · `is-blank` · `is-not-blank`. `is-blank`/
`is-not-blank` ignore `value`; every other operator treats a blank cell as
never matching (so `Revenue > 0` correctly excludes a blank `Revenue`, it
doesn't error). String comparisons for `contains`/`starts-with`/`ends-with`
are case-insensitive. At least one condition is required
(`QUERY_INVALID_FILTER`); a missing column is
`QUERY_COLUMN_NOT_FOUND`.

## Replace Values (`replace-values`)

```ts
{ kind: 'replace-values', replacements: { columnId: string; find: unknown; replace: unknown }[] }
```

Exact-match replacement (including `find: null` for "replace blanks") in
one or more columns, one or more replacements per step. A replacement value
whose type is incompatible with the column's current `dataType` (e.g. a
string into a numeric column) fails with `QUERY_INVALID_STEP_CONFIG` rather
than silently changing the column's effective type.

## Remove Duplicates (`remove-duplicates`)

```ts
{ kind: 'remove-duplicates', columnIds?: string[] }
```

Detects duplicates by the listed columns, or by every column when
`columnIds` is omitted/empty. Keeps the first occurrence, scanning rows in
their existing order — deterministic regardless of input order.

## Sort Rows (`sort-rows`)

```ts
{ kind: 'sort-rows', keys: { columnId: string; direction: 'asc' | 'desc' }[] }
```

Stable multi-key sort. Blanks sort first ascending / last descending.
Values are compared by type: boolean → numeric, number → numeric,
ISO-date-like string → parsed date, everything else → locale string
compare.

## Fill Down / Fill Up (`fill`)

```ts
{ kind: 'fill', direction: 'down' | 'up', columnIds: string[] }
```

Only `null`/`undefined` count as blank — `0`, `false`, and `""` are real
values and are never overwritten (brief §28). A leading run of blanks with
no prior value in the fill direction stays blank; there's nothing to carry
forward.

## Split Column (`split-column`)

```ts
{
  kind: 'split-column',
  columnId: string,
  delimiter: string,
  outputNames: [string, string],
  outputColumnIds: [string, string],   // generated once at step creation
  removeSource: boolean,
}
```

Bounded to exactly two output columns for Sprint 12. A missing delimiter
puts the whole value in output 1 and `null` in output 2; a `null` source
value produces `null`/`null`. Output column ids are generated once when the
step is *created* (`queryStepFactory.ts`) and persisted in the step —
never regenerated on re-evaluation. An output name colliding with an
existing column is `QUERY_DUPLICATE_COLUMN_NAME`.

## Merge Columns (`merge-columns`)

```ts
{
  kind: 'merge-columns',
  columnIds: string[],
  delimiter: string,
  newColumnName: string,
  outputColumnId: string,   // generated once at step creation
  removeSource: boolean,
}
```

Combines (concatenates) two or more columns with a delimiter into one new
string column — not to be confused with **Merge Queries** below. At least
two source columns are required.

## Group By (`group-by`)

```ts
{
  kind: 'group-by',
  groupColumnIds: string[],
  aggregations: {
    outputColumnId: string,          // generated once at step creation
    outputName: string,
    function: 'count-rows' | 'sum' | 'average' | 'min' | 'max',
    sourceColumnId?: string,          // unused for count-rows
  }[],
}
```

A pure Power Query transformation — it never calls the DAX Measure Runtime
(brief §31). `sum`/`average` require a numeric (`integer`/`decimal`) source
column; `min`/`max` accept numeric or `date`/`datetime`; `count-rows` needs
no source column. A type mismatch (e.g. `SUM` over a string column) fails
with `QUERY_INVALID_STEP_CONFIG`. Nulls are excluded from numeric
aggregation, not treated as zero. Aggregation output ids are generated once
at step creation, mirroring Split/Merge Columns.

## Merge Queries (`merge-queries`)

```ts
{
  kind: 'merge-queries',
  right: QuerySource,
  joinKind: 'left-outer' | 'right-outer' | 'full-outer' | 'inner' | 'left-anti' | 'right-anti',
  leftKeys: string[],
  rightKeys: string[],
  expand: { rightColumnId: string; outputColumnId: string; outputName: string }[],
}
```

Joins the current query's rows against another `QuerySource` (another query
or a raw dataset-table). This is a **bounded** merge
(`docs/POWER_QUERY_RUNTIME.md` "Known compatibility limitations"): there's
no intermediate nested-table value — the step itself selects which right-
side columns to expand, with explicit output names/ids. An expand alias
colliding with an existing left column is `QUERY_MERGE_COLUMN_COLLISION`.

Keys: one or more column-id pairs (`leftKeys[i]` ↔ `rightKeys[i]`), each
pair's types must be in the same category (numeric / string / boolean /
temporal) or the step fails with `QUERY_JOIN_KEY_TYPE_MISMATCH`. A `null`
key value never matches anything — including another `null` — matching SQL
join semantics.

Multi-column keys use a typed, escaped composite key (`JSON.stringify` over
the ordered key values), never unsafe string concatenation — `["1","2"]`
and `["1|2"]` never collide.

**Performance**: the right side is indexed once into a `Map<compositeKey,
rowIndex[]>` and probed per left row — never a left-rows × right-rows
nested loop (brief §77). Output row growth (row explosion from duplicate
keys on either side) is checked against `DATA_LIMITS.maxRowsPerTable` as
rows are produced, failing with `QUERY_ROW_LIMIT_EXCEEDED` rather than
building an unbounded array.

## Append Queries (`append-queries`)

```ts
{
  kind: 'append-queries',
  sources: QuerySource[],
  columns: { name: string; outputColumnId: string }[],   // generated once at step creation
}
```

Appends the current query's rows with one or more other sources' rows, in
source order. The output schema is the union of column *names* across every
source (current query first, then `sources` in order); a source missing a
column gets `null` for it. `columns` — the name → output-column-id mapping
— is computed once when the step is created; if a genuinely new column name
later appears upstream that wasn't in that map, a deterministic fallback id
(`${stepId}::append::${name}`) is used rather than calling `generateId`
during evaluation (brief §76).

**Type lattice** (brief §40): a column with the same type across every
source that has it passes through unchanged; an `integer`+`decimal` mix
promotes to `decimal`; any other mismatch (e.g. `number` + `string`) is a
structured `QUERY_INVALID_STEP_CONFIG` failure — never a silent coercion.

## Diagnostic codes

Every step evaluator and the top-level runtime use exactly these codes
(`domain/query.ts#QueryDiagnosticCode`) — no raw exceptions are ever shown
to the learner:

| Code | Meaning |
| --- | --- |
| `QUERY_SOURCE_NOT_FOUND` | The query's `source` dataset/table doesn't exist. |
| `QUERY_DEPENDENCY_NOT_FOUND` | A referenced query (source, Merge right, Append source) doesn't exist or has no output. |
| `QUERY_DEPENDENCY_CYCLE` | The query is part of a dependency cycle. |
| `QUERY_COLUMN_NOT_FOUND` | A step references a column id that no longer exists. |
| `QUERY_DUPLICATE_COLUMN_NAME` | A step would produce two columns with the same name. |
| `QUERY_TYPE_CONVERSION_FAILED` | Change Type couldn't convert one or more values. |
| `QUERY_INVALID_FILTER` | Filter Rows has no conditions. |
| `QUERY_INVALID_STEP_CONFIG` | A step's own configuration is invalid (bad aggregation type, incompatible replace/append type, blank delimiter, etc.). |
| `QUERY_DEPENDENCY_SCHEMA_CHANGED` | A Merge key/expand column no longer exists on its dependency's current output. |
| `QUERY_JOIN_KEY_TYPE_MISMATCH` | Merge key columns aren't type-compatible. |
| `QUERY_MERGE_COLUMN_COLLISION` | An expanded Merge column's name collides with an existing one. |
| `QUERY_ROW_LIMIT_EXCEEDED` | Output would exceed `DATA_LIMITS.maxRowsPerTable`. |
| `QUERY_COLUMN_LIMIT_EXCEEDED` | Output would exceed `DATA_LIMITS.maxColumns`. |
| `QUERY_STEP_FAILED` | Generic fallback for a step failure not covered above. |
| `QUERY_NOT_LOADED` | A load-disabled query's output was asked for by something that requires Enable Load. |
| `QUERY_NO_COLUMNS` | Remove Columns would leave zero columns. |

## UI scope note

The Query cell UI (`components/notebook/query/QueryCellCard.tsx`) exposes
add/rename/reorder/delete for every step kind, plus a live Applied Steps
list with per-step status and row/column metrics, and lets you click any
step to preview the pipeline's state at that point. Full pre-filled
"edit in place" forms for every step kind are not built for Sprint 12 —
delete-and-re-add is Power Query's own natural "undo" (brief §71) and is
fully supported; the runtime's `updateQueryStep` exists and is tested
headlessly for exactly this reason (AGENTS.md guardrail: "Do not build
visual polish before runtime correctness").
