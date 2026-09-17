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
`importDataset`/`removeDataset`/`updateCell`, plus the Sprint 2 model actions
below), matching the "keep BI semantics outside React components" guardrail.
See [`docs/DATA_RUNTIME.md`](./docs/DATA_RUNTIME.md) for the full
import/type-inference/persistence design.

## Sprint 2 implementation (Model Runtime)

```text
components/notebook/ModelCellCard.tsx   UI: collapsed summary + expanded canvas/forms
components/notebook/model/              ModelCanvas (React Flow), ModelTableNode,
                                         RelationshipEdge, TableRegistrationPanel,
                                         RelationshipForm, ModelHealthSummary
runtime/model/modelRuntime.ts           Pure functions: create/add/remove table,
                                         create/remove relationship, toggle active,
                                         move table, validateRelationship
runtime/model/graphAnalysis.ts          Cycle detection, ambiguous-path detection,
                                         isolated tables, fact/dimension inference
runtime/model/columnCompatibility.ts    Relationship column type-compatibility matrix
persistence/modelStore.ts               IndexedDB model store, keyed by model.id
domain/model.ts                         TableRef, ColumnRef, ModelTable, Relationship,
                                         SemanticModel, diagnostic contracts
```

`NotebookCell` (in `domain/notebook.ts`) became a discriminated union —
`DataCell | ModelCell | GenericNotebookCell` — so a `DataCell` without a
`datasetId` or a `ModelCell` without a `modelId` cannot be represented.
`modelRuntime.ts` is deliberately a set of pure `(model, ...) => model`
functions rather than a second stateful class: `NotebookRuntime` is the only
`useSyncExternalStore` source the UI subscribes to, and it already owns both
`datasets` and (now) `models`, so its model-related methods are thin
wrappers around the pure functions. See
[`docs/MODEL_RUNTIME.md`](./docs/MODEL_RUNTIME.md) for the full
relationship-validation, graph-diagnostic, and persistence design.

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
