# Power Query Runtime (Sprint 12)

Sprint 1–11 built a DAX/modeling sandbox: import a table, model it,
calculate over it. Real Power BI work starts one stage earlier — cleaning
and shaping messy source data before it ever reaches the model:

```text
RAW SOURCE
     ↓
POWER QUERY (Applied Steps)
     ↓
Transformed Query Output
     ↓
Semantic Model
     ↓
DAX
     ↓
Visuals
```

This document covers the architecture: the domain contract, dependency
graph, stable identity strategy, evaluation runtime, and the boundary
between Power Query and the existing BI engine. See
[`docs/APPLIED_STEPS.md`](./APPLIED_STEPS.md) for the fourteen step kinds
themselves and their per-step contracts/diagnostics.

## M-language boundary

Sprint 12 implements Power Query's transformation workflow through typed
Applied Steps (`domain/query.ts`'s `QueryStep` union). **It does not parse or
execute arbitrary Power Query M.** There is no M lexer/parser/interpreter
anywhere in this codebase, and the DAX expression engine
(`src/expression/*`) is never reused as an M parser — they are different
languages with different semantics. A `QueryStep` is data (a discriminated
union with typed fields), not source code in any language. This also means:
no Advanced Editor, no custom M functions, no query folding, no native-query
inspection. See §92 of the sprint brief for the full out-of-scope list
(connectors, parameters, dataflows, incremental refresh, Pivot/Unpivot,
Conditional/Index/Custom columns, fuzzy merge, RLS, calculated tables — none
of these exist yet).

## Definitions vs. results

A `QueryDefinition` (`domain/query.ts`) is the persisted, authoritative
description of a transformation pipeline:

```ts
interface QueryDefinition {
  id: string
  name: string
  source: QuerySource
  steps: QueryStep[]
  outputDatasetId: string
  outputTableId: string
  loadEnabled: boolean
  createdAt: string
  updatedAt: string
}
```

Its evaluated result — a `Dataset` — is always *derived*, never persisted as
authority (`persistence/queryStore.ts` only ever writes `QueryDefinition`s).
Every evaluation recomputes the result from scratch by replaying
`source` → `steps` in order. This is what makes hard reload, step editing,
and dependency propagation all work the same way: there is exactly one
source of truth, and "what does this query currently produce" is always a
pure function of it.

## Raw source immutability

Sprint 1 imported `Dataset`s (backing `DataCell`) remain the immutable
source layer. No step evaluator ever mutates a `Dataset`/`DataTable`/row in
place — every step (`runtime/query/steps/*.ts`) returns a new `QueryFrame`
(a lightweight `{ columns, rows }` pair distinct from a full `DataTable`).
The learner can always remove every step and see the original source again,
because the source was never touched.

## Query source

```ts
type QuerySource =
  | { kind: 'dataset-table'; datasetId: string; tableId: string }
  | { kind: 'query'; queryId: string }
```

A query can source from a raw imported table, or from another query's
output (the "Reference Query" staging pattern — `Sales Base` → `Sales
Clean` → `Sales Final` — without duplicating data). The Query UI always
renders `Source` as the first, fixed entry in Applied Steps — it comes from
`QueryDefinition.source`, not from `steps[0]`, so it can never accidentally
be reordered below a transformation.

## Stable identity

This is the property the rest of the sprint hangs off of. Two identities
must survive re-evaluation and editing, or every relationship/measure built
on top of a query would break the moment the learner touched a step.

**Output identity.** `outputDatasetId`/`outputTableId` are generated once,
at query creation (`queryRuntime.createQueryDefinition`), and never
regenerated. Re-evaluating a query (`queryRuntime.evaluateAllQueries`)
always writes its result to the *same* `Dataset.id`/`DataTable.id`. A
`SemanticModel`'s `TableRef` keeps pointing at the same dataset/table across
every edit.

**Column identity.** Schema-preserving steps (Rename, Change Type, Filter,
Replace, Sort, Fill, Remove Duplicates) keep every `DataColumn.id` exactly
as it was on the input frame — only `name`/`dataType` change. Schema-
*generating* steps (Split Column, Merge Columns, Group By aggregations,
Merge expand columns) get ids generated exactly once, at the point the step
is *created* (`runtime/query/queryStepFactory.ts#buildStep`), and persisted
inside the step's own config from then on — the evaluator (`steps/*.ts`)
only ever *reads* ids from the step, it never calls `generateId` itself.
This is what makes evaluation deterministic (brief §76: "no random column
IDs during evaluation") and what lets Append's schema union
(`AppendQueriesStep.columns: { name, outputColumnId }[]`) stay stable even
though it's derived from other queries' schemas.

## Query dependency graph

`runtime/query/queryGraph.ts#buildQueryGraph` walks every query's `source`
plus any Merge (`right`) / Append (`sources`) references to build a
dependency DAG, and returns a dependency-first evaluation order via DFS.

Cycles and missing dependencies **fail closed**: a query in a cycle, or one
that depends (directly or transitively) on a cyclic or missing query, is
excluded from the evaluation order entirely (`graph.blocked`) rather than
being evaluated against partial/garbage state. The graph never recurses
indefinitely — each query is visited at most once (`visiting`/`done`
states), and a cycle is detected the moment DFS re-enters a `visiting` node.

## Query fingerprint / revision

`runtime/query/queryFingerprint.ts#computeQueryFingerprint` hashes exactly:
`source` + each step's config (with `id`/`name` stripped) + the already-
computed fingerprints of every dependency. It deliberately excludes:

- the step's display `name` (renaming a step is cosmetic — see brief §105)
- `QueryDefinition.name`, `loadEnabled`, `createdAt`/`updatedAt`
- anything UI-only (selected step, panel width, scroll position)

This fingerprint becomes a derived dataset's `revision`
(`DatasetSource: { type: 'query'; queryId; revision }`, `domain/data.ts`).
`revision` changes exactly when re-evaluating the query would produce
different output — including a *row-only* edit like tightening a Filter
Rows threshold, where the schema never changes at all.

### Validation staleness

Before Sprint 12, `computeValidationFingerprint` (`runtime/validation/
fingerprint.ts`) only tracked schema (table/column names+types),
relationships, and calculated-column/measure expressions — enough when
every table came from an immutable raw import. Once a table can come from a
query, a row-only edit (Filter Rows, Replace Values, Remove Duplicates)
changes *results* without changing *schema*, and the old fingerprint
wouldn't notice. The fix is one field: each table's fingerprint payload now
also includes `resolved.dataset.source.revision` when the table's dataset
is query-sourced. Editing a query's filter threshold bumps `revision`,
which bumps the validation fingerprint, which turns a previous PASS into
STALE immediately — with zero query-specific logic anywhere else in the
Validation Engine.

## Evaluation architecture

`runtime/query/`:

```text
queryRuntime.ts       top-level API: evaluateAllQueries, frameAtStep,
                       createQueryDefinition, addQueryStep, updateQueryStep,
                       removeQueryStep, moveQueryStep, renameQuery(Step),
                       setQueryLoadEnabled, findDependentQueryIds
queryEvaluator.ts      runs one query's Applied Steps pipeline in order
queryGraph.ts          dependency DAG + safe evaluation order
queryFingerprint.ts    the semantic fingerprint described above
queryFrame.ts          the in-flight { columns, rows } shape steps operate on
queryDiagnostics.ts    small factory for QueryDiagnostic objects
stepContext.ts         what a step needs beyond its own frame (resolving
                       another QuerySource for Merge/Append; row/column limits)
queryStepFactory.ts    builds a fully-formed QueryStep, generating any new
                       column ids exactly once
steps/*.ts             one pure evaluator per step kind (see APPLIED_STEPS.md)
```

`evaluateAllQueries(queries, datasets, limits)` evaluates every query in
dependency order, threading each query's already-computed `QueryEvaluationDetail`
into the next one's `StepContext.resolveSource` (so a Merge/Append/query-source
step reads its dependency's *current* output, never re-running it). Each
query's own pipeline (`evaluateStepPipeline`) runs its steps strictly in
order and **stops at the first failure** — this is the "Step Failure
Boundary" (brief §16): every step after the failure is marked `'skipped'`,
never `'success'` or `'error'`, so the UI can show "not evaluated" rather
than implying something ran and silently did nothing.

A query's `output` is always the frame as of the *last successfully-executed
step* — even Source, if step 1 already fails — never `undefined` merely
because a later step broke. This is deliberate: a `SemanticModel`/`Measure`
built on this query keeps a valid (if stale) dataset to bind against instead
of losing its table entirely the moment one step in a long pipeline breaks.
(The one place `output` really is `undefined` is when the query's own
*dependency graph* position is blocked — a cycle, or a missing dependency —
since there's no sensible frame to fall back to at all.)

`frameAtStep(evaluation, stepIndex)` (`stepIndex` 0 = Source, `i` = after
`steps[i - 1]`) is how "select an Applied Step, see its result"
(brief §13) works — the frame for every step is already computed as part of
the same evaluation pass; the UI never re-runs transformation logic itself.

## Model integration boundary

Every existing BI subsystem — Semantic Model, Calculated Columns, Measures,
CALCULATE, Iterators, Time Intelligence, Relationships, Visual Runtime —
consumes a query's output exactly like any other `Dataset`, through the
same `Record<string, Dataset>` map `DataCell`s have always used
(`runtime/notebook/notebookRuntime.ts`'s `NotebookRuntimeSnapshot.datasets`).
None of it contains a single `import` from `runtime/query/*`. Proof: a
model's "Add Table" panel (`TableRegistrationPanel.tsx`) iterates
`Object.values(datasets)` generically — a query's output shows up there for
free the moment it's registered, with zero Power-Query-aware code added to
the model layer.

`NotebookRuntime` is the only place that bridges the two: every query
mutation (`addQueryStep`, `updateQueryStep`, `removeQueryStep`,
`moveQueryStep`, `setQueryLoadEnabled`, `deleteQuery`, `renameQuery`) calls
a private `reEvaluateQueries()` that re-runs `evaluateAllQueries` and folds
every `loadEnabled` query's output back into `datasets` under its stable
`outputDatasetId`. A disabled query's output is removed from `datasets` (so
it can't be registered on a model — brief §43 "staging queries") but stays
resolvable by id for *sibling* queries that reference it as a source.
Because the output id never changes, this re-fold never requires touching
any `SemanticModel` — a `Measure` built on a query keeps working, and its
next evaluation simply reads the new rows.

## Hydration order

On load (`useNotebookRuntime.ts`): raw datasets and `QueryDefinition`s
hydrate from IndexedDB (`persistence/notebookStore.ts`,
`persistence/queryStore.ts`) and are handed to `NotebookRuntime.replaceAll`,
then `NotebookRuntime.refreshQueries()` runs once to (re)compute every
query's evaluation and fold `loadEnabled` outputs into `datasets` — query
evaluations are never persisted, so this is the only place they're rebuilt.
Only after that does the rest of the app (models, measures, visuals) see a
stable `datasets` map. A pre-Sprint-12 notebook has no `QueryCell`s and an
empty query store, so `refreshQueries()` is a no-op and hydration behaves
exactly as it did in Sprint 1–11 (see `tests/runtime/query/
legacyCompatibility.test.ts`).

## Known compatibility limitations

- No query folding, no native-query inspection — every source is read in
  full and transformed locally.
- Merge is "bounded": the right side is joined and only explicitly selected
  columns are expanded into the output — there's no intermediate
  nested-table value the way Power Query's own Merge produces before
  expansion.
- Append's type lattice is intentionally small: identical types pass
  through, a numeric mix promotes to `decimal`, anything else is a
  structured `QUERY_INVALID_STEP_CONFIG` failure rather than a silent
  coercion.
- Culture-aware date parsing (`01/02/2026` interpreted per locale) is out of
  scope — Change Type only accepts ISO-like date/datetime formats
  (`docs/APPLIED_STEPS.md` "Change Type").
