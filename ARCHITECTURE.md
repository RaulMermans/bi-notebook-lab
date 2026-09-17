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

## Sprint 1 implementation (Data Runtime)

The layers above are realized concretely as:

```text
components/notebook/   UI: ImportDataPanel, DataCellCard, Table{Preview,Schema,Profile}
runtime/notebook/      NotebookRuntime (pure) + useNotebookRuntime (React + persistence wiring)
runtime/data/          dataRuntime.ts — import orchestration, limits, error surfacing
lib/csv/, lib/excel/   File-format parsing (PapaParse, SheetJS) into a raw header/row grid
lib/profiling/         Type inference, value coercion, column profiling
lib/sample/            Deterministic seeded generator for the built-in retail dataset
domain/data.ts         DataType, DataColumn, DataTable, Dataset contracts
persistence/           IndexedDB notebook + dataset stores (idb-keyval)
```

`NotebookRuntime` holds no framework or persistence code — it is a plain,
synchronously-testable class (`addCell`/`removeCell`/`moveCell`/
`importDataset`/`removeDataset`/`updateCell`), matching the "keep BI
semantics outside React components" guardrail. `DataCell` is represented as
the existing `NotebookCell` with `kind: 'data'` and a `datasetId`, rather
than a separate parallel type, since the notebook already models all cell
kinds through one shape. See [`docs/DATA_RUNTIME.md`](./docs/DATA_RUNTIME.md)
for the full import/type-inference/persistence design.

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
