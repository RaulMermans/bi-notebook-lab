import { createStore, del, get, set } from 'idb-keyval'
import type { SemanticModel } from '../domain/model'
import { hydrateSemanticModel } from '../runtime/model/modelRuntime'

const modelStore = createStore('bi-notebook-lab-models', 'models')

/**
 * Mirrors notebookStore.ts's dataset store: one entry per SemanticModel,
 * keyed by id. A ModelCell persists only `modelId`, never the model itself.
 */
export async function saveModel(model: SemanticModel): Promise<void> {
  await set(model.id, model, modelStore)
}

/** Always hydrates through `hydrateSemanticModel` so a model persisted before Sprint 4 (no `measures` field) never reaches runtime code as `undefined`. */
export async function loadModel(modelId: string): Promise<SemanticModel | undefined> {
  const model = await get<SemanticModel>(modelId, modelStore)
  return model ? hydrateSemanticModel(model) : undefined
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
