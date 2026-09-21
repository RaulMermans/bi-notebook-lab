# Time Intelligence (Sprint 10)

```text
DATE TABLE
    ↓
Current visible date set
    ↓
Time transformation
    ↓
New date set
    ↓
CALCULATE
    ↓
Relationship propagation
    ↓
Historical / cumulative measure
```

Six DAX functions, one new table-expression variant, one new CALCULATE
modifier, zero new evaluation engines. See
[`docs/DATE_TABLES.md`](./DATE_TABLES.md) for the marking these functions
require, [`docs/CALCULATE.md`](./CALCULATE.md) for the filter-modification
machinery they plug into, and
[`docs/TABLE_EXPRESSIONS.md`](./TABLE_EXPRESSIONS.md) for the table-expression
abstraction they extend.

## Classic vs. calendar-based time intelligence

Power BI has two time-intelligence models:

- **Classic** (Sprint 10's scope): a physical, marked Date Table with an
  explicit relationship to the fact table. `SAMEPERIODLASTYEAR`, `DATEADD`,
  etc. read/replace that table's filter state. This is the traditional
  Power BI Desktop workflow, and the one every classic DAX course teaches
  first.
- **Calendar-based** (out of scope): the modern "Auto date/time" hidden
  tables, `CALENDAR()`/`CALENDARAUTO()` calculated tables, and date
  hierarchies. None of this is implemented — see "Explicitly out of scope"
  below.

Sprint 10 uses Classic because it's the mechanism every other Sprint 10
concept (Filter Context, CALCULATE, relationship propagation) already
composes with directly — a calendar-based model would need its own
calculated-table runtime first.

## Date normalization (`runtime/dateTable/dateMath.ts`)

Every model date is stored as an ISO `YYYY-MM-DD` (or `YYYY-MM-DDTHH:mm:ss...Z`)
string. `dateMath.ts` is the one place that ever parses or arithmetic-izes
those strings, always through `Date.UTC`/`getUTCFullYear`/etc. — never a
local-timezone getter/setter, so a shift is deterministic independent of
the browser's timezone or DST:

```ts
export interface ModelDate { year: number; month: number; day: number }

parseModelDate(value: unknown): ModelDate | undefined
formatModelDate(date: ModelDate): string           // → 'YYYY-MM-DD'
compareModelDates(a: ModelDate, b: ModelDate): number
addDays(date: ModelDate, count: number): ModelDate
addMonthsClassic(date: ModelDate, count: number): ModelDate
addYearsClassic(date: ModelDate, count: number): ModelDate
shiftByInterval(date: ModelDate, count: number, unit: 'YEAR'|'QUARTER'|'MONTH'|'DAY'): ModelDate
startOfMonth/endOfMonth/startOfYear/endOfYear(date: ModelDate): ModelDate
```

**Classic month/year math is deterministic, never JS Date rollover:**

- `addYearsClassic({2024-02-29}, -1)` → `2023-02-28` (clamped, not
  `2023-03-01`).
- `addMonthsClassic({2025-01-31}, 1)` → `2025-02-28` (clamped to the last
  valid day of the destination month, not `2025-03-03`).

## Marked Date Table requirement

Every function below requires its date-column argument to be the exact
canonical column of an already-marked `DateTableDefinition`
(`runtime/timeIntelligence/timeIntelligenceBinder.ts`'s
`bindDateColumnArgument`, shared by all five table binders and `TOTALYTD`):

```dax
SAMEPERIODLASTYEAR(Calendar[Date])     -- valid, if Calendar is marked using Calendar[Date]
SAMEPERIODLASTYEAR(Sales[Date])        -- DATE_TABLE_REQUIRED
```

The diagnostic names the fix directly: *"Mark 'Sales' as a Date Table and
use 'Sales[Date]'."* (or, more usually, points the learner back at the
already-marked Calendar table). This is checked at **bind time** — it's a
property of the model, not of the runtime filter state.

## The table-expression variant

`SAMEPERIODLASTYEAR`, `DATEADD`, `PREVIOUSMONTH`, `PREVIOUSYEAR` and
`DATESYTD` all bind to one new `BoundTableExpression` variant
(`runtime/tableExpression/tableExpressionTypes.ts`):

