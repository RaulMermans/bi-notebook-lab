# Release-Level E2E Suite (Sprint 16 Part G)

## Harness

[Playwright](https://playwright.dev), configured in `playwright.config.ts`.
`npm run test:e2e` starts the real Vite dev server
(`webServer` in the config) and drives it in headless Chromium — no mocking,
the same IndexedDB-backed app a learner actually opens.

```bash
npx playwright install chromium   # one-time browser download
npm run test:e2e
```

## Journeys covered

The brief lists five candidate journeys (A–E). This sprint implements two —
the two that exercise the biggest genuinely-new Sprint 16 surfaces — rather
than all five, per an explicit "breadth pass, skip/stub the heaviest items"
scoping decision for this sprint.

- **Journey A — First-Time Free Lab** (`tests/e2e/free-lab-first-time.spec.ts`):
  open the app cold, start a Practice Project from the empty-state gallery,
  create a measure, see it evaluate, reload the page, and confirm the
  measure survives (IndexedDB persistence). Asserts zero unexpected
  console/page errors throughout.

  Uses the **DAX Playground** practice project rather than **Retail
  Modeling** — Retail Modeling deliberately starts with an empty,
  table-less model (the point of that template is practicing star-schema
  construction), so measure creation isn't available until the learner adds
  relationships. DAX Playground starts from a completed star schema
  specifically so "create a measure" is the very next action, matching the
  spirit of "first successful action" the journey is meant to prove.

- **Journey D — Portable Project** (`tests/e2e/portable-project.spec.ts`):
  export the active project, mutate the workspace (add a measure that must
  NOT survive), import the exported bundle back, and assert the mutation is
  gone while the original state is restored. This proves import genuinely
  *replaces* the workspace atomically (brief §5–§6) rather than merely that
  a file downloaded successfully.

## Journeys explicitly deferred

- **Journey B — Guided Lesson** (Exercises checkpoint fail → pass → progress
  update): the Learning System's checkpoint flow already has deep
  integration-test coverage (`tests/runtime/learning/*`,
  `tests/runtime/validation/*`) exercising the exact same
  `runValidation`/scoring path a browser session would hit; a browser-level
  duplicate was judged lower priority than the two journeys above for this
  pass.
- **Journey C — Power Query** (apply a transformation, preview, Custom
  Column, output updates): also has deep headless coverage
  (`tests/runtime/query/**`, `tests/runtime/query/steps/**`).
- **Journey E — Destructive Integrity** (blocked delete, workspace survives):
  covered exhaustively at the runtime level
  (`tests/runtime/integrity/*.test.ts`) — the RESTRICT/CASCADE policy itself
  is what's being tested, and that logic is framework-free and already
  fully exercised without a browser.

None of these are untested — they're covered at the level that actually
proves correctness (the runtime), with the two chosen browser journeys
covering what only a real browser session can prove: that the UI wiring,
IndexedDB persistence, file download/upload, and native browser dialogs
(the import confirmation) actually work end to end. Adding B/C/E as browser
tests remains a reasonable next step if/when the E2E suite grows.

## Philosophy

Per brief §40: assertions target user-visible outcomes (headings, cell
titles, a rendered notice) and the absence of console/page errors — never
exact pixel coordinates or brittle CSS-class-only selectors beyond what's
needed to disambiguate (e.g. `.practice-project-card` to pick a gallery
card by its visible title).
