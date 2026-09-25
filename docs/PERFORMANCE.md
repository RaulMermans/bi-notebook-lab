# Performance Profile (Sprint 16)

## Harness

`tests/performance/benchmark.ts`, run with `npm run benchmark` (`vite-node
tests/performance/benchmark.ts`). Deliberately not a `*.test.ts` file, so it
never runs as part of `npm test` and never asserts a strict wall-clock bound
— machine speed varies, so this produces a report, not a pass/fail gate
(brief §18).

It builds a deterministic Retail star schema (`generateRetailDataset`, now
parameterized with an optional `{ salesCount }`, brief §19) at four sizes —
1,000 / 10,000 / 50,000 / 100,000 Sales rows — and times the real, headless
runtime entry points every other surface in the app already goes through
(brief §20): `evaluateCalculatedColumn`, `evaluateMeasure`,
`evaluateAllQueries` (Power Query Applied Steps), `analyzeMeasureContext`
(Context Explorer), and `runValidation`. No browser, no React — matching
AGENTS.md guardrail #3.

**Caveat**: this ran under Node/V8 on the development machine, not inside an
actual browser tab under real UI load. Both are V8, so the numbers are a
reasonable proxy, not a literal browser measurement — treat the *shape* of
the results (comfortably sub-second at every tested size) as the finding,
not the exact millisecond figures.

## Results (this machine, this run)

All times in milliseconds. Bucket thresholds per brief §22: `<100ms`
immediate, `100–500ms` acceptable, `500ms–1s` noticeable, `>1s` blocking
candidate.

| Category | Operation | 1k | 10k | 50k | 100k |
|---|---|---|---|---|---|
| Data | Generate + type Sales table | 9.7 | 22.3 | 99.1 | 187.7 |
| Calculated Columns | Simple arithmetic | 1.8 | 5.8 | 31.0 | 56.9 |
| Calculated Columns | RELATED | 4.3 | 31.1 | 124.0 | 243.7 |
| Measures | SUM | 0.3 | 1.3 | 5.7 | 10.5 |
| Measures | DISTINCTCOUNT | 0.6 | 1.3 | 6.0 | 11.9 |
| Measures | SUMX | 2.0 | 5.0 | 24.6 | 36.7 |
| Measures | FILTER (via CALCULATE) | 0.6 | 2.5 | 11.4 | 23.8 |
| Measures | CALCULATE (column filter) | 0.5 | 2.1 | 11.0 | 24.4 |
| Measures | Time intelligence (SAMEPERIODLASTYEAR) | 2.6 | 5.5 | 19.7 | 36.6 |
| Context Explorer | Filter propagation analysis | 1.9 | 3.7 | 16.2 | 30.7 |
| Power Query | Filter | 0.3 | 0.8 | 3.1 | 4.2 |
| Power Query | Remove duplicates | 0.3 | 1.7 | 7.4 | 15.6 |
| Power Query | Group by | 0.5 | 3.0 | 16.7 | 28.9 |
| Power Query | Unpivot | 1.7 | 3.1 | 39.2 | 49.0 |
| Power Query | Custom column | 0.6 | 1.3 | 6.0 | 10.5 |
| Validation | Full Retail checkpoint | 2.4 | 4.6 | 12.2 | 11.6 |
| Validation | Query checkpoint | 0.2 | 0.1 | 0.1 | 0.1 |

**0 of 17 measured operations reached the 1s "blocking candidate" threshold, or even the 500ms–1s "noticeable" band, at the 100,000-row supported limit. Most stayed in the <100ms "immediate" bucket; the slowest (`RELATED` calculated column at 100k) was 243.7ms, which is "acceptable".**

> Correction (README evidence pass): an earlier version of this sentence said no operation exceeded 100ms, which contradicted the table above. Re-running the harness on a different machine gave the same shape: all 17 operations were under 1s, and the slowest was about 250ms at 100k rows.

Power Query's Merge and Append steps were not included in this run (each
needs a second full-size query as its right-hand side, which would roughly
double the row-processing cost of an already-representative set of
operations) — Filter/Group By/Unpivot/Custom Column/Remove Duplicates cover
the same per-row evaluation path and give a representative proxy for their
cost.

## Decisions this evidence supports

### Row limit (brief §28)

**Outcome A: the documented 100,000-row-per-table limit remains supported.**
Every measured operation stays comfortably under the "acceptable" band at
100k rows on ordinary developer hardware. There is no evidence the limit
creates unacceptable browser behavior; lowering it would be
precautionary, not evidence-based, so `DATA_LIMITS.maxRowsPerTable` in
`src/domain/data.ts` is unchanged.

### Web Workers (brief §23, §27)

**Not introduced.** The brief's own gate — move execution off the UI thread
only if common operations repeatedly exceed ~500ms–1s at supported sizes —
is not met anywhere in this profile. Every category stays under 250ms even
at 100k rows. Introducing a worker boundary, message-passing contracts, and
stale-result cancellation would be architecture built for a bottleneck this
profile does not show. If a future profile (e.g. a much larger multi-table
model, or a slower target device class) shows a different picture, revisit
this decision with fresh evidence rather than assumption.

## Practical responsiveness categories (brief §22)

| Bucket | Range | Meaning |
|---|---|---|
| Immediate | `<100ms` | No perceptible delay |
| Acceptable | `100–500ms` | Fine for a click-triggered action |
| Noticeable | `500ms–1s` | Should show a loading state |
| Blocking candidate | `>1s` | Candidate to move off the UI thread |

These are product heuristics for judging UX impact, not semantic-correctness
rules — see `docs/WORKSPACE_INTEGRITY.md`/`docs/SEMANTIC_CONFORMANCE.md` for
those.
