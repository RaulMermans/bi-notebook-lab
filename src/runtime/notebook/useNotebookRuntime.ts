import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CalculatedColumnCell, MeasureCell, ModelCell, NotebookCell, NotebookDocument, QueryCell, TestCell } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import type { ColumnRef, TableRef } from '../../domain/model'
import type { ValidationSpec } from '../../domain/validation'
import type { VisualSpec } from '../../domain/visual'
import { deleteDataset, loadDatasets, loadNotebook, saveDataset, saveNotebook } from '../../persistence/notebookStore'
import { deleteModel, loadModels, saveModel } from '../../persistence/modelStore'
import { deleteQuery as deleteQueryRecord, loadQueries, saveQuery } from '../../persistence/queryStore'
import type { CalculatedColumnInput } from '../calculatedColumn/calculatedColumnRuntime'
import type { MeasureInput } from '../measure/measureRuntime'
import type { RelationshipConfigInput } from '../model/modelRuntime'
import type { NewStepInput } from '../query/queryStepFactory'
import type { NotebookRuntimeSnapshot } from './notebookRuntime'
import type { DeleteQueryResult } from './notebookRuntime'
import { NotebookRuntime, emptyNotebook } from './notebookRuntime'

export type HydrationStatus = 'loading' | 'ready'

/**
 * How a `useNotebookRuntime` instance loads/saves its `NotebookDocument`.
 * Defaults to the Free Lab's single fixed-key store (`notebookStore.ts`).
 * The Learning System passes a lesson-scoped adapter instead
 * (`persistence/learningStore.ts`) so a lesson's notebook is stored under
 * its own key rather than overwriting the Free Lab notebook — see
 * docs/LEARNING_SYSTEM.md "Free Lab boundary".
 */
export interface NotebookDocumentPersistence {
  load(): Promise<NotebookDocument | undefined>
  save(notebook: NotebookDocument): Promise<void>
}

const freeLabPersistence: NotebookDocumentPersistence = { load: loadNotebook, save: saveNotebook }

export interface UseNotebookRuntimeOptions {
  persistence?: NotebookDocumentPersistence
  /**
   * Produces the full starting snapshot (notebook + datasets + models) used
   * the first time this notebook is opened (`persistence.load()` returns
   * `undefined`). Defaults to an empty Free Lab notebook. A lesson passes
   * its `BuiltInLesson.initialize()` here — the resulting datasets/models
   * are seeded into the shared dataset/model stores exactly once, the same
   * way importing a dataset or creating a model in the Free Lab would.
   */
  createInitialSnapshot?: () => InitialNotebookSnapshot
}

export type InitialNotebookSnapshot = Pick<NotebookRuntimeSnapshot, 'notebook' | 'datasets' | 'models'> & Partial<Pick<NotebookRuntimeSnapshot, 'queries'>>

/**
 * Wires the framework-free NotebookRuntime to React state and to
 * IndexedDB persistence. Hydrates once on mount, then keeps the persisted
 * notebook document in sync with every structural change. Datasets and
 * models are saved/deleted explicitly at the point of the action rather
 * than on every snapshot change, since their payloads shouldn't be
 * rewritten on unrelated notebook edits.
 */
