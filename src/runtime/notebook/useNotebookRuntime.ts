import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { CalculatedColumnCell, MeasureCell, ModelCell, NotebookCell, TestCell } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import type { ColumnRef, TableRef } from '../../domain/model'
import type { ValidationSpec } from '../../domain/validation'
import type { VisualSpec } from '../../domain/visual'
import { deleteDataset, loadDatasets, loadNotebook, saveDataset, saveNotebook } from '../../persistence/notebookStore'
import { deleteModel, loadModels, saveModel } from '../../persistence/modelStore'
import type { CalculatedColumnInput } from '../calculatedColumn/calculatedColumnRuntime'
import type { MeasureInput } from '../measure/measureRuntime'
import type { RelationshipConfigInput } from '../model/modelRuntime'
import { NotebookRuntime, emptyNotebook } from './notebookRuntime'

export type HydrationStatus = 'loading' | 'ready'

/**
 * Wires the framework-free NotebookRuntime to React state and to
 * IndexedDB persistence. Hydrates once on mount, then keeps the persisted
 * notebook document in sync with every structural change. Datasets and
 * models are saved/deleted explicitly at the point of the action rather
 * than on every snapshot change, since their payloads shouldn't be
 * rewritten on unrelated notebook edits.
 */
export function useNotebookRuntime() {
  const runtimeRef = useRef<NotebookRuntime | null>(null)
  if (!runtimeRef.current) {
    runtimeRef.current = new NotebookRuntime({ notebook: emptyNotebook('Retail Foundations'), datasets: {}, models: {} })
  }
  const runtime = runtimeRef.current

  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const [status, setStatus] = useState<HydrationStatus>('loading')

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      const persisted = await loadNotebook()
      if (cancelled) return

      if (persisted) {
        const datasetIds = persisted.cells
          .filter((cell): cell is Extract<NotebookCell, { kind: 'data' }> => cell.kind === 'data')
          .map((cell) => cell.datasetId)
        const modelIds = persisted.cells
          .filter((cell): cell is Extract<NotebookCell, { kind: 'model' }> => cell.kind === 'model')
          .map((cell) => cell.modelId)
        const [datasets, models] = await Promise.all([loadDatasets(datasetIds), loadModels(modelIds)])
        if (cancelled) return
        runtime.replaceAll({ notebook: persisted, datasets, models })
      }

      setStatus('ready')
    }

    hydrate()
    return () => {
      cancelled = true
    }
  }, [runtime])

  useEffect(() => {
    if (status !== 'ready') return
    void saveNotebook(snapshot.notebook)
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
    }),
    [runtime],
  )

  return { notebook: snapshot.notebook, datasets: snapshot.datasets, models: snapshot.models, status, actions }
}
