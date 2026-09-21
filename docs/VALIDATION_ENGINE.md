# Validation Engine (Sprint 5)

This document describes the Sprint 5 validation engine: a pure, framework-free
layer that grades a learner's real model/columns/measures against an authored
`ValidationSpec`, using the exact same runtimes built in Sprints 1–4. It never
compares expression source text, and it never reimplements BI semantics.

## Philosophy

> Validation should test semantics, not exact text. (`PRODUCT.md`)

```text
Learner definition (model / calculated column / measure)
  ↓
Existing BI runtime (Sprint 2–4: modelRuntime, calculatedColumnRuntime, measureRuntime)
  ↓
Actual execution (real relationships, real filter propagation, real aggregation)
  ↓
Multiple validation fixtures (structural + numeric, across contexts)
  ↓
Expected semantic outcomes
  ↓
Partial score + specific feedback
```

`SUM(Sales[Revenue])` and any other supported expression that produces the
same correct result under the same fixtures both pass. Source-string
comparison never appears anywhere in this layer (see "No independent
calculation oracle" below).

## Author selectors vs. runtime ids

Runtime entities (`Dataset`, `ModelTable`, `Relationship`, `CalculatedColumn`,
`Measure`) correctly use generated ids — but the built-in Retail dataset (and
any CSV/XLSX import) generates a *fresh* id every time it's imported. An
authored `ValidationSpec` can never hardcode a `datasetId`/`tableId`/
`columnId` and expect it to still resolve tomorrow.

Sprint 5 introduces a separate, human-authored selector layer
(`src/domain/validation.ts`):

```ts
interface TableSelector { tableName: string; sourceKey?: string }
interface ColumnSelector { table: TableSelector; columnName: string }
interface MeasureSelector { name: string }
interface CalculatedColumnSelector { table: TableSelector; name: string }
```

`sourceKey` disambiguates when more than one table shares a name (matched
against the dataset's own source identity: a sample dataset's `source.key`,
an xlsx dataset's `source.sheetName`, or a csv dataset's `source.fileName`).
The Retail Foundations spec always sets it (`{ tableName: 'Sales', sourceKey:
'sales' }`) since the built-in generator's `source.key` values are stable and
known ahead of time.

## Selector resolution (`src/runtime/validation/selectorResolver.ts`)

```text
Author selector
  ↓
resolveTableSelector / resolveColumnSelector / resolveMeasureSelector / resolveCalculatedColumnSelector
  ↓
current runtime entity (ModelTable / ResolvedColumn / Measure / CalculatedColumn)
```

Each resolver returns `{ ok: true; value } | { ok: false; error }` — never a
thrown exception, and never a best-effort first match. `error` carries a
structured `SelectorResolutionError`:

```ts
interface SelectorResolutionError {
  code: 'VALIDATION_TARGET_NOT_FOUND' | 'VALIDATION_TARGET_AMBIGUOUS'
  targetKind: 'table' | 'column' | 'measure' | 'calculated-column'
  message: string
  details?: Record<string, unknown>
}
```

`classifySelectorFailure(error)` decides how a caller should treat a failed
resolution:

- `VALIDATION_TARGET_NOT_FOUND` on a **table**, **measure**, or **calculated
  column** → `'failed'` — these are things the learner is expected to build;
  not having built one yet is a normal, scoreable rule failure.
- `VALIDATION_TARGET_NOT_FOUND` on a **column**, or any `VALIDATION_TARGET_AMBIGUOUS`
  → `'error'` — a physical column always comes from the dataset's own schema
  (never learner-authored), so a missing one means the exercise selector
  itself is wrong; and an ambiguous match is, by definition, something the
  engine cannot resolve deterministically (AGENTS.md: "Do not silently select
  the first match"). See "Validation errors are not learner failures" below.

## Rule contracts (`src/domain/validation.ts`)

Every rule extends:

```ts
interface BaseValidationRule {
  id: string
  type: ValidationRuleType
  points: number
  required?: boolean
  title: string
  category?: string   // display-only grouping ("Model", "Measures", ...) — never read by scoring
}
```

Six rule types:

| type | checks | reuses |
|---|---|---|
| `relationship` | a specific 1→* relationship exists, right direction, expected active state | `SemanticModel.relationships` directly |
| `model-health` | no error-severity model diagnostics / valid star schema / specific forbidden diagnostics | `runtime/model/graphAnalysis.ts#validateModel` |
| `table-present` | a table has been added to the model | `resolveTableSelector` |
| `calculated-column-result` | row-level output at specific, explicitly-identified rows | `runtime/calculatedColumn/calculatedColumnRuntime.ts#evaluateCalculatedColumn` |
| `measure-result` | scalar output across one or more `FilterContext` fixtures | `runtime/measure/measureRuntime.ts#evaluateMeasure` |
| `expression-semantics` | AST-level structural assertions (supplementary) | `expression/parser.ts#parseExpression` |

None of these reimplement BI logic — every rule's evaluator (in
`src/runtime/validation/*.ts`) is a thin adapter that resolves selectors,
calls the existing Sprint 1–4 runtime, and compares the result.

## Relationship rule

```ts
interface RelationshipValidationRule extends BaseValidationRule {
  type: 'relationship'
  one: ColumnSelector
  many: ColumnSelector
  active?: boolean   // default true
}
```

`structuralValidation.ts#evaluateRelationshipRule` resolves both column
selectors, then searches `model.relationships` for an exact match. If none
matches in the requested direction, it checks the *reversed* direction to
give a specific "wrong direction" message instead of a generic "missing"
one. If found but `active` doesn't match the expected state, a distinct
`RELATIONSHIP_WRONG_ACTIVE_STATE` message is returned. No relationship logic
is reimplemented — this rule only ever reads `SemanticModel.relationships`.

## Model-health rule

```ts
interface ModelHealthValidationRule extends BaseValidationRule {
  type: 'model-health'
  requireValidGraph?: boolean   // default true — no error-severity diagnostic
  requireStarSchema?: boolean
  forbidDiagnostics?: ModelDiagnosticCode[]
}
```

Calls `validateModel(model, datasets)` (Sprint 2, unchanged) and inspects its
diagnostics. Disabling one relationship in an otherwise-valid star schema
does **not** fail this rule if the model still forms a smaller valid star
schema with the remaining tables — an isolated table is a `warning`, not an
`error`, and topology re-evaluates fresh every time (see
`tests/runtime/validation/retailFoundationsE2E.test.ts` "disabling the
Products relationship").

## Calculated-column result rule

```ts
interface RowSelector { column: ColumnSelector; equals: unknown }
interface CalculatedColumnValidationCase { id: string; title?: string; row: RowSelector; expected: ValidationScalar; tolerance?: NumericTolerance }
interface CalculatedColumnResultRule extends BaseValidationRule {
  type: 'calculated-column-result'
  column: CalculatedColumnSelector
  cases: CalculatedColumnValidationCase[]
}
```

A case identifies its row by an explicit equality match (e.g. `Sales[OrderID]
= 375`) — never "row N" — because row order isn't part of any contract the
runtime guarantees. `calculatedColumnValidation.ts` resolves the column,
calls `evaluateCalculatedColumn`, finds the matching row index by scanning
the underlying table, and compares `execution.values[rowIndex]`. Testing
multiple, spread-out `OrderID`s (the Retail Foundations spec uses 1, 375,
750, 1125, 1500) prevents a row-specific hardcoded answer from passing.

## Measure result rule — multi-context by design

```ts
interface ValidationFilter { column: ColumnSelector; operator?: 'equals' | 'in'; values: unknown[] }
interface MeasureValidationCase { id: string; title: string; filters: ValidationFilter[]; expected: ValidationScalar; tolerance?: NumericTolerance; weight?: number }
interface MeasureResultValidationRule extends BaseValidationRule {
  type: 'measure-result'
  measure: MeasureSelector
  cases: MeasureValidationCase[]
}
```

`measureValidation.ts#evaluateMeasureResultRule` resolves the measure once,
then for each case: resolves `ValidationFilter[]` into real Sprint 4
`ColumnFilter[]`, calls `evaluateMeasure(model, datasets, measureId, {
filters })`, and compares the scalar result. **A measure important enough to
grade must be tested under more than the unfiltered case** — testing only
`filters: []` would let `Total Revenue = <the correct grand total, typed as a
literal>` pass. See "Hardcoded-measure regression" below for the mandatory
proof this actually works.

Partial credit is weighted (`weight` defaults to `1`, so cases are equal
unless the exercise says otherwise):

```text
pointsEarned = points × (Σ weight of passed cases) / (Σ weight of all cases)
```

### Context-aware feedback

If **every** case fails, the rule adds a generic hint ("check the aggregation
and the field it reads"). If the case with the fewest filters (the closest
thing to "unfiltered") passes while every more-filtered case fails, it adds a
specific `HINT_FILTER_CONTEXT` hint pointing at relationship propagation
instead. This heuristic only inspects case shapes/outcomes generically — it
is not specific to Retail Foundations or to "Total Revenue" by name.

### FILTER_GRAPH_INVALID fails closed, not silently wrong

If a case's filters land on a model whose active relationship graph is
already invalid (`ACTIVE_CYCLE`/`AMBIGUOUS_PATH`), `evaluateMeasure` returns
`FILTER_GRAPH_INVALID` (Sprint 4, unchanged) and the rule reports that case
as blocked with a structural explanation, never as "wrong value" (AGENTS.md
§42 "Fail closed on invalid model execution").

## Expression-semantics rule (supplementary)

```ts
type ExpressionSemanticAssertion =
  | { kind: 'uses-function'; functionName: string }
  | { kind: 'references-measure'; measureName: string }
  | { kind: 'references-column'; column: ColumnSelector }
  | { kind: 'not-constant-only' }

interface ExpressionSemanticValidationRule extends BaseValidationRule {
  type: 'expression-semantics'
  target: { kind: 'measure'; measure: MeasureSelector } | { kind: 'calculated-column'; column: CalculatedColumnSelector }
  assertions: ExpressionSemanticAssertion[]
}
```

`semanticValidation.ts` parses the target's persisted expression with the
real `parseExpression()` and walks the returned AST — it never does
`expression.includes('SUM(')`. Retail Foundations doesn't use this rule type
(execution-outcome rules already prove correctness); it exists for exercises
whose learning objective specifically names a technique (e.g. "use DIVIDE"),
per the preferred order:

```text
1. execution outcome        (measure-result / calculated-column-result)
2. behavior across contexts (multi-case measure-result)
3. structural semantics     (expression-semantics)
4. source-string comparison — never
```

## Numeric tolerance & scalar comparison (`scalarComparison.ts`)

```ts
type NumericTolerance =
  | { type: 'absolute'; value: number }
  | { type: 'relative'; value: number }
  | { type: 'absolute-or-relative'; absolute: number; relative: number }
```

Default (`DEFAULT_NUMERIC_TOLERANCE` in `domain/validation.ts`):
**absolute 0.01, relative 0.000001**, combined with OR — passes if either
bound is satisfied. This tolerates both small totals (where a fixed epsilon
matters) and large totals (where a fixed epsilon would be too strict).
Numbers are **never** compared with `===`. Strings and booleans compare
exactly; `null` means "expect blank" and matches both `null` and `undefined`
(mirroring the runtime's own blank semantics).

## Scoring (`scoring.ts`)

```text
percentage = 100 × (Σ pointsEarned) / (Σ pointsPossible)
passed = percentage >= passingPercentage AND every `required` rule status === 'passed'
```

A `required` rule that only reached `'partial'` still blocks an overall PASS
— only `'passed'` counts. Required is meant to gate structural integrity
(Retail Foundations marks only the `model-health` rule required); AGENTS.md
warns against marking every rule required.

`computeNotebookScore(runs)` sums `pointsEarned`/`pointsPossible` across
whichever `ValidationRun`s the caller considers current — used for the
notebook-wide score in the header (see "Persistence boundaries" below for
what "current" means).

## Feedback vs. evidence

```ts
interface ValidationFeedback { severity: 'success' | 'info' | 'warning' | 'error'; code: string; message: string; hint?: string }
interface ValidationRuleResult {
  ruleId: string; title: string; category?: string
  status: 'passed' | 'partial' | 'failed' | 'error'
  pointsEarned: number; pointsPossible: number; required: boolean
  feedback: ValidationFeedback[]
  evidence?: Record<string, unknown>   // resolved ids, per-case actual/expected/delta, raw diagnostics
}
```

`feedback` is learner-facing prose (`TestCellCard` renders it directly).
`evidence` is internal/machine-readable — resolved relationship ids, per-case
pass/fail detail, raw model diagnostics — and the UI never surfaces it
automatically. This separation exists so a future hint/solution-reveal system
(Phase 8) has somewhere to read from without the current UI leaking answers.

## Validation errors are not learner failures

`status: 'error'` (distinct from `'failed'`) means the *rule itself* could
not be graded — a `VALIDATION_TARGET_AMBIGUOUS`/column-`NOT_FOUND` selector
failure, an unparseable target expression. An error-status rule earns 0
points but is reported as `VALIDATION_CONFIG_ERROR`, never blended into
"the learner got it wrong" messaging. See `classifySelectorFailure` above for
exactly which failures become `'error'` vs. a normal `'failed'`.

## Staleness / fingerprint (`fingerprint.ts`)

```ts
computeValidationFingerprint(model, datasets, spec): string   // FNV-1a hash
isValidationRunStale(run, model, datasets, spec): boolean
```

The fingerprint is computed over exactly the semantic inputs a run depends
on: each `ModelTable`'s resolved name + column names/types, every
`Relationship` (endpoints, cardinality, active state), every
`CalculatedColumn`/`Measure` definition (table, name, expression), and the
`ValidationSpec` itself (so editing the exercise also invalidates old runs).
It deliberately **excludes** `ModelTable.position` — dragging a table on the
canvas must never invalidate a previous result.

A `ValidationRun` is never persisted (see below); the fingerprint lives only
in transient UI state (`App.tsx`'s `validationRuns` map) so the UI can tell a
current result from a stale one and either hide it or show "Result
outdated — run validation again."

## Persistence boundaries

```text
Persisted (inside TestCell, via the existing notebook document store):
  modelId
  ValidationSpec (rules, selectors, expected values, tolerances)

Never persisted:
  ValidationRun (score, per-rule results, feedback, evidence)
  fingerprint
```

After a reload, a `TestCell` and its spec survive exactly as authored; the
score always starts at "not run yet" — a stale PASS is never presented as
current truth (Sprint 5 brief §37/§38, verified manually — see
"Manual verification" in `ARCHITECTURE.md`/final report).

## No independent calculation oracle

The validator executes learner work exclusively through the existing Sprint
1–4 runtimes:

```text
runtime/calculatedColumn/calculatedColumnRuntime.ts#evaluateCalculatedColumn
runtime/measure/measureRuntime.ts#evaluateMeasure
runtime/model/graphAnalysis.ts#validateModel
expression/parser.ts#parseExpression
```

`src/runtime/validation/*.ts` never contains a `validationSum()`,
`validationFilterPropagation()`, or `validationRelated()` — that would be a
second BI engine, and the two engines could silently drift apart.

## Hardcoded-measure regression (mandatory proof)

A learner measure defined as a literal grand total —

```DAX
Total Revenue = 2557236.8999999985
```

— passes an unfiltered case (`filters: []`) but fails every filtered case,
because the literal never changes under a `FilterContext`. This is the
central, deliberate design proof that validation is outcome/semantic-driven
rather than a superficial total check (AGENTS.md §14/§34). It is covered by:

- `tests/runtime/validation/measureValidation.test.ts` — a unit-level proof
  isolated to `evaluateMeasureResultRule`.
- `tests/runtime/validation/retailFoundationsE2E.test.ts` — the same proof
  against the real, full Retail Foundations spec (`measure-total-revenue`
  still passes at 10/10; `context-total-revenue` drops to 0/10; overall score
  never reaches 100%).
- Manually reproduced in the running app (see final report).

## Retail Foundations checkpoint (`src/data/exercises/retailFoundationsValidation.ts`)

The first real scored checkpoint. 100 points across four categories:

```text
Model               40   (3 relationships × 10, model-health × 10, required)
Calculated column   10   (Margin, 5 spread-out OrderID cases × 2)
Measures            40   (Total Revenue/Orders/AOV/Gross Margin, unfiltered × 10 each)
Filter behavior     10   (Total Revenue under 4 filtered contexts × 2.5)
```

`passingPercentage: 70`. Splitting "Total Revenue is correct" (Measures) from
"Total Revenue responds to filters" (Filter behavior) is what makes the
hardcoded-measure case visible as a distinct, localized rule failure instead
of a single pass/fail blob.

### Expected values are frozen fixtures, not re-derived from the learner

Every `expected` value in the spec is computed **once**, at module load, by
directly reducing `generateRetailDataset()`'s raw output with plain
`Array.reduce`/`Set` — e.g. `salesRows.reduce((sum, r) => sum + r.Revenue,
0)`. This never touches `SemanticModel`, `evaluateMeasure`, or
`evaluateCalculatedColumn`, so it cannot be circular with what's being
validated. Because the generator is seeded (`SEED = 42`), this is fully
deterministic — the same numbers every run, on every machine — while still
being self-consistent with the sample data if that generator is ever
retuned, instead of hand-transcribed magic numbers that could drift or be
mistyped.

## Performance

Within a single `runValidation()` call, selector resolution is cheap
(`Array.find` over small model/table lists), and each rule's underlying
runtime call (`evaluateMeasure`, `evaluateCalculatedColumn`) is already the
existing, already-tested Sprint 3/4 code path — no new caching layer was
needed at Retail scale (4 tables, 1,500 fact rows): the entire 10-rule
Retail Foundations checkpoint evaluates in low single-digit milliseconds in
the test suite. No validation-specific cache was added; if a much larger
model/spec combination ever became slow, the first thing to cache would be
`resolveFilterContext`'s internal `validateModel` call, which is unchanged
Sprint 4 code, not something Sprint 5 should special-case around.

## Sprint 10 addendum

A new `date-table` rule type (`DateTableValidationRule`) grades whether a
table is marked as a Date Table using a specific date column, re-running
the live `validateDateTableDefinition` check rather than trusting a cached
result — see [`docs/DATE_TABLES.md`](./DATE_TABLES.md) "Validation Engine
integration". Grading a time-intelligence measure's *numeric* output (e.g.
`Revenue LY`, `Revenue YTD`) needs no new rule type at all —
`MeasureResultValidationRule`'s existing per-case `filters` are already
sufficient. `ValidationRule`/`ValidationSpec` still need no hydration path
— they never had one.

## Sprint 11 addendum

A new `relationship-config` rule type (`RelationshipConfigValidationRule`,
`domain/validation.ts`) asserts a relationship's *full* configuration —
`left`/`right` selectors, `cardinality`, `oneSide`, `crossFilterDirection`
and `active` state, matched in either author-selector order — something the
original `relationship` rule can't express, since it's hardcoded to a 1:*
single-direction expectation. `evaluateRelationshipConfigRule`
(`runtime/validation/structuralValidation.ts`) is the evaluator, following
the same "resolve selectors, compare against `SemanticModel.relationships`,
never reimplement relationship logic" pattern every other structural rule
uses.

The original `relationship` rule type is still fully supported, unchanged
in behavior: `evaluateRelationshipRule` now goes through the
`relationshipOneEndpoint`/`relationshipManyEndpoint` helpers
(`runtime/model/relationshipHelpers.ts`, only ever defined for
`one-to-many`) instead of reading `.one`/`.many` directly, but it's still
exactly the same "does this specific 1 → * relationship exist, in the right
direction, with the expected active state" check it always was — an
existing exercise spec written against the `relationship` rule type needs
no changes.

The staleness fingerprint (`runtime/validation/fingerprint.ts`) now hashes
`{ left, right, cardinality, oneSide, crossFilterDirection, active }` per
relationship, replacing the old `{ one, many, active, cardinality }` shape
— `crossFilterDirection` now participates in staleness detection, where it
was previously silently omitted entirely (it was always the single literal
`'single'` before Sprint 11, so omitting it couldn't have mattered; it can
now).

## Known limitations

- Only physical (dataset-schema) columns can appear in a `ColumnSelector` —
  filtering or asserting on a *calculated* column's value isn't wired into
  `ValidationFilter` (measures already can aggregate calculated columns via
  `LogicalColumnRef`; filtering by one is a natural but unimplemented
  extension).
- No exercise-authoring UI — a `ValidationSpec` is a TypeScript literal today
  (`src/data/exercises/*.ts`). See ROADMAP.md Phase 9.
- `expression-semantics` assertions are limited to the four listed kinds;
  richer AST queries (e.g. "does not use RELATED") would extend
  `ExpressionSemanticAssertion` the same way.
- No historical progress or attempt tracking — `ValidationRun` is always the
  current-state score only (ROADMAP.md Phase 8).
