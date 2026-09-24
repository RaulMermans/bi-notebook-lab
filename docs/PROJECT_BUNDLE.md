# Portable Project Bundle (`.bilab.json`)

Sprint 16 Part A. A learner's work must not exist only inside IndexedDB — it
must be exportable, downloadable, storable in GitHub, shareable, and
importable back. This is a **learner/project format**, not a Lesson
Authoring format — AGENTS.md guardrail #8 keeps lessons as code-owned
`LessonDefinition` objects, and Practice Projects (`domain/practiceProject.ts`)
follow the identical pattern; neither is affected by this bundle format.

## Contract

`src/domain/bundle.ts` defines `BiLabProjectBundle`:

```ts
interface BiLabProjectBundle {
  format: 'bi-notebook-lab-project'
  schemaVersion: number
  metadata: { projectId; title; description?; createdAt; exportedAt; appVersion? }
  notebook: NotebookDocument
  datasets: Dataset[]   // raw imports only — see "What's excluded" below
  queries: QueryDefinition[]
  models: SemanticModel[]
}
```

Only `schemaVersion: 1` exists today.

## What's excluded

`QueryEvaluation`, `ValidationRun`, measure/calculated-column execution
results, Context Explorer analysis, visual execution output, and any other
runtime cache are never serialized — they are always recomputed after
import, exactly like every other derived value in this codebase (see
`NotebookRuntimeSnapshot`'s own `queryEvaluations` field, which is never
persisted to IndexedDB either).

A `Dataset` whose `source.type === 'query'` (a Power Query output) is also
excluded from `datasets` — it is re-derived from `queries` by
`buildSnapshotFromBundle` (`src/runtime/bundle/bundleCodec.ts`), the same
composition `NotebookRuntime`'s own query re-evaluation performs
internally, so it is never duplicated in the file.

## Stable identity

Every id (`Dataset`, `DataTable`, `DataColumn`, `Query`, `Model`,
`ModelTable`, `Relationship`, `CalculatedColumn`, `Measure`, `Visual`,
`NotebookCell`, `TestCell`) is preserved exactly as exported. Import never
regenerates an id — the reconstructed snapshot is the same reference graph
the exporting workspace had.

## Codec boundary (`src/runtime/bundle/bundleCodec.ts`)

- `exportProjectBundle(snapshot, options)` — pure, builds the bundle from a
  live `NotebookRuntimeSnapshot`.
- `parseProjectBundle`/structural checks, `migrateProjectBundle` (identity
  passthrough for v1 — the explicit loader boundary future schema versions
  hook into, instead of `if (bundle.schemaVersion === ...)` scattered across
  components), and `validateProjectBundle`-equivalent logic are all composed
  by one entry point: `loadProjectBundle(text): BundleLoadResult`.
- `loadProjectBundle` never throws and never touches IndexedDB — it is a
  pure parse-and-validate function. Every failure path returns a
  learner-readable `message` (never a raw `JSON.parse` error):
  - not JSON / wrong `format` → "This file is not a BI Notebook Lab
    project."
  - unsupported `schemaVersion` → "This project uses schema version N. This
    version of BI Notebook Lab supports version 1."
  - structurally incomplete → a plain "damaged or incomplete" message.
  - a workspace-integrity violation in the reconstructed snapshot → the
    specific `WorkspaceIntegrityIssue.reason` (e.g. `MeasureCell "AOV"
    references a measure that no longer exists in its model.`), reusing
    Sprint 15's `validateWorkspaceIntegrity` — never a generic failure.

## Import is atomic

`NotebookRuntime.importSnapshot(next)` (the validating counterpart to the
pre-existing `replaceAll`) only swaps the live snapshot if
`validateWorkspaceIntegrity` reports it clean. The `importProject` action in
`useNotebookRuntime.ts` calls the pure `loadProjectBundle` first — which
validates everything, including integrity, with zero side effects — and
only once that succeeds does it write anything to IndexedDB (every
dataset/model/query, then the notebook). If validation fails, nothing is
written and the active workspace is untouched. idb-keyval has no
transaction primitive, so this validate-before-write ordering *is* the
atomicity guarantee, not a database transaction — the same pattern every
other destructive `NotebookRuntime` mutation already follows via
`mutationImpact.ts` (docs/WORKSPACE_INTEGRITY.md).

## Import strategy: replace, never merge

Importing a bundle always replaces the active Free Lab workspace
("import as new project"). There is no merge-into-current-project option —
merging ids/models/queries/cells across two independent workspaces was
evaluated and deliberately rejected as unnecessary complexity for V1 (brief
Part A §6). The UI (`ProjectFileActions.tsx`) asks for confirmation before
overwriting local work when the current workspace is non-empty.

## Export determinism

`exportProjectBundle` reuses a stable `projectId`/`createdAt` across
repeated exports of the same project (persisted separately via
`persistence/notebookStore.ts`'s `ProjectMeta`, since `NotebookDocument`
itself has no home for those fields) — an unchanged project's `export →
import → export` round-trip is semantically equal except for `exportedAt`,
which is expected to differ on every export. See
`tests/runtime/bundle/bundleCodec.test.ts` for the round-trip test.

## What's still IndexedDB-only

The portable bundle is an import/export boundary, not a replacement for
IndexedDB. Everyday local persistence (autosave while working, the Learning
System's lesson/session/attempt history) continues exactly as before —
nothing about Sprint 16 changes how the Free Lab or a lesson attempt
persists between reloads.
