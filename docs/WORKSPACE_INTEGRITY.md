# Workspace Referential Integrity (Sprint 15)

A notebook workspace is full of cross-references: a `MeasureCell` points at
a `Measure` inside a `SemanticModel`; a `ModelTable` points at a `Dataset`;
a `VisualCell` points at one or more measures; a `Query` can source from
another `Query`'s output. Before Sprint 15, deleting the thing on the other
end of one of those references — a dataset, a model, a query, a measure, a
calculated column — either wasn't blocked at all, or was blocked
inconsistently depending on which UI button the learner happened to click.
This document describes the layer that closes that gap: a single,
canonical structural-integrity check (`runtime/integrity/
workspaceIntegrity.ts`) and a pre-mutation impact analysis
(`runtime/integrity/mutationImpact.ts`) that every destructive
`NotebookRuntime` mutation method now calls internally before it mutates
anything.

## Structural vs semantic invalidity

Sprint 15 deliberately guarantees one class of correctness and explicitly
does **not** attempt the other. Keeping the distinction clear is the whole
point of this document.

**Structural invalidity** — an id a cell, model object, or query claims to
reference no longer exists. For example, a `MeasureCell.measureId` that
points at a measure that was deleted out from under it, leaving the cell
rendering a "missing measure" placeholder forever. **Sprint 15 guarantees
this can never happen** after any successful `NotebookRuntime` mutation —
either the mutation is blocked, or every reference to the thing being
removed is cleaned up as part of the same mutation.

**Semantic invalidity** — an expression references a since-renamed or
since-removed thing *by name*, inside its own text. For example, a measure
`Revenue Check = [Old Measure Name] * 2` after "Old Measure Name" was
renamed to something else: the id-based reference (there isn't one — DAX
expressions are text) is untouched, but the name inside the expression text
no longer resolves. **This remains possible after Sprint 15.** It isn't a
gap this layer is trying to close — it surfaces through the existing
expression diagnostics (`UNKNOWN_MEASURE`, `UNKNOWN_COLUMN`, and friends;
see [`EXPRESSION_ENGINE.md`](./EXPRESSION_ENGINE.md) "Diagnostics"), exactly
the way a typo in a brand-new expression already does. The integrity layer
only guarantees the *first* class of invalidity is impossible; the second
was already handled by the expression engine and stays there.

## The invariant

> Every id a notebook cell, `SemanticModel` object, or `QueryDefinition`
> claims to reference must resolve against the workspace's own registries.

Concretely, `workspaceReferences.ts` enumerates every such reference and
checks it against the snapshot's actual `datasets`/`models`/`queries` maps:

- a `DataCell`/`QueryCell`/`ModelCell`/`CalculatedColumnCell`/`MeasureCell`/
  `VisualCell`/`TestCell`'s own `datasetId`/`modelId`/`queryId`/
  `calculatedColumnId`/`measureId`/`scope.modelId` resolves to something
  that actually exists (`cellReferenceIssues`);
- every `ModelTable.datasetId`, every `Relationship`'s endpoints, every
  `CalculatedColumn`/`Measure`'s `modelTableId`/`homeModelTableId`, and every
  `DateTableDefinition.modelTableId` inside a `SemanticModel` resolves
  (`modelReferenceIssues`);
- every `QueryDefinition`'s source (another query, or a dataset table) and
  every Merge/Append step's referenced query resolves
  (`queryReferenceIssues`).

`validateWorkspaceIntegrity(snapshot)` runs all three enumerators and
returns the aggregate report:

```ts
interface WorkspaceRef { kind: WorkspaceRefKind; id: string }

interface WorkspaceIntegrityIssue {
  source: WorkspaceRef
  target: WorkspaceRef
  referenceType: string
  reason: string
  severity: 'error' | 'warning'
}

interface WorkspaceIntegrityReport {
  valid: boolean
  issues: WorkspaceIntegrityIssue[]
}

function validateWorkspaceIntegrity(snapshot: NotebookRuntimeSnapshot): WorkspaceIntegrityReport
```

This mirrors the `{ severity, code, message, details? }` diagnostic shape
`RelationshipDiagnostic`/`QueryDiagnostic`/`ExpressionDiagnostic` already
use elsewhere in this codebase, for stylistic consistency — it is not a
fourth, unrelated diagnostic taxonomy.

## RESTRICT vs. CASCADE

