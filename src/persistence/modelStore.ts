import { createStore, del, get, set } from 'idb-keyval'
import type { SemanticModel } from '../domain/model'

const modelStore = createStore('bi-notebook-lab-models', 'models')

/**
 * Mirrors notebookStore.ts's dataset store: one entry per SemanticModel,
 * keyed by id. A ModelCell persists only `modelId`, never the model itself.
 */
export async function saveModel(model: SemanticModel): Promise<void> {
  await set(model.id, model, modelStore)
}

export async function loadModel(modelId: string): Promise<SemanticModel | undefined> {
  return get<SemanticModel>(modelId, modelStore)
}

export async function loadModels(modelIds: string[]): Promise<Record<string, SemanticModel>> {
  const entries = await Promise.all(
    modelIds.map(async (id): Promise<[string, SemanticModel] | undefined> => {
      const model = await loadModel(id)
      return model ? [id, model] : undefined
    }),
  )
  return Object.fromEntries(entries.filter((entry): entry is [string, SemanticModel] => entry !== undefined))
}

export async function deleteModel(modelId: string): Promise<void> {
  await del(modelId, modelStore)
}
