# Learning Model

The product teaches BI through progressively exposed abstractions.

## Level 1 — Data

Questions:
- What is one row?
- What is the grain?
- Which columns are keys?
- Which table is a fact vs dimension?

## Level 2 — Model

Questions:
- Which tables should relate?
- In which direction does filtering propagate?
- What cardinality is valid?

## Level 3 — Row calculations

Questions:
- What can be calculated for each row?
- When is a calculated column appropriate?
- What does `RELATED` mean?

## Level 4 — Measures

Questions:
- What should be calculated at query time?
- Which filters are currently active?
- How does a measure change by visual context?

## Level 5 — Context transformation

Questions:
- What does `CALCULATE` change?
- Which filters are introduced or removed?
- How do relationships change the effective row set?

## Level 6 — Analytical design

Questions:
- Is the metric business-correct?
- Is the model robust?
- Is the chosen measure reusable?

The UI should expose these layers explicitly instead of collapsing them behind a report canvas.

## Context Explorer as a Level 4/5 teaching surface

The Sprint 6 Context Explorer (see
[`CONTEXT_VISUALIZER.md`](./CONTEXT_VISUALIZER.md)) is where Level 4
("which filters are currently active? how does a measure change by visual
context?") and Level 5 ("how do relationships change the effective row
set?") questions get a direct, inspectable answer: picking a measure and a
filter shows exactly which tables are directly filtered vs. propagated-into,
in which direction, and what the measure's baseline vs. current result is —
using the real Sprint 4 runtime, never a reconstructed explanation.

## Validation as feedback on these levels

The Sprint 5 validation engine (see
[`VALIDATION_ENGINE.md`](./VALIDATION_ENGINE.md)) grades a learner against
these same layers rather than a single pass/fail: a `relationship`/
`model-health` rule failure is Level 2 feedback ("which tables should
relate?"), a `calculated-column-result` failure is Level 3 ("what does
`RELATED` mean, and did you use it right?"), and a `measure-result` rule that
passes unfiltered but fails under a filter context is Level 4/5 feedback
("does your measure respond to the current filters?") — pointing the learner
back at the specific mental model they haven't yet gotten right, instead of
just reporting a score.
