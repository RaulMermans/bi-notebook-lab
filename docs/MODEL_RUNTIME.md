# Model Runtime (Sprint 2)

This document describes the semantic-model layer added in Sprint 2: turning
imported tables into a real, persisted `SemanticModel` with 1:* relationships,
validation, and topology diagnostics.

## Pipeline

```text
DataCell(s) already in the notebook (Sprint 1)
  → ModelCell created (NotebookRuntime.createModelCell)
  → learner adds tables to the model (addTableToModel)
  → learner creates relationships via a form (createRelationship)
      → runtime/model/modelRuntime.ts: validateRelationship (blocking errors +
        non-blocking warnings) → applies the relationship only if no errors
  → runtime/model/graphAnalysis.ts: validateModel (cycles, ambiguous paths,
    isolated tables, fact/dimension inference) — recomputed on every render
  → persistence/modelStore.ts (IndexedDB, one entry per model, keyed by id)
```

## Stable references, not names

`Dataset.tables` (Sprint 1) already keys tables/columns by generated id, not
name. Sprint 2 never introduces a `"Table.Column"` string identifier as
canonical state — every reference is a struct of ids:

```ts
interface TableRef { datasetId: string; tableId: string }
interface ColumnRef { datasetId: string; tableId: string; columnId: string }
```

