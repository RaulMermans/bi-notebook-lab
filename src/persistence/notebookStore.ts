import { createStore, del, get, set } from 'idb-keyval'
import type { NotebookDocument } from '../domain/notebook'
import type { Dataset } from '../domain/data'

const notebookStore = createStore('bi-notebook-lab-notebooks', 'notebooks')
const datasetStore = createStore('bi-notebook-lab-datasets', 'datasets')

const ACTIVE_NOTEBOOK_KEY = 'active-notebook'

/**
 * Sprint 1 persists a single active notebook (metadata + cell order, not
 * dataset rows) plus a dataset store keyed by id, so importing more data
 * never rewrites already-persisted table rows.
 */
export async function saveNotebook(notebook: NotebookDocument): Promise<void> {
  await set(ACTIVE_NOTEBOOK_KEY, notebook, notebookStore)
}

export async function loadNotebook(): Promise<NotebookDocument | undefined> {
  return get<NotebookDocument>(ACTIVE_NOTEBOOK_KEY, notebookStore)
}

export async function saveDataset(dataset: Dataset): Promise<void> {
  await set(dataset.id, dataset, datasetStore)
}

export async function loadDataset(datasetId: string): Promise<Dataset | undefined> {
  return get<Dataset>(datasetId, datasetStore)
}

export async function loadDatasets(datasetIds: string[]): Promise<Record<string, Dataset>> {
  const entries = await Promise.all(
    datasetIds.map(async (id): Promise<[string, Dataset] | undefined> => {
      const dataset = await loadDataset(id)
      return dataset ? [id, dataset] : undefined
    }),
  )
  return Object.fromEntries(entries.filter((entry): entry is [string, Dataset] => entry !== undefined))
}

export async function deleteDataset(datasetId: string): Promise<void> {
  await del(datasetId, datasetStore)
}