A destructive mutation follows one of two policies, chosen per mutation
kind based on what actually makes sense for a learner:

| Mutation | Policy | Why |
|---|---|---|
| Delete Model | **CASCADE** | A `ModelCell` and everything scoped to that one model (its `CalculatedColumnCell`s, `MeasureCell`s, `VisualCell`s, and any model-scoped `TestCell`s) form one conceptual unit — asking a learner to manually delete six dependent cells before they're allowed to delete the model they all belong to would be needless friction, not a safety win. |
| Delete Query | **RESTRICT** | Blocked if another query depends on this one's output, or if this query's output is registered on a model. A query silently disappearing out from under a dependent query or a live model table would corrupt state a CASCADE can't safely unwind (a model table isn't "part of" the query the way a `MeasureCell` is "part of" a model). Tightened this sprint from Sprint 8-14's soft, informational-only warning to a hard block. |
| Disable Query Load | **RESTRICT** | Blocked if the currently-loaded output is registered on a model — disabling load would silently orphan the `ModelTable` reading it. |
| Delete Dataset | **RESTRICT** | Blocked if a `Query` sources from it directly, or a model table references it directly. A raw dataset is an input others build on; removing it out from under a live Query or Model would corrupt, not simplify, the workspace. |
| Remove Model Table | **CASCADE** (within its own subtree) | The table's own calculated columns, relationships, and date-table marking already cascaded away before Sprint 15; Sprint 15 closes the one gap — any measure *homed* on the table (`homeModelTableId`) cascades away too, along with their `MeasureCell`s and any `VisualCell` that referenced those measures. A table disappearing necessarily takes everything defined *on* it with it — there's no sensible "restrict" here, the table itself is what's being removed. |
| Delete Measure | **RESTRICT** | Blocked if another measure depends on it (via the existing measure-dependency graph, inverted) or a `VisualCell` references it. Unlike a model table, a single measure being deleted doesn't obviously "belong" to its dependents — silently cascading a deletion through an unbounded chain of dependent measures is far more surprising than asking the learner to remove the dependency first. |
| Delete Calculated Column | **RESTRICT** | Blocked if a measure or another calculated column references it by name (via `expressionDependents.ts` — see "Semantic dependency limitations" below). Same reasoning as Delete Measure. |
| Remove Relationship | unchanged | Nothing else in the workspace references a `Relationship` by id, so there's genuinely nothing to restrict or cascade — Sprint 15 didn't need to touch this path. |

## `analyzeMutationImpact` — API shapes

`mutationImpact.ts` exports one pure, read-only function per mutation kind.
None of them mutate the snapshot they're given — they only describe what
*would* happen:

```ts
interface CascadeImpact {
  policy: 'cascade'
  allowed: true
  cascadeCellIds: string[]
}

interface RestrictImpact {
  policy: 'restrict'
  allowed: boolean
  blockers: WorkspaceIntegrityIssue[]
}

function analyzeDeleteModel(snapshot, modelId): CascadeImpact
function analyzeDeleteDataset(snapshot, datasetId): RestrictImpact
function analyzeDeleteQuery(snapshot, queryId): RestrictImpact
function analyzeDisableQueryLoad(snapshot, queryId): RestrictImpact
function analyzeRemoveModelTable(snapshot, modelId, modelTableId): RemoveModelTableImpact  // cascade, richer shape (see below)
function analyzeDeleteMeasure(snapshot, modelId, measureId): RestrictImpact
function analyzeDeleteCalculatedColumn(snapshot, modelId, calculatedColumnId): RestrictImpact
```

`analyzeRemoveModelTable` returns a slightly richer cascade shape, since a
table removal cascades through two different kinds of model object:

```ts
interface RemoveModelTableImpact {
  policy: 'cascade'
  allowed: true
  cascadeCalculatedColumnIds: string[]
  cascadeMeasureIds: string[]
  cascadeCellIds: string[]
}
```

`NotebookRuntime.deleteQuery` calls `analyzeDeleteQuery` too, exactly like
every other mutation method below — its own pre-Sprint-15 `DeleteQueryResult`
shape (`{deleted, blockedByQueries, referencedByModels}`, two plain id
arrays rather than a generic `blockers` list) predates this module, so the
method derives those two arrays from `analyzeDeleteQuery`'s `blockers` by
filtering on `referenceType` (`QUERY_IN_USE_BY_QUERY` /
`QUERY_IN_USE_BY_MODEL`) rather than changing its public result shape.

