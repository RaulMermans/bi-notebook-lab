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