export function useNotebookRuntime(options: UseNotebookRuntimeOptions = {}) {
  const persistence = options.persistence ?? freeLabPersistence
  const createInitialSnapshot: () => InitialNotebookSnapshot =
    options.createInitialSnapshot ?? (() => ({ notebook: emptyNotebook('Retail Foundations'), datasets: {}, models: {} }))

  const runtimeRef = useRef<NotebookRuntime | null>(null)
  if (!runtimeRef.current) {
    runtimeRef.current = new NotebookRuntime({ notebook: emptyNotebook('Retail Foundations'), datasets: {}, models: {}, queries: {}, queryEvaluations: {} })
  }
  const runtime = runtimeRef.current

  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const [status, setStatus] = useState<HydrationStatus>('loading')

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      const persisted = await persistence.load()
      if (cancelled) return

      if (persisted) {
        const datasetIds = persisted.cells
          .filter((cell): cell is Extract<NotebookCell, { kind: 'data' }> => cell.kind === 'data')
          .map((cell) => cell.datasetId)
        const modelIds = persisted.cells
          .filter((cell): cell is Extract<NotebookCell, { kind: 'model' }> => cell.kind === 'model')
          .map((cell) => cell.modelId)
        const queryIds = persisted.cells
          .filter((cell): cell is Extract<NotebookCell, { kind: 'query' }> => cell.kind === 'query')
          .map((cell) => cell.queryId)
        const [datasets, models, queries] = await Promise.all([loadDatasets(datasetIds), loadModels(modelIds), loadQueries(queryIds)])
        if (cancelled) return
        runtime.replaceAll({ notebook: persisted, datasets, models, queries, queryEvaluations: {} })
        // Query evaluations are never persisted (brief §52 hydration order) — recompute them once, after raw datasets/queries are in place.
        runtime.refreshQueries()
      } else {
        // Nothing persisted yet under this key — seed from the deterministic starting snapshot (Free Lab: empty; a lesson: its `initialize()` output) and persist it immediately so a reload finds the same state.
        const initial = createInitialSnapshot()
        const queries = initial.queries ?? {}
        await Promise.all([
          ...Object.values(initial.datasets).map((dataset) => saveDataset(dataset)),
          ...Object.values(initial.models).map((model) => saveModel(model)),
          ...Object.values(queries).map((query) => saveQuery(query)),
          persistence.save(initial.notebook),
        ])
        if (cancelled) return
        runtime.replaceAll({ notebook: initial.notebook, datasets: initial.datasets, models: initial.models, queries, queryEvaluations: {} })
        runtime.refreshQueries()
      }

      setStatus('ready')
    }

    hydrate()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `persistence`/`createInitialSnapshot` are expected to be stable for the lifetime of a given hook instance (a lesson workspace remounts via `key={lessonId}` instead of swapping them in place).
  }, [runtime])

  useEffect(() => {
    if (status !== 'ready') return
    void persistence.save(snapshot.notebook)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot.notebook, status])

  const actions = useMemo(
    () => ({
      async importDataset(dataset: Dataset): Promise<NotebookCell> {
        await saveDataset(dataset)
        return runtime.importDataset(dataset)
      },
      async removeDataset(datasetId: string): Promise<void> {
        runtime.removeDataset(datasetId)
        await deleteDataset(datasetId)
      },
      renameNotebook(title: string): void {
        runtime.renameNotebook(title)
      },
      async createModelCell(name?: string): Promise<ModelCell> {
        const { cell, model } = runtime.createModelCell(name)
        await saveModel(model)
        return cell
      },
      async removeModel(modelId: string): Promise<void> {
        runtime.removeModel(modelId)
        await deleteModel(modelId)
      },
      async addTableToModel(modelId: string, ref: TableRef): Promise<void> {
        runtime.addTableToModel(modelId, ref)
        const model = runtime.getModel(modelId)
        if (model) await saveModel(model)
      },
      async removeTableFromModel(modelId: string, modelTableId: string): Promise<void> {
        runtime.removeTableFromModel(modelId, modelTableId)
        const model = runtime.getModel(modelId)
        if (model) await saveModel(model)
      },
      async moveModelTable(modelId: string, modelTableId: string, position: { x: number; y: number }): Promise<void> {
        runtime.moveModelTable(modelId, modelTableId, position)
        const model = runtime.getModel(modelId)
        if (model) await saveModel(model)
      },
      async createRelationship(modelId: string, input: RelationshipConfigInput) {
        const diagnostics = runtime.createRelationship(modelId, input)
        const model = runtime.getModel(modelId)
        if (model) await saveModel(model)
        return diagnostics
      },
      async updateRelationship(modelId: string, relationshipId: string, changes: RelationshipConfigInput) {
        const diagnostics = runtime.updateRelationship(modelId, relationshipId, changes)
        const model = runtime.getModel(modelId)
        if (model) await saveModel(model)
        return diagnostics
      },
      async removeRelationship(modelId: string, relationshipId: string): Promise<void> {
        runtime.removeRelationship(modelId, relationshipId)
        const model = runtime.getModel(modelId)
        if (model) await saveModel(model)
      },
      async setRelationshipActive(modelId: string, relationshipId: string, active: boolean) {
        const diagnostics = runtime.setRelationshipActive(modelId, relationshipId, active)
        const model = runtime.getModel(modelId)
        if (model) await saveModel(model)
        return diagnostics
      },
      async markDateTable(modelId: string, modelTableId: string, dateColumn: ColumnRef) {
        const diagnostics = runtime.markDateTable(modelId, modelTableId, dateColumn)
        const model = runtime.getModel(modelId)
        if (model) await saveModel(model)
        return diagnostics
      },
      async unmarkDateTable(modelId: string, modelTableId: string): Promise<void> {
        runtime.unmarkDateTable(modelId, modelTableId)
        const model = runtime.getModel(modelId)
        if (model) await saveModel(model)
      },
      async createCalculatedColumnCell(modelId: string, input: CalculatedColumnInput) {
        const result = runtime.createCalculatedColumnCell(modelId, input)
        const model = runtime.getModel(modelId)
        if (result.cell && model) await saveModel(model)
        return result
      },
      async updateCalculatedColumn(modelId: string, calculatedColumnId: string, patch: { name?: string; expression?: string }) {
        const result = runtime.updateCalculatedColumn(modelId, calculatedColumnId, patch)
        const model = runtime.getModel(modelId)
        if (result.calculatedColumn && model) await saveModel(model)
        return result
      },
      async removeCalculatedColumnCell(cellId: string): Promise<void> {
        const cell = runtime.getSnapshot().notebook.cells.find(
          (c): c is CalculatedColumnCell => c.id === cellId && c.kind === 'calculated-column',
        )
        runtime.removeCalculatedColumnCell(cellId)
        if (cell) {
          const model = runtime.getModel(cell.modelId)
          if (model) await saveModel(model)
        }
      },
      async createMeasureCell(modelId: string, input: MeasureInput) {
        const result = runtime.createMeasureCell(modelId, input)
        const model = runtime.getModel(modelId)
        if (result.cell && model) await saveModel(model)
        return result
      },
      async updateMeasure(modelId: string, measureId: string, patch: { name?: string; expression?: string; homeModelTableId?: string }) {
        const result = runtime.updateMeasure(modelId, measureId, patch)
        const model = runtime.getModel(modelId)
        if (result.measure && model) await saveModel(model)
        return result
      },
      async removeMeasureCell(cellId: string): Promise<void> {
        const cell = runtime.getSnapshot().notebook.cells.find((c): c is MeasureCell => c.id === cellId && c.kind === 'measure')
        runtime.removeMeasureCell(cellId)
        if (cell) {
          const model = runtime.getModel(cell.modelId)
          if (model) await saveModel(model)
        }
      },
      createTestCell(modelId: string, validation: ValidationSpec, title?: string, prompt?: string): TestCell {
        return runtime.createTestCell(modelId, validation, title, prompt)
      },
      removeTestCell(cellId: string): void {
        runtime.removeTestCell(cellId)
      },
      createVisualCell(modelId: string, visual: VisualSpec, title?: string) {
        return runtime.createVisualCell(modelId, visual, title)
      },
      updateVisualCell(cellId: string, patch: Partial<VisualSpec>, title?: string): void {
        runtime.updateVisualCell(cellId, patch, title)
      },
      removeVisualCell(cellId: string): void {
        runtime.removeVisualCell(cellId)
      },
      async createQueryFromDataset(datasetId: string, tableId: string, name?: string): Promise<QueryCell> {
        const { cell, query } = runtime.createQueryFromDataset(datasetId, tableId, name)
        await saveQuery(query)
        return cell
      },
      async createQueryFromQuery(sourceQueryId: string, name?: string): Promise<QueryCell | undefined> {
        const result = runtime.createQueryFromQuery(sourceQueryId, name)
        if (result) await saveQuery(result.query)
        return result?.cell
      },
      async renameQuery(queryId: string, name: string): Promise<void> {
        runtime.renameQuery(queryId, name)
        const query = runtime.getQuery(queryId)
        if (query) await saveQuery(query)
      },
      async addQueryStep(queryId: string, input: NewStepInput, name?: string): Promise<void> {
        runtime.addQueryStep(queryId, input, name)
        const query = runtime.getQuery(queryId)
        if (query) await saveQuery(query)
      },
      async updateQueryStep(queryId: string, stepId: string, patch: Record<string, unknown>): Promise<void> {
        runtime.updateQueryStep(queryId, stepId, patch)
        const query = runtime.getQuery(queryId)
        if (query) await saveQuery(query)
      },
      async renameQueryStep(queryId: string, stepId: string, name: string): Promise<void> {
        runtime.renameQueryStep(queryId, stepId, name)
        const query = runtime.getQuery(queryId)
        if (query) await saveQuery(query)
      },
      async removeQueryStep(queryId: string, stepId: string): Promise<void> {
        runtime.removeQueryStep(queryId, stepId)
        const query = runtime.getQuery(queryId)
        if (query) await saveQuery(query)
      },
      async moveQueryStep(queryId: string, stepId: string, toIndex: number): Promise<void> {
        runtime.moveQueryStep(queryId, stepId, toIndex)
        const query = runtime.getQuery(queryId)
        if (query) await saveQuery(query)
      },
      async setQueryLoadEnabled(queryId: string, loadEnabled: boolean): Promise<void> {
        runtime.setQueryLoadEnabled(queryId, loadEnabled)
        const query = runtime.getQuery(queryId)
        if (query) await saveQuery(query)
      },
      async deleteQuery(queryId: string): Promise<DeleteQueryResult> {
        const result = runtime.deleteQuery(queryId)
        if (result.deleted) await deleteQueryRecord(queryId)
        return result
      },
    }),
    [runtime],
  )

  return {
    notebook: snapshot.notebook,
    datasets: snapshot.datasets,
    models: snapshot.models,
    queries: snapshot.queries,
    queryEvaluations: snapshot.queryEvaluations,
    status,
    actions,
  }
}
