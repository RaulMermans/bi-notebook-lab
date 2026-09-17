# BI Notebook Lab

An interactive notebook for learning **business intelligence, data modeling and DAX-style analytical thinking by doing**.

The product is intentionally **not a Power BI clone**. The core mental model is closer to Jupyter:

```text
Dataset → Model → Calculated Column → Measure → Visual → Question → Test
```

Each concept is represented as an executable notebook cell. Learners build a solution progressively and receive immediate feedback on structure, calculations and reasoning.

## North Star

> Make invisible BI concepts visible, executable and testable.

Power BI is excellent for building reports, but it is not optimized as a learning environment. BI Notebook Lab focuses on the parts that beginners usually find hardest:

- table grain and keys
- star schemas
- relationships and filter propagation
- calculated columns vs measures
- row context vs filter context
- common DAX patterns
- debugging why a result is wrong

## Product surface

A notebook can contain:

- `MarkdownCell`
- `DataCell`
- `ModelCell`
- `CalculatedColumnCell`
- `MeasureCell`
- `VisualCell`
- `QuestionCell`
- `TestCell`

The first product milestone is not a dashboard builder. It is a **learning runtime** capable of executing and validating these cells.

## Repository status

This repository currently contains:

- product and architecture contracts
- notebook/cell domain types
- a sample beginner notebook
- a minimal React/Vite shell
- roadmap and validation design

The shell is intentionally thin. The next work should go into the execution model, not visual polish.

## Run locally

```bash
npm install
npm run dev
```

## Core documents

- [`PRODUCT.md`](./PRODUCT.md)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`ROADMAP.md`](./ROADMAP.md)
- [`docs/CELL_SPEC.md`](./docs/CELL_SPEC.md)
- [`docs/LEARNING_MODEL.md`](./docs/LEARNING_MODEL.md)
- [`docs/VALIDATION_ENGINE.md`](./docs/VALIDATION_ENGINE.md)

## Scope guardrail

Do **not** attempt to recreate Power BI Desktop, Power Query, Microsoft Fabric or full DAX compatibility.

The learning target is the smallest runtime that can faithfully teach the mental models used in real BI work.
