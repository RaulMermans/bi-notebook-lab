# Architecture

## High-level model

```text
┌────────────────────────────────────────────────────────────┐
│                       Notebook UI                          │
│                                                            │
│  Data │ Model │ Column │ Measure │ Visual │ Question/Test │
└──────────────────────────────┬─────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────┐
│                     Notebook Runtime                       │
│  cell ordering · dependencies · execution state · outputs │
└──────────────┬───────────────────┬─────────────────────────┘
               │                   │
               ▼                   ▼
┌──────────────────────┐   ┌──────────────────────────┐
│   BI Semantic Core   │   │    Validation Engine     │
│                      │   │                          │
│ tables               │   │ structural checks        │
│ columns              │   │ numeric/output checks    │
│ relationships        │   │ semantic equivalence     │
│ filter context       │   │ teaching feedback        │
│ expressions          │   │ scoring                  │
└──────────┬───────────┘   └──────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────┐
│                      Local Data Layer                      │
│            CSV / XLSX / bundled exercise datasets         │
└────────────────────────────────────────────────────────────┘
```

## Architectural rule

The UI must never become the source of truth for BI semantics.

All data-model logic lives in the semantic core so the same model can later power:

- notebook execution;
- automated grading;
- context visualizations;
- headless tests;
- saved lessons.

## Major packages/modules

### `domain`
Canonical contracts for notebooks, cells, datasets, models, measures and execution results.

### `runtime`
Executes notebook cells in dependency order and stores outputs.

### `semantic-core`
Represents tables, relationships, row context, filter context and expression evaluation.

### `validation`
Compares learner work against lesson expectations without relying on string equality.

### `lessons`
Portable lesson definitions: datasets, prompts, expected semantics and tests.

### `ui`
Notebook editor and visual explanations. It consumes domain/runtime contracts; it does not implement BI logic.

## Persistence

V1 should be local-first:

- lesson definitions: JSON/TypeScript fixtures
- learner notebooks: browser storage / local files
- datasets: bundled CSV/XLSX or user-imported files

A database is not required for the first usable version.

## Expression strategy

Do not implement full DAX initially.

Start with a constrained grammar supporting concepts needed for foundational exercises, for example:

- `SUM`
- `COUNT`
- `COUNTROWS`
- `DISTINCTCOUNT`
- `AVERAGE`
- `DIVIDE`
- `RELATED`
- `CALCULATE`
- simple boolean filters
- arithmetic

The language may look DAX-like, but semantics and supported functions must be explicit.
