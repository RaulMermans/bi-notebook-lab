# Changelog

## v1.0.0 — 2026-10-09

First public release. BI Notebook Lab is a browser-based learning lab for Power BI semantics: a bounded subset of Power Query, semantic models and DAX, backed by one real expression engine and graded by execution.

### Included

- **Data:** CSV and Excel (multi-sheet) import, schema inference, profiling, key detection, four built-in synthetic datasets.
- **Power Query:** 19 typed Applied Steps (including Merge, Append, Pivot, Unpivot, Group By, Conditional and Custom Column), a query dependency graph, step-by-step previews. No M interpreter.
- **Semantic model:** 1:\*, 1:1 and \*:\* relationships, single and bidirectional filtering, active/inactive relationships, `USERELATIONSHIP`, `CROSSFILTER`, and a fail-closed guard against ambiguous or cyclic paths.
- **DAX:** calculated columns and measures on one lexer → parser → binder → evaluator pipeline; `CALCULATE` with replacement semantics, `REMOVEFILTERS`, bounded `KEEPFILTERS`; `SUMX`/`AVERAGEX`/`MINX`/`MAXX`/`COUNTX`; table expressions; `VAR`/`RETURN` (scalar); `ISBLANK`, `HASONEVALUE`, `SELECTEDVALUE`; classic time intelligence (`SAMEPERIODLASTYEAR`, `DATEADD`, `PREVIOUSMONTH`, `PREVIOUSYEAR`, `DATESYTD`) over a marked date table.
- **Visuals:** KPI, Bar, Line, Table and Slicer on the same measure runtime.
- **Context Explorer:** filter-propagation trace from a filter, through relationships, to the evaluated rows, with a plain-English narrative.
- **Learning:** guided Exercises with checkpoints, hints, solution reveal and progress history; four Free Lab practice projects; execution-based grading with weighted partial credit and a staleness fingerprint.
- **Portability:** local-first IndexedDB persistence and `.bilab.json` project export/import.

### Deliberately excluded

Full DAX and full M compatibility, calculated tables, `CALENDAR`/`CALENDARAUTO`, `SUMMARIZE`, table-valued `VAR`, `CALCULATETABLE`, PBIX/PBIP import, Fabric, accounts, collaboration and any backend. See the [scope guardrail](./README.md#scope-guardrail) and [`ROADMAP.md`](./ROADMAP.md).

### Evidence at release

Recorded on 2026-10-09 against the release branch (Linux, Node 20):

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | 1,024 passed, 1 skipped (115 files) |
| `npm run conformance` | 82 of 83 hand-verified DAX cases pass; 1 documented known divergence |
| `npm run build` | passes |
| `npm run test:e2e` | 2 of 2 Playwright journeys pass |
| `npm run benchmark` | 0 of 17 operations exceeded 1 s at 100k rows |

No conformance case is yet labelled `power-bi-verified`. Every expected value is hand-calculated or derived from documented DAX semantics.

### Known limitations

- `BLANK() + 5` returns `BLANK()`; real DAX returns `5`. Arithmetic propagates blank through every operator instead of applying DAX's per-operator coercion (conformance case `blank-008`, tracked as a known divergence).
- The DAX and Power Query coverage is a subset by design. Unsupported functions fail with a structured diagnostic rather than a wrong answer.
- Performance is profiled headlessly in Node/V8 up to 100,000 rows; larger datasets are not a goal.
- Projects live in the browser's IndexedDB until exported.

### Run it

```bash
npm install
npm run dev   # http://localhost:5173
```

### Contribute

Divergence reports, conformance cases and small fixes are welcome. Start at [`CONTRIBUTING.md`](./CONTRIBUTING.md).
