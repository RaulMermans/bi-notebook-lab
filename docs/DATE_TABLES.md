# Date Tables (Sprint 10)

Classic Power BI Desktop practice starts with a workflow, not a function:

```text
Create Calendar table
↓
Validate Calendar
↓
Mark as Date Table
↓
Relate Calendar[Date] → Sales[Date]
↓
Create time-intelligence Measures
```

This document covers the "mark as Date Table" step and everything under
it — the domain contract, hydration, validation runtime, and UI. See
[`docs/TIME_INTELLIGENCE.md`](./TIME_INTELLIGENCE.md) for the DAX functions
that *require* a marked Date Table.

## Why an explicit marking, not inference

Power BI never infers a Date Table from a column's data type — a table with
a `date`-typed column is not automatically eligible for
`SAMEPERIODLASTYEAR`/`DATEADD`/etc. The learner must explicitly mark a table
and choose its canonical date column, and the engine must reject any
time-intelligence function that targets an unmarked column. This mirrors
Power BI Desktop's own "Mark as date table" dialog and is deliberately not
automatic — see `docs/TIME_INTELLIGENCE.md` "Marked Date Table requirement"
for the runtime enforcement.

## Domain contract (`domain/model.ts`)

```ts
export interface DateTableDefinition {
  modelTableId: string
  dateColumn: ColumnRef
}

export interface SemanticModel {
  // ...
  dateTables: DateTableDefinition[]
}
```

`dateTables` is plural because a Power BI model can contain more than one
marked date table (role-playing date dimensions — Order Date, Ship Date,
...). Sprint 10 doesn't build role-playing dimensions, but the contract
never hardcodes "the" Calendar table: every time-intelligence function
resolves its Date Table by matching the exact `ColumnRef` the learner
passed against `model.dateTables`, not by name or position.

A `DateTableDefinition` is intentionally minimal — no cached validity flag,
no cached row-index. Validity is always recomputed live from the current
model/dataset state (`validateDateTableDefinition`), so a Date Table
marking can never silently go stale and keep reporting "✓ Valid" after the
underlying data changed shape.

## Persistence

Models persisted before Sprint 10 have no `dateTables` field on disk at all
— the exact situation Sprint 4's `measures` field was in. Every load path
goes through `hydrateSemanticModel()` (`runtime/model/modelRuntime.ts`):

```ts
export function hydrateSemanticModel(model: SemanticModel): SemanticModel {
  return { ...model, measures: model.measures ?? [], dateTables: model.dateTables ?? [] }
}
```

`persistence/modelStore.ts`'s `loadModel`/`loadModels` always call this
before handing a model to runtime code — no persisted Sprint 1-9 notebook
can crash from a missing `dateTables` array. `tests/persistence/modelStore.test.ts`
covers the legacy round-trip explicitly.

## Table removal cleanup

If a marked Date Table is removed from the model, its `DateTableDefinition`
is removed with it — `modelRuntime.removeTable()`:

```ts
const dateTables = model.dateTables.filter((dt) => dt.modelTableId !== modelTableId)
return { ...model, tables, relationships, calculatedColumns, dateTables, ...touch() }
```

No dangling metadata can survive its owning `ModelTable`. If the underlying
data changes shape after marking (e.g. the date column develops a gap),
nothing crashes: `validateDateTableDefinition` is re-run live every time the
UI renders the badge, and any DAX expression using the (now-invalid) column
still resolves — it isn't blocked from being *marked*, only from being
*re-marked* if the learner unmarks and tries again. Sprint 10 doesn't add a
background revalidation pass; the UI's own live badge is the mechanism for
surfacing drift (`components/notebook/model/DateTableControls.tsx`).

## Date Table validation (`runtime/dateTable/dateTableRuntime.ts`)

`validateDateTableDefinition(model, datasets, modelTableId, dateColumn)`
runs every check Power BI Desktop's own dialog implies:

| Check | Diagnostic code |
| --- | --- |
| table exists in the model | `DATE_TABLE_NOT_FOUND` |
| column exists on that table | `DATE_COLUMN_NOT_FOUND` |
| column type is `date` or `datetime` | `DATE_TABLE_INVALID_TYPE` |
| no blank/null values | `DATE_TABLE_DATE_HAS_BLANKS` |
| values are unique | `DATE_TABLE_DATE_NOT_UNIQUE` |
| calendar dates are contiguous, one row per day | `DATE_TABLE_NOT_CONTIGUOUS` |
| `datetime` values share one consistent time component | `DATE_TABLE_INCONSISTENT_TIME` |

Every failure is a structured `DateTableDiagnostic` (`severity`, `code`,
`message`, optional `details`) — never a raw JS error, and never a silent
`false`. `DATE_TABLE_REQUIRED` and `DATE_TABLE_INVALID` are also part of the
`DateTableDiagnosticCode` union (the former is emitted at DAX bind time by
`runtime/timeIntelligence/timeIntelligenceBinder.ts`, not by this
validator; the latter is available as a general-purpose catch-all but
Sprint 10 never needs it, since every specific failure has its own code).

