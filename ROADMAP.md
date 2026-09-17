# Roadmap

## Phase 0 — Product Foundation

**Goal:** freeze the product concept before building complexity.

- notebook/cell contracts
- lesson format
- semantic-model contracts
- execution result contracts
- validation philosophy
- sample lesson
- minimal notebook UI shell

**Exit:** repository expresses one coherent product direction.

---

## Phase 1 — Data Runtime ✅ complete

- CSV import
- XLSX import (multi-sheet)
- schema/type inference
- null/duplicate inspection (profiling)
- table preview
- grain/key hints (potential-key detection)
- bundled lesson dataset (built-in Retail sample: Customers/Products/Sales/Calendar)
- local persistence (IndexedDB) across reloads

**Exit:** DataCell can load, inspect and persist tables. See
[`docs/DATA_RUNTIME.md`](./docs/DATA_RUNTIME.md) for implementation details.

---

## Phase 2 — Model Runtime

- semantic model state
- create/delete relationships
- one-to-many relationships
- cardinality validation
- active relationship rules
- star-schema exercise checks
- simple model visualization

**Exit:** ModelCell can build and validate a usable semantic model.

---

## Phase 3 — Calculated Columns

- row-level expression evaluator
- arithmetic
- field references
- `RELATED`
- preview computed values
- row-context visualization

**Exit:** learner can create and debug calculated columns.

---

## Phase 4 — Measures

- measure registry
- aggregation functions
- measure references
- filter context
- relationship propagation
- basic `CALCULATE`
- execution trace

**Exit:** learner can create useful measures and see why they evaluate as they do.

---

## Phase 5 — Validation Engine

- expected model assertions
- expected numeric results
- tolerance rules
- semantic expression checks
- partial credit
- feedback messages
- notebook score

**Exit:** exercises can be graded automatically without exact-string matching.

---

## Phase 6 — Context Visualizer

- current filter context panel
- row context panel
- relationship propagation trace
- measure execution trace
- before/after context comparison

**Exit:** hidden BI mechanics become visually understandable.

---

## Phase 7 — Visual Cells

- table
- KPI card
- bar chart
- line chart
- field mapping
- filters/slicers at lesson level

**Exit:** learners can verify model/measure behavior through simple visuals.

---

## Phase 8 — Learning System

- lesson catalog
- difficulty levels
- progress
- hints
- reset/checkpoint
- solution reveal
- exercise history

**Exit:** product works as a repeatable training environment.

---

## Phase 9 — Authoring

- lesson author schema
- exercise builder
- dataset packaging
- reusable validation rules
- import/export lesson bundles

**Exit:** new lessons can be created without changing product code.

---

## Later, only if validated

- richer DAX subset
- custom datasets
- shareable notebooks
- desktop wrapper
- AI tutor grounded in execution traces
- Power BI-flavored interview challenges
