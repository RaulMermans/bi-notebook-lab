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

## Sprint 3 implementation (Expression Engine + Calculated Columns)

```text
expression/               Framework-free expression engine, reused by
                           calculated columns now and measures in Sprint 4:
  ast.ts                   Expression AST node contracts + source spans
  lexer.ts, parser.ts      Hand-written tokenizer/parser (no eval/new Function)
  diagnostics.ts           ExpressionDiagnostic contract + codes
  binder.ts                Resolves AST names -> stable ColumnRefs/relationships
  relatedLookup.ts          RELATED relationship resolution + indexed lookup
  evaluator.ts             Executes a bound expression against a RowContext
  rowContext.ts            RowContext contract
  trace.ts                 ExecutionTraceNode contract

runtime/calculatedColumn/  calculatedColumnRuntime.ts: create/update/remove/
                           evaluate/validate a CalculatedColumn (pure
                           functions, same shape as runtime/model/modelRuntime.ts)

components/notebook/       CalculatedColumnCellCard.tsx, CreateCalculatedColumnPanel.tsx
components/notebook/
  calculatedColumn/         ExpressionEditor, CalculatedColumnPreview,
                            RowContextVisualizer

domain/model.ts             CalculatedColumn + SemanticModel.calculatedColumns
domain/notebook.ts           CalculatedColumnCell (real cell kind, not generic)
```

`CalculatedColumn` definitions persist inside `SemanticModel` — no new
persistence store was needed, since `modelStore.ts` already round-trips
the whole model. Execution output (computed values, row errors, traces)
is never persisted; it's recomputed from current model/dataset state on
every render, mirroring how `graphAnalysis.ts#validateModel` is
recomputed rather than cached. See
[`docs/EXPRESSION_ENGINE.md`](./docs/EXPRESSION_ENGINE.md) and
[`docs/CALCULATED_COLUMNS.md`](./docs/CALCULATED_COLUMNS.md) for the full
design.

## Expression strategy

Do not implement full DAX.

Sprint 3 implements a constrained scalar grammar: numeric/string/boolean
literals, parentheses, `+ - * /`, unary `-`, `Table[Column]`/`[Column]`
references, and `RELATED(Table[Column])` — see
[`docs/EXPRESSION_ENGINE.md`](./docs/EXPRESSION_ENGINE.md) for the exact
grammar ("BI Notebook DAX Subset — Sprint 3").

Sprint 4 (Measures) is expected to extend the *same* parser/AST/binder/
diagnostics/trace modules with aggregation and filter-context semantics
(`SUM`, `COUNTROWS`, `DISTINCTCOUNT`, `AVERAGE`, `DIVIDE`, `CALCULATE`,
simple boolean filters) rather than introducing a second expression
system — if it can't be reused for measures, Sprint 3 built the wrong
abstraction.

The language may look DAX-like, but semantics and supported functions must be explicit.
