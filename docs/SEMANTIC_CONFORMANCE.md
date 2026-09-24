# Semantic Conformance Suite (Sprint 15)

## Why this suite exists

By the end of Sprint 14, this codebase had 857 passing unit/integration
tests. Those tests are good at answering one question: **does the code do
what we told it to do?** A binder test asserts that `bindMeasureExpression`
produces the `BoundMeasureExpression` tree the test author expects; an
evaluator test asserts that tree evaluates to the value the test author
expects. If the test author's expectation was itself wrong — if it quietly
encoded a divergence from how real DAX actually behaves — the test suite
would happily stay green forever.

The Semantic Conformance Suite (`src/conformance/`, cases in
`tests/conformance/`) asks the sharper, second question: **is the supported
DAX subset actually correct** — does it behave the way real DAX documents
and defines its own semantics, not just the way this codebase's own tests
were written to expect? Every expected value in this corpus is derived
independently of the runtime under test (hand-calculated from a fixture's
raw rows, or read directly off documented DAX semantics), specifically so
it *can't* silently encode the same mistake as the code it's checking.

## The `DaxConformanceCase` contract

```ts
interface DaxConformanceCase {
  id: string
  category: string
  description: string
  fixture: ConformanceModelFixture       // { model, datasets, homeModelTableId? }
  expression: string
  evaluationMode: 'measure' | 'calculated-column'
  filterContext?: FilterContext          // measure mode only
  expected: ValidationScalar
  tolerance?: NumericTolerance
  provenance: ConformanceProvenance
  notes?: string
  knownDivergence?: { reason: string; trackingId?: string }
}
```

`runConformanceCase` (`src/conformance/runCase.ts`) runs each case through
the **real public runtime APIs** — `createMeasure`/`evaluateMeasure` from
`measureRuntime.ts`, or `createCalculatedColumn` from
`calculatedColumnRuntime.ts` — the exact same parse → bind → validate →
evaluate path a learner's own measure or calculated column goes through.
The comparison itself uses the pre-existing, tolerance-aware `compareScalar`
(`runtime/validation/scalarComparison.ts`), never a private helper written
just for this suite — a second comparison implementation could itself
silently drift from what the Validation Engine actually uses to grade a
learner.

## Provenance, stated honestly

```ts
type ConformanceProvenance =
  | 'hand-calculated'          // computed by hand from the fixture's raw rows
  | 'documented-dax-semantics' // derived from documented DAX behavior, not fixture arithmetic
  | 'power-bi-verified'        // checked against a real Power BI Desktop/Fabric evaluation
```

**This pass uses `hand-calculated` and `documented-dax-semantics` only.** No
case in this initial corpus is `power-bi-verified` — that label is reserved
for a case that has actually been checked against a real Power BI
evaluation, which has not been done here. `tests/conformance/
conformanceReport.test.ts` asserts this as a hard invariant (zero
`power-bi-verified` cases), so a future case can't casually claim that label
without someone actually doing the verification it implies.

## Known divergences

A case can carry a `knownDivergence: { reason, trackingId? }`. When it does,
`daxConformance.test.ts` reports it via `it.skip` — visible in the test
output as explicitly skipped, never silently passed and never silently
hidden. A known divergence is for a documented, deliberate (or at least
deliberately-not-yet-fixed) gap between this runtime and real DAX — never a
way to quietly paper over an unexplained mismatch.

**The one known divergence in this pass**, `blanks.ts`'s `blank-008`:

```DAX
BLANK() + 5
```

Real, documented DAX semantics coerce `BLANK()` to `0` for addition, so this
should evaluate to `5`. This codebase's arithmetic evaluators
(`evaluator.ts`/`measureEvaluator.ts` — pre-existing Sprint 3/4 code, not
new this sprint) instead propagate blank through **every** arithmetic
operator uniformly: `+`, `-`, `*`, and `/` all return blank if either
operand is blank, which only actually matches real DAX for `/`. This is a
genuine, previously-undocumented semantic gap that this suite surfaced —
recorded here with that exact reasoning, not fixed. Fixing arithmetic's
blank-coercion behavior would be a distinct, more invasive change to
long-standing Sprint 3/4 code, deserving its own review rather than a quiet
side effect of adding a test corpus — see
[`EXPRESSION_ENGINE.md`](./EXPRESSION_ENGINE.md) "Null/blank semantics" for
where this simplification was originally documented.

## Family breakdown

`tests/conformance/fixtures/` holds one file per family plus a shared
retail fixture (`sharedFixture.ts` — Customers 1→\*→ Sales \*→1← Products,
with one deliberately-blank row for blank-propagation coverage) most
families build on, aggregated in `fixtures/index.ts` as
`ALL_CONFORMANCE_CASES`:

| Family | File | Cases |
|---|---|---|
| Scalar arithmetic | `scalar.ts` | 10 |
| Blanks | `blanks.ts` | 8 |
| Variables (`VAR`/`RETURN`) | `variables.ts` | 8 |
| Aggregations | `aggregations.ts` | 9 |
| Filter context (incl. `SELECTEDVALUE`, `HASONEVALUE`) | `filterContext.ts` | 10 |
| `CALCULATE` (incl. `KEEPFILTERS`, replace-vs-intersect proof) | `calculate.ts` | 11 |
| Iterators | `iterators.ts` | 7 |
| Relationships (incl. inactive-relationship blocking) | `relationships.ts` | 6 |
| Time intelligence (dedicated Calendar+Sales fixture, real Date Table) | `timeIntelligence.ts` | 7 |
| Advanced relationships (1:1, \*:\*, bidirectional, `CROSSFILTER`, `USERELATIONSHIP`) | `advancedRelationships.ts` | 7 |
| **Total** | | **83** |

83 sits well above the ≥60 floor the sprint set for this pass.
`tests/conformance/conformanceReport.test.ts` asserts the report stays
internally consistent (category totals sum correctly, the corpus stays
≥60 cases) and prints the human-readable summary table produced by
`formatConformanceReport` (`src/conformance/report.ts`) — generated from the
actual case list every run, never a hand-maintained count that could drift
from reality.

## Running it

```bash
npm run conformance
```

Runs `vitest run tests/conformance` — the same corpus `npm test` already
covers as part of the full suite, just scoped down to this directory alone.
`daxConformance.test.ts` iterates every case in `ALL_CONFORMANCE_CASES`: a
case with `knownDivergence` is reported via `it.skip`; every other case must
match its `expected` value (within `tolerance`, if given) or the suite
fails outright — there is no soft-fail mode for an unexplained mismatch.
