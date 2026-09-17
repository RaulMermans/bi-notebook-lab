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

Sprint 1 (Data Runtime) and Sprint 2 (Semantic Model Runtime) are complete.
This repository now contains:

- product and architecture contracts
- notebook/cell domain types as a discriminated union, including functional
  `DataCell` and `ModelCell` kinds
- a working data import pipeline: CSV, Excel (multi-sheet), and a built-in
  sample retail dataset
- deterministic type inference and column profiling
- a semantic model runtime: 1:* relationships with real validation (type
  compatibility, one-side uniqueness, duplicate/self-relationship checks,
  unmatched-foreign-key warnings), cycle/ambiguous-path graph diagnostics,
  and topology-based fact/dimension inference
- a visual model canvas (React Flow) that renders and repositions the model
  — the model itself, not the canvas, is the source of truth
- local persistence (IndexedDB) so a notebook, its datasets, and its
  semantic models all survive a reload

Calculated columns, measures, DAX and filter-context execution are **not**
implemented yet — that starts in Sprint 3.

## Run locally

```bash
npm install
npm run dev
```

Then either import a `.csv`/`.xlsx` file or click **Load Retail Dataset** to
try the built-in sample. Add a Model cell to select tables into a semantic
model and build a star schema (Customers/Products/Calendar 1:* Sales).

## Core documents

- [`PRODUCT.md`](./PRODUCT.md)
- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`ROADMAP.md`](./ROADMAP.md)
- [`docs/CELL_SPEC.md`](./docs/CELL_SPEC.md)
- [`docs/LEARNING_MODEL.md`](./docs/LEARNING_MODEL.md)
- [`docs/VALIDATION_ENGINE.md`](./docs/VALIDATION_ENGINE.md)
- [`docs/DATA_RUNTIME.md`](./docs/DATA_RUNTIME.md)
- [`docs/MODEL_RUNTIME.md`](./docs/MODEL_RUNTIME.md)

## Scope guardrail

Do **not** attempt to recreate Power BI Desktop, Power Query, Microsoft Fabric or full DAX compatibility.

The learning target is the smallest runtime that can faithfully teach the mental models used in real BI work.