```ts
export type TimeIntelligenceOperation =
  | 'same-period-last-year' | 'date-add' | 'previous-month' | 'previous-year' | 'dates-ytd'

export interface BoundTimeIntelligenceTable {
  kind: 'TimeIntelligenceTable'
  operation: TimeIntelligenceOperation
  modelTableId: string
  dateColumn: ColumnRef
  dateColumnName: string
  tableName: string
  label: string
  span: SourceSpan
  intervalUnit?: 'YEAR' | 'QUARTER' | 'MONTH' | 'DAY'  // DATEADD only
  intervalCount?: number                                // DATEADD only
}
```

`tableExpressionBinder.ts`'s single dispatch switch gained five more
`if (name === ...)` branches (delegating to
`runtime/timeIntelligence/timeIntelligenceBinder.ts`);
`tableExpressionEvaluator.ts`'s single evaluator switch gained one more
case (delegating to `evaluateTimeIntelligenceTable`). This is the same
"one binder, one evaluator, every consumer shares it" discipline
`FILTER`/`VALUES`/`DISTINCT` already followed — no second table-expression
abstraction.

Evaluating a `BoundTimeIntelligenceTable` produces ordinary `model-row`
`TableExpressionRow`s rooted at the Date Table — every output row retains
its physical row index and full row data, so `CALCULATE` can apply the
result back to the Date Table exactly like any other row selection, and
`COUNTROWS(SAMEPERIODLASTYEAR(Calendar[Date]))` works with zero special
casing (see "Table expressions and CALCULATE" below).

## Date index

`runtime/timeIntelligence/timeIntelligenceEvaluator.ts` builds a
`YYYY-MM-DD → row index` map for the Date Table once per computation and
reuses it for every date the operation needs to look up — evaluation is
`O(visible dates + Date Table size)`, never a scan of the fact table. The
Retail Calendar is 731 rows; this is effectively instant.

## SAMEPERIODLASTYEAR

```dax
SAMEPERIODLASTYEAR(Calendar[Date])
```

Reads the currently visible Date Table dates, shifts each one back one
Classic year (leap-day clamped), and returns whichever shifted dates
actually exist in the Date Table. `2025-03-01 → 2024-03-01`;
`2024-02-29 → 2023-02-28`. If the shifted year isn't in the Date Table at
all (e.g. the Retail Calendar starts in 2024, so a 2024 context shifts to a
nonexistent 2023), the result is empty and the measure returns `BLANK` —
this is correct, not a bug (sprint brief §51): never invent dates.

## DATEADD

```dax
DATEADD(Calendar[Date], -1, MONTH)
```

Supported intervals: `YEAR`, `QUARTER`, `MONTH`, `DAY` — not `WEEK`. The
interval keyword binds as a bare identifier (it parses as a
`TableReference` node, exactly like a bare table name — see `parser.ts`),
never a string literal:

```dax
DATEADD(Calendar[Date], -1, MONTH)      -- valid
DATEADD(Calendar[Date], -1, "MONTH")    -- DATEADD_INVALID_INTERVAL
DATEADD(Calendar[Date], -1, WEEK)       -- DATEADD_INVALID_INTERVAL
```

The offset must be a constant integer (`-2, -1, 0, 1, 2`, optionally as a
negated literal) — anything else is `DATEADD_INTERVAL_COUNT_INVALID` at
bind time.

**Contiguous-context requirement**: DATEADD shifts an entire *range*, so
its current visible dates must already form a contiguous run of days. This
can only be checked once the actual filter state is known, so it's a
**runtime** check (`DATEADD_NON_CONTIGUOUS_CONTEXT`), not a bind-time one —
propagated back through `EvaluatedTableExpression.diagnostics` (bare table
expression usage) or `ModifierOutcome.diagnostics` (inside `CALCULATE`,
where it short-circuits the whole `CALCULATE` before the inner expression
ever evaluates). Shifted dates that fall outside the Date Table are simply
omitted from the result — a 2024-only context shifted `-1 YEAR` in the
Retail sample legitimately returns an empty set.

**Documented boundary** (sprint brief §29): Power BI has special extension
behavior when the selected range touches the last two days of a month.
Sprint 10 implements standard Classic contiguous-date shifting only and
does **not** emulate that edge case.

## PREVIOUSMONTH

```dax
PREVIOUSMONTH(Calendar[Date])
```