## Enforcement point

**Enforcement always happens inside `NotebookRuntime`, never only in the
UI.** Every one of `NotebookRuntime`'s destructive mutation methods calls
the matching `analyze*` function itself, before mutating, and refuses (or
cascades) accordingly:

```ts
removeDataset(id): { removed: boolean; blockers?: WorkspaceIntegrityIssue[] }
removeModel(id): { removed: boolean; cascadedCellIds: string[] }
removeTableFromModel(modelId, tableId): { removed: boolean; cascadedCalculatedColumnIds: string[]; cascadedMeasureIds: string[]; cascadedCellIds: string[] }
removeMeasureCell(id): { removed: boolean; blockers?: WorkspaceIntegrityIssue[] }
removeCalculatedColumnCell(id): { removed: boolean; blockers?: WorkspaceIntegrityIssue[] }
setQueryLoadEnabled(id, enabled): { updated: boolean; blockers?: WorkspaceIntegrityIssue[] }
deleteQuery(id): DeleteQueryResult  // { deleted, blockedByQueries, referencedByModels } — referencedByModels.length > 0 now also sets deleted: false
```

Every one of these used to return `void` (or, for `deleteQuery`, a result
whose `referencedByModels` was informational only and didn't stop the
deletion). They now return a result object the caller — `useNotebookRuntime`
— inspects before persisting: **a mutation is only saved to (or removed
from) IndexedDB when it actually succeeded**, so a blocked deletion can
never leave a half-applied change on disk.

The `analyze*` functions are also exported publicly, so the UI *could* call
one ahead of time to show a preview or confirmation dialog before the
learner commits to an action. But that's an optional convenience, never the
safety mechanism itself — even if every UI call site skipped the preview
entirely, `NotebookRuntime` would still refuse (or correctly cascade) the
mutation on its own. This is the same "the UI is never trusted to have
checked first" principle the rest of this codebase already follows for BI
semantics (see `ARCHITECTURE.md` "Architectural rule").

In the running app, this shows up as a `role="alert"` warning with the
specific blocker reason on `DataCellCard`/`CalculatedColumnCellCard`/
`MeasureCellCard`/`QueryCellCard` — e.g. "Can't delete: 1 model still use
this query's output." or "Can't disable load: this query's output is used
by a model." Cascade mutations (deleting a model, removing a model table)
need no blocking UI at all, since they always succeed by design — verified
live: deleting a model cleanly removes the `ModelCell` plus six
`MeasureCell`s and one `VisualCell` it owned, with zero orphaned "missing"
cards and zero console errors.

## Semantic dependency limitations (`expressionDependents.ts`)

Deciding whether a measure or calculated column should block a deletion
requires knowing what an *expression's text* depends on — a different
problem from the id-based checks above, since DAX expressions reference
other things by name, not by id. `expressionDependents.ts` answers this with
`findColumnReferencesInExpression(expression)`, which parses the expression
with the real `parseExpression()` (never the binder, which needs full model
context and throws on unrelated errors; never a regex) and walks the
resulting AST for `ColumnReferenceNode`s.

`findCalculatedColumnDependents(model, excludeId, columnName)` uses that to
find every measure/other calculated column whose expression mentions
`columnName` — matched **case-insensitively, on the column name only, not
which table it belongs to**. This is a deliberate, documented conservative
over-approximation: it can flag a dependency that doesn't really exist (a
different table happens to have a same-named column), but it will never
*miss* a real one. In a learning sandbox, blocking a deletion too eagerly
(the learner sees a specific "X still references this" message and can
investigate) is a far safer failure mode than silently deleting something
an expression still depends on and only finding out when a downstream
measure quietly starts erroring. This is a stated, bounded limitation, not
an oversight — a future pass could narrow it to resolve which table a
mention actually points at, using the same binder the expression already
goes through when it's created.

## Test helper

`tests/support/expectWorkspaceIntegrity.ts` exports one convention used
after every destructive-mutation test across the suite, not just the
dedicated integrity tests:

```ts
expectWorkspaceIntegrity(snapshot).toBeValid()
```

It calls `validateWorkspaceIntegrity` and throws a readable, per-issue
message (`source -> target (referenceType) reason`) if the snapshot isn't
valid — turning "did this mutation leave the workspace structurally sound"
into a one-line assertion any test can reuse, rather than each test
re-deriving its own ad hoc reference checks.