`DATE_TABLE_NOT_CONTIGUOUS`'s `details.missingDate` names the exact missing
day, e.g. for `2025-01-01, 2025-01-02, 2025-01-04` the diagnostic reports
`missingDate: '2025-01-03'` — the UI surfaces this directly (sprint brief
§9's "Calendar[Date] contains missing dates: 2025-04-17" mockup).

Contiguity/uniqueness/blank checks all operate on the column's raw values
normalized to `YYYY-MM-DD` (via `dateMath.ts`'s `parseModelDate`/
`formatModelDate`), so a `datetime` column with a consistent midnight
timestamp validates identically to a `date` column.

## Marking and unmarking (`markDateTable`/`unmarkDateTable`)

```ts
export function markDateTable(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  modelTableId: string,
  dateColumn: ColumnRef,
): { model: SemanticModel; diagnostics: DateTableDiagnostic[] }
```

`markDateTable` validates first and only applies the marking if
`validation.valid` — identical shape to `modelRuntime.createRelationship`'s
validate-then-apply pattern. An invalid marking is returned with its
diagnostics and an **unchanged** model; it never becomes canonical model
state. `unmarkDateTable` is a plain, always-safe removal.

## Model UI

`components/notebook/model/DateTableControls.tsx` renders per table, inside
the existing "Available tables" list (`ModelCellCard.tsx`):

- **Unmarked**: a "Mark as Date Table" button. Clicking it opens a
  `<select>` of the table's `date`/`datetime` columns only (never a bare
  text field — you can't typo a column name) and a "Mark" button.
- **Marked**: a live badge —
  `DATE TABLE · Calendar[Date] ✓ Valid` (green) or
  `DATE TABLE · Calendar[Date] ✗ Invalid` (red, with every diagnostic
  message listed underneath) — recomputed on every render via
  `validateDateTableDefinition`, never a cached boolean. An "Unmark" button
  sits next to it.

`components/notebook/model/ModelTableNode.tsx` renders a matching `DATE
TABLE` text badge in the Model Canvas node header (never color alone — the
badge is a labeled pill, readable without color perception) whenever
`ModelTableNodeData.isDateTable` is true; `ModelCanvas.tsx`'s `deriveNodes()`
derives that flag straight from `model.dateTables`.

## Validation Engine integration

A new rule type lets an exercise require a specific marking:

```ts
export interface DateTableValidationRule extends BaseValidationRule {
  type: 'date-table'
  table: TableSelector
  dateColumn: ColumnSelector
}
```

`runtime/validation/dateTableValidationRule.ts`'s `evaluateDateTableRule`
resolves both selectors, checks a `DateTableDefinition` exists for that
table using exactly that column, and re-runs
`validateDateTableDefinition` — grading "is this currently valid," not "was
it valid when marked." A missing table/date-table marking is a normal
`'failed'` outcome (the learner hasn't built it yet); an unresolvable
column selector is a `'error'` (config problem), matching the existing
`classifySelectorFailure` convention across every other rule type. No
hydration was needed for `ValidationRule`/`ValidationSpec` — they were
never hydrated to begin with (rules are read fresh every run).

Measure-result rules need no new type at all: `MeasureResultValidationRule`
already supports per-case `filters`, so grading `Revenue LY`/`Revenue YTD`
under a Year/Month/Country context is just an ordinary measure-result rule
(see `docs/VALIDATION_ENGINE.md`).

## Retail Foundations fixture

The bundled Retail sample's `Calendar` table (`lib/sample/generateRetailDataset.ts`)
is one contiguous row per day from `2024-01-01` through `2025-12-31`
(731 rows) — it already passes every Date Table validation check as-is.
The Sprint 10 acceptance path is: add all four Retail tables to a model,
relate `Calendar[Date] (1) → Sales[Date] (*)`, and mark `Calendar` using
`Calendar[Date]`. See `tests/runtime/measure/timeIntelligenceRetailSample.test.ts`
for the automated version of this fixture and
`docs/TIME_INTELLIGENCE.md` for what it unlocks.

## Tests

- `tests/runtime/dateTable/dateMath.test.ts` — date normalization/arithmetic
- `tests/runtime/dateTable/dateTableRuntime.test.ts` — validation (valid
  calendar, duplicate date, blank date, missing day, string-typed column,
  inconsistent datetime), marking/unmarking, removal cleanup
- `tests/runtime/validation/dateTableValidationRule.test.ts` — the new rule
  type
- `tests/persistence/modelStore.test.ts` — legacy hydration round-trip

## Sprint 11 addendum

Date Table marking itself — the domain contract, hydration, validation
runtime, and UI documented above — is completely unaffected by Sprint 11.
The only relevant addition is that a Date Table's relationships to a fact
table can now be role-playing: multiple relationships (e.g.
`Calendar[Date] → Sales[OrderDate]` and `Calendar[Date] → Sales[ShipDate]`),
only one active at a time, switchable per calculation with
`USERELATIONSHIP`. See [`docs/USERELATIONSHIP.md`](./USERELATIONSHIP.md)
"USERELATIONSHIP + Time Intelligence" for the full composition walkthrough
— nothing about Date Table mechanics changed, so it isn't re-explained
here.

## Known limitations

- No fiscal year-end support — Sprint 10 assumes a calendar year ending
  December 31 everywhere (see `docs/TIME_INTELLIGENCE.md`).
- No background/periodic revalidation of an existing marking — validity is
  recomputed on render, not on a timer or on every dataset mutation event.