Takes the **first** currently visible date, finds the calendar month
immediately before it, and returns every Date Table row in that whole
month — not merely the shifted single day. A single mid-month selection
(`2025-03-20`) still returns all of February 2025, not February 20th; this
is the documented distinction from `DATEADD(Calendar[Date], -1, MONTH)`,
which shifts every individual visible date (see the acceptance test in
`tests/runtime/measure/timeIntelligence.test.ts`, "PREVIOUSMONTH returns
the *whole* previous month even from a single mid-month day").

## PREVIOUSYEAR

```dax
PREVIOUSYEAR(Calendar[Date])
```

Takes the **first** currently visible date's year, subtracts one, and
returns every Date Table row in that whole year. This is **not** the same
as `SAMEPERIODLASTYEAR`: under a `Year = 2025, Month = March` context,
`PREVIOUSYEAR` returns all of 2024, while `SAMEPERIODLASTYEAR` returns only
March 2024. Both are covered side-by-side in the Retail sample tests to
make the distinction concrete.

## DATESYTD

```dax
DATESYTD(Calendar[Date])
```

Takes the **last** currently visible date, and returns every Date Table row
from January 1st of that year through that date, inclusive. If there are no
visible dates at all, the result is an empty table expression — not an
error (sprint brief §33).

**No fiscal year-end argument.** `DATESYTD(Calendar[Date], "6/30")` is
explicitly out of scope; Sprint 10 only supports the calendar year ending
December 31.

## TOTALYTD

```dax
TOTALYTD([Total Revenue], Calendar[Date])
```

Binds directly to the same bound shape
`CALCULATE([Total Revenue], DATESYTD(Calendar[Date]))` would produce — a
`BoundCalculate` node wrapping a `DateTableReplace` modifier around a
`dates-ytd` `BoundTimeIntelligenceTable`
(`expression/measureBinder.ts`'s `bindTotalYtd`). There is no separate YTD
evaluator: the two forms are numerically identical by construction, not by
coincidence, and `tests/runtime/measure/timeIntelligenceRetailSample.test.ts`
proves it under no filter, a Country filter, and a combined filter. The
first argument may be any measure expression, not only a plain aggregation.
No fiscal year-end argument, matching `DATESYTD`.

## Date Table filter replacement — the critical semantics

This is the single most important behavior in Sprint 10. Given:

```text
Calendar[Year] = 2025
Calendar[Month] = March
```

and:

```dax
Revenue LY = CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))
```

the correct result is **March 2024's revenue** — not blank. A naive
implementation that *intersects* the shifted date set with the existing
`Year = 2025` filter would compute `Year = 2025 AND Date in March 2024`,
which is always empty.

The fix is a dedicated `FilterModifier` variant
(`runtime/measure/contextModifier.ts`):

```ts
export interface DateTableReplaceModifier {
  kind: 'DateTableReplace'
  bound: BoundTimeIntelligenceTable
  label: string
}
```

`applyFilterModifier`'s `DateTableReplace` case:

1. Reads the *ambient* (outer/incoming) `ResolvedFilterState` — the
   context as it existed before this `CALCULATE` call — to determine the
   currently visible dates.
2. Computes the target row set via
   `computeTimeIntelligenceRowIndexes`.
3. **Removes every existing column filter and table selection** on the
   Date Table's model table (`Year`, `Month`, anything else) — a full
   clear, not a merge.
4. Installs the computed row set as the Date Table's new, sole selection.

Everything else in the outer context is untouched: a `Country = Spain`
filter on `Customers` (an unrelated table) survives unchanged, because step
3 only touches filters whose owning table is the Date Table itself. Normal
relationship propagation (`runtime/measure/filterPropagation.ts`, unchanged
by Sprint 10) then carries the new Calendar selection to `Sales` exactly
like any other filter would.

This is deliberately **not** a generic behavior of "any filter on
`Calendar[Date]`" — it is scoped to time-intelligence table expressions
specifically, via the `DateTableReplace` modifier kind. An ordinary
`CALCULATE([Total Revenue], Calendar[Date] = "2025-03-15")` still uses
`ReplaceColumnFilter` (Sprint 8's existing single-column replacement) and
behaves exactly as it did before Sprint 10 — see
`docs/CALCULATE.md` "Same-column replacement." Sprint 8's `FILTER`/`ALL`/
`REMOVEFILTERS` modifiers, and their intersection/table-wide-replacement
rules, are entirely unchanged.

## Table expressions and CALCULATE — two callers, one implementation

Every function above is reachable two ways, sharing one binder and one
evaluator:

```dax
CALCULATE([Total Revenue], DATESYTD(Calendar[Date]))   -- as a CALCULATE filter argument
COUNTROWS(DATESYTD(Calendar[Date]))                     -- as a bare table expression
```

`expression/measureBinder.ts`'s `bindCalculateFilterArgument` recognizes
the five function names and wraps the bound `BoundTimeIntelligenceTable` in
a `DateTableReplace` modifier (mirroring `bindFilterFunction`'s exact
shape for `FILTER`); `bindCountRows`/`bindIteratorCall` reach the same
bound node through the ordinary `bindTableExpression` dispatch used by
every other table-shaped argument. Iterator usage
(`COUNTX(SAMEPERIODLASTYEAR(...), ...)`) is not specially supported or
blocked — it isn't required (sprint brief §38), but nothing prevents it
either, since a `BoundTimeIntelligenceTable` evaluates to ordinary
`model-row` rows an iterator already knows how to consume.

## Relationship propagation

Time intelligence never filters the fact table directly. The full chain
for `Revenue LY`:

```text
Calendar date set transformed (SAMEPERIODLASTYEAR)
    ↓
Calendar rows filtered (DateTableReplace)
    ↓
Calendar[Date] 1 → * Sales[Date]   (ordinary relationship propagation, unchanged)
    ↓
Sales rows filtered
    ↓
Total Revenue evaluated
```

If `Calendar → Sales` is inactive, the transformed Calendar filter simply
doesn't propagate — `Total Revenue` and `Revenue LY` both evaluate against
every Sales row, identically, exactly as any other inactive-relationship
filter would behave. Re-activating the relationship recovers the correct
result immediately, with no extra state to reset (verified in both
`tests/runtime/measure/timeIntelligence.test.ts` and live in the running
app).

## Context-safe cache

`CALCULATE` (and therefore every `DateTableReplace` modifier) always
evaluates its inner expression under a **fresh** measure-evaluation cache
— this is Sprint 8's existing rule, unchanged. `Revenue YoY = [Total
Revenue] - [Revenue LY]` is the load-bearing proof: `[Total Revenue]`
evaluated for the outer expression and `[Total Revenue]` evaluated *inside*
`Revenue LY`'s `CALCULATE(..., SAMEPERIODLASTYEAR(...))` never share a
cached value, because the inner `CALCULATE` scope gets its own `cache: new
Map()` (see `docs/CALCULATE.md` "Context transition boundary" for why this
was already true before Sprint 10, and
`tests/runtime/measure/timeIntelligence.test.ts`'s YoY test for the direct
proof).

## Trace / Context Explorer / Visual Cells

Four new `ExecutionTraceNode` kinds — `date-table`, `time-intelligence`,
`date-shift`, `date-period` — are emitted by
`computeTimeIntelligenceRowIndexes` and surfaced verbatim inside
`CALCULATE`'s existing modifier trace (`measureEvaluator.ts`'s
`buildModifierTraceNode`). A trace for `Revenue LY` reads:

```text
SAMEPERIODLASTYEAR(Calendar[Date])
  Calendar
  Current visible dates: 2025-03-01 → 2025-03-31 (31 dates)
  Shift: -1 YEAR (classic)
  Result: 2024-03-01 → 2024-03-31 (31 dates)
```

**No new Context Explorer or Visual Cell code was written.** Both already
render `ExecutionTraceNode` trees and `evaluateMeasure()`'s output
generically — confirmed live: creating `Revenue LY`/`Revenue PM`/`Revenue
YTD` and switching the Context Explorer's measure selector to any of them
immediately renders the correct value, the correct relationship-propagation
diagram (Calendar/Sales row counts), and the trace above with zero extra
integration work.

## Validation Engine compatibility

No new rule type is needed to grade a time-intelligence measure's numeric
output — `MeasureResultValidationRule`'s existing per-case `filters` are
sufficient (`docs/VALIDATION_ENGINE.md`). The only new rule type,
`date-table`, grades the Date Table *marking* itself (see
`docs/DATE_TABLES.md`).

## Retail examples

```dax
Total Revenue = SUM(Sales[Revenue])

Revenue LY =
CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))

