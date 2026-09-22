# Direct Query Validation (Sprint 14)

Through Sprint 13, the Validation Engine graded exactly one kind of thing: a
learner's `SemanticModel` (its relationships, calculated columns, measures,
health). A Power Query `QueryDefinition` could only be graded *indirectly*
— register its output on a model, then let the existing
`table-present`/`calculated-column-result`/`measure-result` rules grade it
like any other table. That's a real gap for a lesson whose learning
objective is the transformation itself (Filter Rows, Unpivot, a Custom
Column expression) rather than anything downstream of it.

Direct Query Validation closes that gap: six new `ValidationRule` types
that read a Power Query `QueryDefinition`'s own evaluated output —
`QueryEvaluation` — with no `SemanticModel` involved at all. This document
is the full reference; see [`docs/VALIDATION_ENGINE.md`](./VALIDATION_ENGINE.md)
"TestCell scope" for how a checkpoint opts into having no model, and
[`docs/POWER_QUERY_RUNTIME.md`](./POWER_QUERY_RUNTIME.md) /
[`docs/APPLIED_STEPS.md`](./APPLIED_STEPS.md) for the Power Query runtime
these rules read from.

## Why this is not a second Query Runtime

Every rule evaluator in `runtime/validation/queryValidation.ts` is a thin
adapter: resolve a `QuerySelector`, read the already-computed
`QueryEvaluation` for that query out of `ValidationSnapshot.queryEvaluations`,
and compare. Nothing here re-runs a query, re-implements a step evaluator,
or inspects `QueryDefinition.steps` beyond reading `step.kind` (see
"`query-step-semantics`" below). This mirrors the same discipline the
Sprint 5 model-side rules follow toward `evaluateMeasure`/
`evaluateCalculatedColumn`/`validateModel` (docs/VALIDATION_ENGINE.md "No
independent calculation oracle") — there is exactly one place a query is
ever evaluated (`runtime/query/queryEvaluator.ts`), and it isn't here.

## `ValidationSnapshot` (extended)

```ts
interface ValidationSnapshot {
  datasets: Record<string, Dataset>
  models: Record<string, SemanticModel>
  queries: Record<string, QueryDefinition>
  queryEvaluations: Record<string, QueryEvaluation>
}
```

`queries`/`queryEvaluations` are new in Sprint 14. Every field is still
required on the type — a model-only caller simply never triggers the
query-rule branches, and a workspace-only caller (no model at all) simply
never triggers the model-rule branches (`evaluateRule`'s `model ? ... :
modelConfigError(rule)` dispatch, `runtime/validation/validationEngine.ts`
— see docs/VALIDATION_ENGINE.md "TestCell scope"). Both snapshots are
already assembled elsewhere for other reasons (`NotebookRuntime`'s
`datasets`/`models`/`queries`/`queryEvaluations`), so no new snapshot-
building code was needed — `runValidation` and `useLessonWorkspace` simply
pass one more pair of fields through.

## `QuerySelector` / `QueryColumnSelector`

```ts
interface QuerySelector {
  queryName: string
}

interface QueryColumnSelector {
  query: QuerySelector
  columnName: string
}
```

`QuerySelector` is the query counterpart to `TableSelector`
(`docs/VALIDATION_ENGINE.md` "Author selectors vs. runtime ids") — an
authored exercise can never hardcode a `queryId`, since a fresh
`QueryDefinition` gets a fresh generated id every time a lesson's
`initialize()` runs. `resolveQuerySelector(queries, selector)`
(`runtime/validation/selectorResolver.ts`) mirrors `resolveTableSelector`
exactly: case-insensitive name match against `QueryDefinition.name`,
returning the same `SelectorResolution<T>` shape (`{ ok: true; value } |
{ ok: false; error }`) with the same `VALIDATION_TARGET_NOT_FOUND` /
`VALIDATION_TARGET_AMBIGUOUS` error codes every other selector resolver
uses — never a silent first-match.

`QueryColumnSelector` resolves further, against the query's *evaluated
output* rather than its definition: `resolveQueryColumnSelector` resolves
the query, then looks up `queryEvaluations[query.id]?.output`'s primary
table and searches its columns by name (case-insensitive). This is a
deliberate difference from every model-side column selector, which reads a
column off the immutable dataset schema — a query's output columns don't
exist until the pipeline has actually run and produced them.

## `classifyQuerySelectorFailure` — the deliberate divergence

```ts
export function classifyQuerySelectorFailure(error: SelectorResolutionError): 'failed' | 'error' {
  if (error.code === 'VALIDATION_TARGET_AMBIGUOUS') return 'error'
  return 'failed'
}
```

Compare this to the model-side `classifySelectorFailure`
(`docs/VALIDATION_ENGINE.md` "Selector resolution"):

| Selector | Missing → | Ambiguous → | Why |
|---|---|---|---|
| `TableSelector`/`MeasureSelector`/`CalculatedColumnSelector` | `'failed'` | `'error'` | The learner is expected to build these — a missing one is a normal, scoreable outcome. |
| `ColumnSelector` (a physical model column) | `'error'` | `'error'` | A model column is always dataset-defined, never learner-authored — missing means the exercise selector itself is wrong. |
| `QuerySelector` | `'failed'` | `'error'` | The learner is expected to build the query itself — same reasoning as table/measure. |
| `QueryColumnSelector` (a query's *output* column) | **`'failed'`**, not `'error'` | `'error'` | A query's output column is exactly the thing a Power Query exercise expects the learner to *produce* — via a Rename, a Custom Column, an Unpivot. It behaves like a missing table/measure, not like a missing model column. |

This is the one place `classifyQuerySelectorFailure` genuinely diverges
from the model-side rule ("a missing column is always a config error"): a
query-output column is learner-authored the way a table or measure is,
even though a *model* column never is. Ambiguity is still always `'error'`
in both — an ambiguous match is something the engine cannot resolve
deterministically regardless of which kind of thing is ambiguous
(AGENTS.md "Do not silently select the first match").

## The 6 rule types

All extend `BaseValidationRule` (`id`, `type`, `points`, `required?`,
`title`, `category?`) exactly like every other rule
(docs/VALIDATION_ENGINE.md "Rule contracts").

### `query-present`

```ts
interface QueryPresentValidationRule extends BaseValidationRule {
  type: 'query-present'
  query: QuerySelector
}
```

The query counterpart to `table-present`: passes when a query named
`query.queryName` exists. All-or-nothing (`rule.points` or `0`) — there's
nothing partial about "does this query exist."

### `query-health`

```ts
interface QueryHealthValidationRule extends BaseValidationRule {
  type: 'query-health'
  query: QuerySelector
}
```

Passes when the resolved query's current `QueryEvaluation.status ===
'success'`. On failure, feedback maps each error-severity `QueryDiagnostic`
on that evaluation to a learner-facing message — never the raw diagnostic
object dump (see "Evidence vs. feedback" below). If the query hasn't been
evaluated at all yet, a distinct `QUERY_NOT_EVALUATED` message is used
instead of implying something is actively broken.

### `query-output-schema`

```ts
interface QueryOutputColumnAssertion {
  name: string
  dataType?: DataType
  present?: boolean   // default true; false asserts the column must be ABSENT
}

interface QueryOutputSchemaValidationRule extends BaseValidationRule {
  type: 'query-output-schema'
  query: QuerySelector
  columns: QueryOutputColumnAssertion[]
}
```

Deliberately **not** a whole-schema equality check — only the listed
columns are asserted, each worth an equal share of `rule.points`
(`pointsEarned = points × passedCount / total`, `status` is `'passed'` /
`'partial'` / `'failed'` by the same three-way split every partial-credit
rule in this codebase uses). `present: false` is the interesting case: it
asserts a column must be **absent**, which is how a checkpoint verifies "the
raw `customer_id` was actually renamed away to `CustomerID`," not merely
"a `CustomerID` column now also exists" (a learner could otherwise pass by
adding a duplicate column and leaving the original in place). `dataType` is
optional per-column — a checkpoint that only cares a column exists, not
what type it ended up as, can omit it.

### `query-output-row-count`

```ts
type QueryRowCountAssertion =
  | { mode: 'equals'; value: number }
  | { mode: 'minimum'; value: number }
  | { mode: 'maximum'; value: number }
  | { mode: 'range'; min: number; max: number }

interface QueryOutputRowCountValidationRule extends BaseValidationRule {
  type: 'query-output-row-count'
  query: QuerySelector
  rowCount: QueryRowCountAssertion
}
```

Reads `QueryEvaluation.output`'s already-materialized `DataTable.rowCount`
— no independent row-counting logic, no re-scan. All-or-nothing pass/fail;
four modes cover "exactly N" (e.g. "duplicates were actually removed, down
to exactly 100"), "at least"/"at most" (a looser bound when the exact count
isn't pedagogically important), and a range.

### `query-output-value`

```ts
interface QueryRowSelector { columnName: string; equals: unknown }
interface QueryOutputValueCase {
  id: string
  title?: string
  row: QueryRowSelector
  expected: { columnName: string; value: ValidationScalar; tolerance?: NumericTolerance }
}
interface QueryOutputValueValidationRule extends BaseValidationRule {
  type: 'query-output-value'
  query: QuerySelector
  cases: QueryOutputValueCase[]
}
```

Mirrors `CalculatedColumnResultRule`'s `cases` pattern exactly
(docs/VALIDATION_ENGINE.md "Calculated-column result rule") and reuses the
same `compareScalar`/`NumericTolerance`/`DEFAULT_NUMERIC_TOLERANCE` — no
second tolerance/comparison implementation. Each case identifies a row by
an **exact-match equality on one column** (`row: { columnName, equals }`) —
never "row N," since a query's row order isn't part of any contract the
runtime guarantees, exactly the same reasoning that governs
`CalculatedColumnValidationCase.row`. A `row` selector or `expected` column
name that doesn't exist on the output is a configuration error (the whole
rule reports `status: 'error'`); a row that legitimately isn't found (the
learner hasn't produced it yet) is a normal per-case failure, contributing
to partial credit like any other case.

### `query-step-semantics`

```ts
type QueryStepSemanticAssertion =
  | { kind: 'uses-step'; stepKind: QueryStepKind }
  | { kind: 'does-not-use-step'; stepKind: QueryStepKind }
  | { kind: 'step-before'; earlier: QueryStepKind; later: QueryStepKind }
  | { kind: 'load-enabled' }

interface QueryStepSemanticsValidationRule extends BaseValidationRule {
  type: 'query-step-semantics'
  query: QuerySelector
  assertions: QueryStepSemanticAssertion[]
}
```

This is the rule that grades *how* a query was built, not just what it
produced — necessary because a lesson objective can specifically be "use
Unpivot Columns," not merely "produce a long-shaped table" (which a learner
could, in principle, achieve some other way). It compares **only
`step.kind`** — never a step's `id`, its display `name`, or the exact
`steps` array — so renaming an Applied Step from "Unpivoted Columns" to
"Make Months Long" can never fail a check, matching the same "cosmetic
renames never affect grading" principle the query fingerprint already
follows (docs/POWER_QUERY_RUNTIME.md "Query fingerprint / revision").
`step-before` checks relative order by `indexOf` on the step-kind array
(both kinds must be present, `earlier`'s index must be less than `later`'s)
— it does not require them to be adjacent. `load-enabled` reads
`QueryDefinition.loadEnabled` directly; it's grouped into this rule type
rather than getting its own, since "is this query ready to feed a model" is
naturally part of the same "what does this query's configuration say"
question the other three assertion kinds answer.

## Evidence vs. feedback

Every query rule follows the same split as the rest of the Validation
Engine (docs/VALIDATION_ENGINE.md "Feedback vs. evidence"): `feedback` is
learner-facing prose, `evidence` is internal/machine-readable and never
auto-surfaced. `query-health`'s failure path is the clearest example —
it maps each error-severity `QueryDiagnostic` to a `ValidationFeedback`
message (`{ severity: 'error', code: d.code, message: d.message }`) rather
than dumping the diagnostic's raw `details`/`stepId` payload into feedback;
that raw payload still travels in `evidence` for anything (a future
hint/solution system) that might read it later.

## Fingerprint / staleness

No new fingerprint mechanism was needed. `runtime/validation/fingerprint.ts`
gained `referencedQuerySelectors(spec)`, which walks a spec's rules for
every one carrying a `.query: QuerySelector` field, and folds each
resolved query's own `runtime/query/queryFingerprint.ts` fingerprint
directly into the payload `computeValidationFingerprint` hashes:

```text
payload = { scope, model: modelPayload | null, queries: queryFingerprintPayload, spec }
```

The query fingerprint is already exactly the right shape for this — it
already excludes step display name/UI-only state, and it already changes
on a filter threshold edit, a Custom Column expression edit, a Pivot
config edit, or an upstream dependency's own fingerprint changing
(docs/POWER_QUERY_RUNTIME.md "Query fingerprint / revision"). A
workspace-scoped checkpoint's `modelPayload` is simply `null` — there is no
model to fingerprint — so the composed payload degrades cleanly to "just
the queries" rather than needing a separate code path.

## Known limitations

- No assertion over a query's *row-level* diagnostics beyond
  success/failure (`query-health` only distinguishes `'success'` from
  everything else) — a checkpoint can't currently assert "exactly these 3
  rows failed type conversion."
- No cross-query join assertion beyond what `query-step-semantics`'s
  `uses-step('merge-queries')` can already express (i.e. "a merge
  happened," not "a merge happened on this specific key").
- No exercise-authoring UI for these rules either — like every
  `ValidationSpec`, a Direct Query Validation spec is a TypeScript literal
  today (`src/data/exercises/*.ts`). See ROADMAP.md Phase 10.
