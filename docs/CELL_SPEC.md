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
Creates a row-level expression.

Expected output:
- column definition
- preview values
- row-context trace

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