Revenue Previous Month Shift =
CALCULATE([Total Revenue], DATEADD(Calendar[Date], -1, MONTH))

Revenue PM =
CALCULATE([Total Revenue], PREVIOUSMONTH(Calendar[Date]))

Revenue PY =
CALCULATE([Total Revenue], PREVIOUSYEAR(Calendar[Date]))

Revenue YTD = TOTALYTD([Total Revenue], Calendar[Date])

Revenue YTD Explicit =
CALCULATE([Total Revenue], DATESYTD(Calendar[Date]))

Revenue YoY = [Total Revenue] - [Revenue LY]

Revenue YoY % = DIVIDE([Revenue YoY], [Revenue LY])

Revenue MoM = [Total Revenue] - [Revenue PM]

Revenue MoM % = DIVIDE([Revenue MoM], [Revenue PM])
```

Because the bundled Retail Calendar only spans 2024-2025, `Revenue LY` is
meaningful for 2025 but returns `BLANK` for 2024 (2023 doesn't exist) —
this is correct, documented behavior, not a defect (sprint brief §51).

## Tests

- `tests/runtime/measure/timeIntelligence.test.ts` — hand-built 2024-2025
  fixture: all five functions, `TOTALYTD`, the critical filter-replacement
  regression, an unrelated-column-filter-survives check, PREVIOUSYEAR vs.
  SAMEPERIODLASTYEAR, DATEADD's contiguous-context/interval/count
  rejections, the unmarked-Date-Table rejection, the inactive-relationship
  regression, YoY/YoY%, `IF` over a time-intelligence measure reference,
  and `COUNTROWS` over a bare time-intelligence table expression.
- `tests/runtime/measure/timeIntelligenceRetailSample.test.ts` — the same
  scenarios end-to-end against the real bundled Retail dataset.
- `tests/runtime/dateTable/dateMath.test.ts` — date arithmetic.

## Sprint 11 addendum

`USERELATIONSHIP`/`CROSSFILTER` (Sprint 11 — see
[`docs/USERELATIONSHIP.md`](./USERELATIONSHIP.md)) compose with every
function on this page **with no new implementation**, at a summary level:
`computeTimeIntelligenceRowIndexes` (`runtime/timeIntelligence/
timeIntelligenceEvaluator.ts`) only ever reads the *ambient* (outer,
already-resolved) `ResolvedFilterState` — it has no relationship awareness
at all, and nothing about it changed in Sprint 11. Because `USERELATIONSHIP`
and a time-intelligence function like `SAMEPERIODLASTYEAR` are just two
independent modifiers folded into the same `EffectiveContext` and then
resolved together in one `resolveFilterContextUnchecked` call, a Date
Table's shifted row selection simply propagates through whichever
relationship `USERELATIONSHIP` made effective for that calculation —
composition falls out of the existing modifier-application architecture for
free. See [`docs/USERELATIONSHIP.md`](./USERELATIONSHIP.md)
"USERELATIONSHIP + Time Intelligence" for the full walkthrough (the
canonical `Shipped Revenue LY` example) and
`tests/runtime/measure/userelationship.test.ts` for the end-to-end proof.

## Known DAX compatibility limitations

- Calendar-year only — no fiscal year-end argument on `DATESYTD`/`TOTALYTD`.
- `DATEADD` does not emulate Power BI's last-two-days-of-month extension
  behavior (sprint brief §29) — standard Classic contiguous shifting only.
- No `DATESMTD`/`DATESQTD`/`TOTALMTD`/`TOTALQTD`/`DATESINPERIOD`/
  `DATESBETWEEN`/`PARALLELPERIOD`/`PREVIOUSQUARTER`/`PREVIOUSDAY`/
  `FIRSTDATE`/`LASTDATE`/`STARTOFMONTH`/`ENDOFMONTH`/`STARTOFYEAR`/
  `ENDOFYEAR` as DAX functions — the underlying date math they'd need
  (`startOfMonth`/`endOfMonth`/`startOfYear`/`endOfYear`) already exists in
  `dateMath.ts`, but no binder/table-expression surface was built for them.
- `WEEK` is not a supported `DATEADD` interval.
- **`USERELATIONSHIP`/`CROSSFILTER` and role-playing date dimensions are
  now implemented** (Sprint 11) — see "Sprint 11 addendum" below.
- No calculated tables (`CALENDAR()`/`CALENDARAUTO()`), no "Auto date/time"
  hidden tables, no date hierarchies.
- Iterator + time-intelligence composition (`SUMX(SAMEPERIODLASTYEAR(...),
  ...)`) isn't specially tested — it isn't blocked, but it also isn't part
  of the required interoperability surface (CALCULATE, COUNTROWS, visual
  filter/member context).
