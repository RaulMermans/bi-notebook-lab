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
Creates a context-sensitive aggregation.

Expected output:
- measure definition
- scalar result under a given filter context
- execution trace

### VisualCell
Maps fields/measures into a simple visual for validation and understanding.

### QuestionCell
Captures conceptual or analytical learner input.

### TestCell
Runs one or more validation assertions against current notebook state.
