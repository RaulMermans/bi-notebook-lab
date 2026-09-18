# Cell Specification

Cells are ordered executable units inside a notebook.

## Shared contract

Every cell has:

- `id`
- `kind`
- `title`
- optional learner-facing `prompt`
- optional `source`
- execution status
- metadata

Later runtime versions should add explicit:

- dependencies
- inputs
- outputs
- validation rules
- execution errors
- pedagogical feedback

## Core cell types

### MarkdownCell
Conceptual explanation or scenario context. No execution.

### DataCell
Loads or exposes tables and schema information.

Expected output:
- table registry additions
- inferred schema
- data-quality summary

### ModelCell
Allows creation of table relationships.

Expected output:
- semantic-model snapshot
- structural validation

Since Sprint 6, an expanded `ModelCell` also offers a `Context Explorer` tab
alongside `Model` (`components/context/ContextExplorer.tsx`) — a reusable
surface for exploring how any measure in the model responds to a learner-
chosen `FilterContext`. See
[`../docs/CONTEXT_VISUALIZER.md`](../docs/CONTEXT_VISUALIZER.md). This is
presentation only: it does not change `ModelCell`'s domain contract or add
persisted state.

### CalculatedColumnCell
Creates a row-level expression. Backed by a real domain/execution contract
since Sprint 3 — see [`../docs/CALCULATED_COLUMNS.md`](../docs/CALCULATED_COLUMNS.md)
and [`../docs/EXPRESSION_ENGINE.md`](../docs/EXPRESSION_ENGINE.md).

Contract (`src/domain/notebook.ts`):
```ts
interface CalculatedColumnCell extends BaseNotebookCell {
  kind: 'calculated-column'
  modelId: string
  calculatedColumnId: string
}
```
Both ids are always required — the cell stores references only; the
`CalculatedColumn` definition (name, expression, target table, inferred
type) lives in `SemanticModel.calculatedColumns`. There is no draft cell:
an expression that fails to parse or bind stays in UI-only editor state
until it validates.

Expected output:
- column definition (persisted)
- preview values (first ~100 rows, recomputed from current model/dataset
  state — never persisted)
- row-context trace (real runtime execution trace, not a UI-reconstructed
  explanation)

### MeasureCell
Creates a context-sensitive aggregation. Backed by a real domain/execution
contract since Sprint 4 — see [`../docs/MEASURES.md`](../docs/MEASURES.md)
and [`../docs/FILTER_CONTEXT.md`](../docs/FILTER_CONTEXT.md).

Contract (`src/domain/notebook.ts`):
```ts
interface MeasureCell extends BaseNotebookCell {
  kind: 'measure'
  modelId: string
  measureId: string
}
```
Both ids are always required — the cell stores references only; the
`Measure` definition (name, expression, home table, inferred type) lives
in `SemanticModel.measures`. There is no draft cell, mirroring
`CalculatedColumnCell`.

Expected output:
- measure definition (persisted)
- scalar result, both unfiltered and under a learner-editable
  `FilterContext` (never persisted — recomputed on every evaluation)
- execution trace (filter context, relationship propagation, aggregation
  and measure-reference nodes — real runtime execution trace, not a
  UI-reconstructed explanation)

### VisualCell
Maps fields/measures into a simple visual (KPI/Table/Bar/Line/Slicer) for
validation and understanding. Backed by a real domain/execution contract
since Sprint 7 — see [`../docs/VISUAL_CELLS.md`](../docs/VISUAL_CELLS.md).

Contract (`src/domain/notebook.ts`):
```ts
interface VisualCell extends BaseNotebookCell {
  kind: 'visual'
  modelId: string
  visual: VisualSpec
}
```
`visual` was removed from `GenericCellKind` and promoted to a fully typed
cell. Unlike `CalculatedColumnCell`/`MeasureCell` there is no create-time
validation pass — a `VisualSpec` is authored field-mapping data (like a
`TestCell`'s `ValidationSpec`), so a `VisualCell` always exists once
created; a mapping that later goes stale (a deleted measure/column) fails
safely at render time instead of being blocked from creation.

Expected output:
- the visual's field mapping (persisted on the cell)
- for KPI/Table/Bar/Line: a scalar or `VisualQueryResult` produced entirely
  by `runtime/visual/*` calling the real Sprint 4 `evaluateMeasure` under
  the shared notebook/slicer `FilterContext` (never persisted — recomputed
  on every render)
- for Slicer: real form controls over the column's real distinct values,
  emitting a canonical `ColumnFilter` into the shared, transient
  `NotebookVisualContext` (never persisted — resets to "All" on reload)

### QuestionCell
Captures conceptual or analytical learner input.

### TestCell
Runs one or more validation assertions against current notebook state. Backed
by a real domain/execution contract since Sprint 5 — see
[`../docs/VALIDATION_ENGINE.md`](../docs/VALIDATION_ENGINE.md).

Contract (`src/domain/notebook.ts`):
```ts
interface TestCell extends BaseNotebookCell {
  kind: 'test'
  modelId: string
  prompt?: string
  validation: ValidationSpec
}
```
`test` was removed from `GenericCellKind` — like `CalculatedColumnCell`/
`MeasureCell`, it's now a fully typed cell. `modelId` and `validation` are
always required (there is no draft `TestCell`), but unlike calculated
columns/measures a `ValidationSpec` needs no create-time validation pass —
it's authored data (a rule list + expected values), not an expression that
can fail to parse/bind. `runtime/notebook/notebookRuntime.ts#createTestCell`
appends the cell directly.

Expected output:
- a `ValidationRun` (score, per-rule status, feedback) — computed on demand
  by `runtime/validation/validationEngine.ts#runValidation`, **never
  persisted** and never trusted once the model's fingerprint no longer
  matches the run that produced it (see `docs/VALIDATION_ENGINE.md`
  "Staleness").
