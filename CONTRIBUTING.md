# Contributing

Thanks for looking. BI Notebook Lab is a bounded, honest teaching runtime for Power BI semantics, and outside eyes are what make it more correct. The most valuable contributions, roughly in order:

1. **A case where this runtime disagrees with real Power BI.** Open a [DAX divergence report](https://github.com/RaulMermans/bi-notebook-lab/issues/new?template=dax-divergence.yml). You don't need to write code.
2. **New conformance cases**, especially filter-propagation and relationship edge cases.
3. **Browser journeys, accessibility fixes and docs.**
4. **New DAX behaviour**, inside the documented scope.

## Local setup

Node.js 20+.

```bash
npm install
npm run dev            # http://localhost:5173
```

## Checks

CI runs the first three on every pull request. Run them before you push.

```bash
npm run typecheck      # tsc -b
npm test               # unit + integration, includes the conformance suite
npm run build
npm run conformance    # just the DAX conformance suite (fast)
npm run test:e2e       # Playwright journeys (run `npx playwright install chromium` once)
npm run benchmark      # performance harness, only if you touched evaluation hot paths
```

## Architecture boundaries

Read [`AGENTS.md`](./AGENTS.md) once. The rules that matter for most PRs:

- **BI semantics never live in React.** Everything under `src/expression/` and `src/runtime/` is framework-free TypeScript that runs headlessly in Vitest. Components in `src/components/` only render state.
- **One engine.** Calculated columns, measures, visuals, the Context Explorer and the grader all go through the same parse → bind → evaluate path. Don't add a second evaluator or a "fast path" that could disagree with it.
- **No `eval` / `new Function`.** Not for DAX, not for Power Query Custom Columns.
- **Stay inside the scope.** No PBIX import, no M interpreter, no Fabric, no accounts. See the [scope guardrail](./README.md#scope-guardrail). Calculated tables are deferred, not rejected: open an issue with the use case first.

## Where things belong

| You want to… | Look in |
| --- | --- |
| Change how an expression is parsed | `src/expression/lexer.ts`, `parser.ts`, `ast.ts` |
| Add or change a scalar function / calculated-column behaviour | `src/expression/binder.ts`, `evaluator.ts` |
| Add or change measure behaviour (aggregations, `CALCULATE` modifiers) | `src/expression/measureBinder.ts`, `src/runtime/measure/` |
| Iterators (`SUMX`, `AVERAGEX`, `MINX`, `MAXX`, `COUNTX`) | `src/runtime/iterator/` |
| Table expressions (`FILTER`, `VALUES`, `ALL`…) | `src/runtime/tableExpression/` |
| Time intelligence | `src/runtime/timeIntelligence/`, `src/runtime/dateTable/` |
| Relationships and filter propagation | `src/runtime/model/`, `src/runtime/context/` |
| Power Query Applied Steps | `src/runtime/query/` |
| Grading | `src/runtime/validation/` |
| Lessons / practice projects (data, not UI) | `src/data/lessons/`, `src/data/practiceProjects/` |

Unsupported functions must fail with a structured `UNSUPPORTED_FUNCTION` diagnostic, never with a silent wrong answer.

## Conformance cases

The suite lives in `tests/conformance/fixtures/`, one file per family, aggregated in `fixtures/index.ts`. Each case runs through the real public runtime APIs (`createMeasure` / `evaluateMeasure`, or `createCalculatedColumn`). The contract is documented in [`docs/SEMANTIC_CONFORMANCE.md`](./docs/SEMANTIC_CONFORMANCE.md).

A case looks like this (illustrative values):

```ts
{
  id: 'filterContext-011',                // family prefix + next free number
  category: 'Filter context',
  description: 'What real DAX does, in one sentence',
  fixture,                                // usually buildSharedFixture()
  expression: 'CALCULATE(SUM(Sales[Revenue]), Products[Category] = "Bikes")',
  evaluationMode: 'measure',
  filterContext: { /* optional, measure mode only */ },
  expected: 300,                          // derived WITHOUT running this code
  provenance: 'hand-calculated',
  notes: 'which fixture rows contribute, so a reviewer can recheck by hand',
}
```

Rules:

- **Derive `expected` independently.** Hand-calculate it from the fixture rows, cite documented DAX semantics, or check it in Power BI Desktop. Never paste the runtime's own output.
- **Label provenance honestly.** `hand-calculated`, `documented-dax-semantics`, or `power-bi-verified`. Use `power-bi-verified` only if you ran it in Power BI, and attach the evidence (a screenshot of the measure result is enough) to the PR. The suite currently asserts zero `power-bi-verified` cases; a PR that adds the first one should update that invariant in `conformanceReport.test.ts` in the same change.
- **A mismatch you can't fix yet is a `knownDivergence`**, with a reason. It shows up as an explicit skip. Never loosen a tolerance or change `expected` to make a case pass.

### Regression cases for bugs

If you fix a semantic bug, add the conformance case that would have caught it **first**, watch it fail, then fix. For non-semantic bugs, add a unit test next to the code under `tests/` mirroring the `src/` path.

## Semantic honesty

This project is useful only if its claims are true. In code, docs and PR descriptions:

- don't call anything "Power BI-compatible"; say what subset is covered and how it was checked;
- keep known divergences visible (tests, `SEMANTIC_CONFORMANCE.md`), never hidden in a footnote;
- update the counts in `README.md` only from a real run.

## Pull requests

- **Small and single-purpose.** One function, one family of cases, one journey or one fix per PR. A 50-line PR with a test gets reviewed fast; a 2,000-line one probably won't.
- Explain the semantics in the description: the expression, the model shape, what real DAX does, and where that's documented.
- Keep the TypeScript style you see around you: strict types, pure functions, no new runtime dependencies without discussing them in an issue first.
- New UI must be keyboard-reachable and have accessible names.

## Good issues look like

> **`CALCULATE` with two filters on the same column returns 0, Power BI returns BLANK**
> Model: shared retail fixture. Expression: `CALCULATE([Total Revenue], Products[Category] = "Bikes", Products[Category] = "Helmets")`. Expected (Power BI Desktop, Oct 2026): BLANK. Actual: 0. Screenshot attached.

> **Context Explorer: relationship edges are not announced to screen readers**
> Steps: Filter Context Lab → Model cell → Context Explorer → Tab through the diagram. Expected: each edge has a name. Actual: focus skips the diagram.

Questions and ideas are welcome as an issue with the `question` label.
