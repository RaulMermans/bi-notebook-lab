# Product Contract

## Problem

People learning Power BI often understand the interface before they understand the model underneath it. They can click through charts but struggle to explain:

- why a relationship is correct or incorrect;
- why a calculated column behaves differently from a measure;
- how filters propagate;
- why a DAX expression changes under different contexts;
- whether their model is structurally sound.

## Product

BI Notebook Lab is an interactive notebook where the learner solves BI tasks in small executable cells.

A lesson is an ordered sequence of actions and explanations rather than an empty report canvas.

## Primary user

A beginner-to-intermediate analyst learning Power BI concepts through realistic datasets and exercises.

## Core loop

```text
Read task
  ↓
Inspect data
  ↓
Build model
  ↓
Write column / measure
  ↓
Run cell
  ↓
See result + context
  ↓
Receive validation
  ↓
Continue
```

## Product principles

1. **Teach mental models, not menu locations.**
2. **Every meaningful learner action must be inspectable.**
3. **Validation should test semantics, not exact text.**
4. **Wrong answers should explain why they are wrong.**
5. **Use realistic business scenarios.**
6. **Do not hide filter propagation. Visualize it.**
7. **Avoid full Power BI parity.**

## V1 capabilities

V1 is complete when a learner can:

- open a lesson notebook;
- inspect 3–5 local tables;
- create one-to-many relationships;
- create calculated columns;
- create measures using a constrained function set;
- run expressions;
- see filter context;
- validate expected outputs and model structure;
- complete a scored exercise.

## Explicit non-goals for V1

- Power Query / M
- DirectQuery
- Power BI Service
- gateways
- Fabric
- RLS
- arbitrary custom visuals
- full DAX grammar
- enterprise connectors
- pixel-perfect dashboard authoring

> This list froze the *original* V1 milestone. The product has since grown
> well past it (CALCULATE, iterators, time intelligence, advanced
> relationships, and — as of Sprint 12 — Power Query's Applied Steps
> workflow are all implemented; see ROADMAP.md for what has actually
> shipped). "Power Query / M" above meant no pre-model transformation layer
> at all; Sprint 12 added one, but strictly through typed Applied Steps —
> **not** an arbitrary M parser/interpreter, query folding, or the Advanced
> Editor. See [`docs/POWER_QUERY_RUNTIME.md`](./docs/POWER_QUERY_RUNTIME.md)
> "M-language boundary". DirectQuery, Power BI Service, gateways, Fabric,
> RLS, enterprise connectors, and full DAX grammar remain genuinely out of
> scope.
