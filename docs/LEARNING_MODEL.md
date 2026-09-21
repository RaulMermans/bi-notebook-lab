# Learning Model

The product teaches BI through progressively exposed abstractions.

## Level 0 — Data shaping

Questions:
- Is this column the right type, or does it just look right?
- Which rows are duplicates, and which are legitimately repeated?
- What does a blank actually mean here?
- Should this transformation happen once, upstream, or every time someone
  builds a measure?

Sprint 12's Power Query layer (see
[`POWER_QUERY_RUNTIME.md`](./POWER_QUERY_RUNTIME.md) and
[`APPLIED_STEPS.md`](./APPLIED_STEPS.md)) is where these questions get
asked, before a table ever reaches Level 1. This is deliberately a distinct
level from Level 1's "what is the grain, which columns are keys" — Level 0
is about *cleaning and shaping* the data a learner was handed; Level 1 is
about *modeling* the data once it's trustworthy. A learner who tries to
build relationships on top of a text-formatted numeric key, or a table full
of duplicate rows, hits a wall at Level 1 that Level 0 exists to prevent.

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

## Visual Cells as concrete proof of these levels

The Sprint 7 Visual Cells (see [`VISUAL_CELLS.md`](./VISUAL_CELLS.md)) give
a learner a second, complementary way to check the same Level 4/5 questions
the Context Explorer answers diagnostically: instead of inspecting one
measure under one chosen filter, a KPI/Bar/Line/Table/Slicer combination
lets a learner *watch* a real number change as they pick a Country in a
Slicer, and compare it directly against what the Context Explorer already
showed for the same filter — the same underlying `evaluateMeasure` call
either way. Where the Context Explorer explains *why* a result changed, a
Visual Cell simply shows the result changing, which is closer to how a
learner will eventually use Power BI itself.

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