All resolution goes through `resolveTableRef` / `resolveColumnRef` in
`runtime/model/modelRuntime.ts`, which look up `dataset.tables.find(t => t.id
=== tableId)` and `table.columns.find(c => c.id === columnId)` — never
`primaryTable()`. This keeps the model forward-compatible with a future
multi-table `Dataset` even though Sprint 1 only ever produces one table per
dataset today. Row lookups then use `column.name` as the key into
`DataTable.rows`, since rows are stored keyed by column name (a Sprint 1
choice this layer doesn't change).

## Domain contracts (`src/domain/model.ts`)

```ts
interface ModelTable { id: string; datasetId: string; tableId: string; position?: {x:number;y:number} }
interface Relationship {
  id: string
  one: ColumnRef
  many: ColumnRef
  cardinality: 'one-to-many'
  crossFilterDirection: 'single'
  active: boolean
  createdAt: string
}
interface SemanticModel { id: string; name: string; tables: ModelTable[]; relationships: Relationship[]; createdAt: string; updatedAt: string }
```

Only `one-to-many` cardinality and `single` cross-filter direction exist —
many-to-many and bidirectional filtering are out of scope for this sprint (see
"Known limitations").

## Notebook cell contract

`NotebookCell` (in `src/domain/notebook.ts`) is now a discriminated union
instead of one loose interface:

```ts
interface DataCell extends BaseNotebookCell { kind: 'data'; datasetId: string }
interface ModelCell extends BaseNotebookCell { kind: 'model'; modelId: string }
type GenericNotebookCell = BaseNotebookCell & { kind: GenericCellKind; prompt?; source?; meta? } // markdown/calculated-column/measure/visual/question/test
type NotebookCell = DataCell | ModelCell | GenericNotebookCell
```

`datasetId`/`modelId` are required on their respective cell kinds — a
`DataCell` without a dataset, or a `ModelCell` without a model, cannot be
represented. `NotebookRuntime.updateCell` is restricted to patching generic
fields (`title`/`status`/`prompt`/`source`/`meta`); changing `kind`,
`datasetId`, or `modelId` always goes through a dedicated action
(`importDataset`, `createModelCell`, etc.) that constructs a complete, valid
cell rather than patching a discriminant field in place.

## `modelRuntime.ts`: pure functions, not a class

Unlike `NotebookRuntime` (a stateful pub/sub class, because it's the
`useSyncExternalStore` source React subscribes to), `runtime/model/
modelRuntime.ts` is a set of pure `(model, ...) => model` functions:
`createModel`, `addTable`, `removeTable`, `moveTable`, `createRelationship`,
`removeRelationship`, `setRelationshipActive`, plus the read-only
`validateRelationship`/`resolveTableRef`/`resolveColumnRef`. `NotebookRuntime`
is the single owner of both `datasets` and `models`, and its model-related
methods (`addTableToModel`, `createRelationship`, ...) are thin wrappers: look
up the model, call the pure function, write the result back, notify
subscribers. This mirrors how dataset logic (`buildDataTable`,
`profileColumn`) already lives in plain functions rather than a second store.

`createRelationship` never partially applies a relationship: if
`validateRelationship` returns any `severity: 'error'` diagnostic, the model
is returned unchanged and the diagnostics are handed back to the caller (the
UI renders them either way, so a rejected attempt still explains why).

## Relationship validation rules

`validateRelationship(model, candidate, datasets)` returns
`RelationshipDiagnostic[]` (`{ severity, code, message, details? }`) and runs,
in order:

1. **`MISSING_REFERENCE`** (error) — either column fails to resolve against
   the dataset registry. Short-circuits the remaining checks.
2. **`SELF_RELATIONSHIP`** (error) — both sides name the same
   `datasetId`/`tableId`. Short-circuits the remaining checks.
3. **`COLUMN_TYPE_MISMATCH`** (error) — see the compatibility matrix below.
4. **`ONE_SIDE_NOT_UNIQUE`** (error) — the "1"-side column's non-null values,
   read from the actual imported rows (not profiling hints), contain a
   duplicate.
5. **`DUPLICATE_RELATIONSHIP`** (error) — an existing relationship already
   connects the same two physical columns, in either direction (A→B and B→A
   both count as the same duplicate pair).
6. **`UNMATCHED_FOREIGN_KEYS`** (warning, non-blocking) — some non-null
   many-side values don't appear in the one-side's value set. Reported with
   `details: { matchRate, unmatchedCount, totalCount }` so the UI can show,
   e.g., "3 of 1500 values ... (match rate 99.8%)". This never blocks
   creation — it's meant as BI-education feedback, not a hard error.

### Column type compatibility

| one \ many | integer | decimal | string | boolean | date | datetime |
|---|---|---|---|---|---|---|
| integer  | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| decimal  | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| string   | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| boolean  | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| date     | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| datetime | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |

`null`/`unknown` are never compatible with anything, including each other.
Same-type is always compatible; `integer`/`decimal` and `date`/`datetime` are
treated as the same family, matching the widening rules `lib/profiling/
inferType.ts` already uses during import.

## Graph diagnostics (`runtime/model/graphAnalysis.ts`)

`validateModel(model, datasets)` returns model-level `ModelDiagnostic[]`:

- **`ISOLATED_TABLE`** (warning) — a table with zero relationships (active or
  inactive) touching it.
- **`ACTIVE_CYCLE`** (error) — a cycle exists in the **directed** graph where
  each active relationship is an edge `many → one` (a fact-like row "looks
  up" its dimension). Detected with a standard white/gray/black DFS; the
  cycle's table sequence is included in `details.path`.
- **`AMBIGUOUS_PATH`** (warning) — more than one simple path connects two
  tables in the same active-relationship edge set treated as **undirected**
  (a diamond — A→B, A→C, B→C — gives B two ways to reach A). Path search stops
  as soon as a second distinct path is found; it doesn't enumerate further.
- **`STAR_SCHEMA_VALID`** (info) / **`MULTIPLE_FACT_TABLES`** (warning) /
  **`DIMENSION_ON_MANY_SIDE`** (warning) — see fact/dimension inference below.

Only **active** relationships feed the cycle and ambiguous-path graphs —
toggling a relationship inactive removes it from both checks immediately,
without deleting it from the model.

## Fact/dimension inference (topology only, never by name)

For each `ModelTable`, count how many **active** relationships place it on
the "1" side (`oneSideCount`) vs. the "many" side (`manySideCount`):

- `manySideCount > 0 && oneSideCount === 0` → **fact-like**.
- `oneSideCount > 0 && manySideCount === 0` → **dimension-like**.
- Both `> 0` → **mixed role**, reported as `DIMENSION_ON_MANY_SIDE` ("check
  the relationship direction").

Exactly one fact-like table with ≥1 dimension-like tables and no blocking
errors produces the `STAR_SCHEMA_VALID` info diagnostic ("Sales looks like
the fact table, filtered by N dimension tables ..."). More than one fact-like
table produces `MULTIPLE_FACT_TABLES` as a warning to double-check the model.

## Active relationships

`Relationship.active` toggles independently of everything else via
`setRelationshipActive`. Inactive relationships stay in the model (visible,
dashed on the canvas) but are excluded from `ACTIVE_CYCLE`/`AMBIGUOUS_PATH`/
fact-dimension analysis. This sprint does not implement `USERELATIONSHIP` or
any measure/filter-context semantics — the flag exists purely as model state
for Sprint 3+ to consume later.

## Persistence

`persistence/modelStore.ts` mirrors `notebookStore.ts`'s dataset store: a
dedicated IndexedDB store (`bi-notebook-lab-models`), one entry per
`SemanticModel` keyed by `model.id`. A `ModelCell` persists only `modelId` —
never the model body. `NotebookRuntimeSnapshot` gained a `models: Record<string,
SemanticModel>` map alongside `datasets`; `useNotebookRuntime`'s hydration
effect loads both in parallel (`Promise.all([loadDatasets, loadModels])`)
using the cells' discriminated `kind` to collect the right ids. Every model
action (`addTableToModel`, `createRelationship`, `moveModelTable`, ...) saves
the whole updated model back to IndexedDB immediately after mutating runtime
state — the same explicit-save-per-action pattern Sprint 1 uses for datasets,
rather than autosaving on every render.

## Model canvas

`components/notebook/model/ModelCanvas.tsx` renders the model with
`@xyflow/react`. The `SemanticModel` is always the source of truth: nodes and
edges are derived fresh from it on every change. The canvas keeps a small
piece of local React state only so a table can show a live drag preview
between renders; the only write path back to the model is
`onNodeDragStop`, which calls `moveModelTable` (not `onNodeDrag`, so dragging
doesn't write to IndexedDB on every pointer-move frame).

## Sprint 10 addendum

`SemanticModel` gained a plural `dateTables: DateTableDefinition[]` field —
a Date Table is an explicit, learner-driven marking
(`runtime/dateTable/dateTableRuntime.ts`'s `markDateTable`/
`unmarkDateTable`, validate-then-apply exactly like `createRelationship`
above), never inferred from a column's data type. `hydrateSemanticModel()`
defaults it to `[]` for pre-Sprint-10 models, and `removeTable()` also
drops a removed table's `DateTableDefinition` so no dangling metadata can
survive. See [`docs/DATE_TABLES.md`](./DATE_TABLES.md).

## Known limitations

- Only `one-to-many` cardinality and single-direction cross-filtering are
  supported — no many-to-many, no bidirectional filters (explicitly out of
  scope for this sprint).
- Relationship creation is form-based (table/column selects); there is no
  drag-column-to-column gesture on the canvas.
- Ambiguous-path detection stops at the second distinct path found between a
  pair of tables — it reports the fact, not an exact path count.
- No calculated columns, measures, DAX, or filter-context execution — the
  `active` flag and stable references exist so Sprint 3+ has something to
  build on, but nothing here evaluates a formula.
