import { describe, expect, it } from 'vitest'
import type { SemanticModel } from '../../src/domain/model'
import { deleteModel, loadModel, loadModels, saveModel } from '../../src/persistence/modelStore'

function fakeModel(id: string): SemanticModel {
  const now = new Date().toISOString()
  return {
    id,
    name: id,
    tables: [{ id: `${id}-table`, datasetId: 'ds1', tableId: 'ds1-table', position: { x: 10, y: 20 } }],
    relationships: [],
    calculatedColumns: [],
    createdAt: now,
    updatedAt: now,
  }
}

describe('modelStore persistence', () => {
  it('round-trips a model including table positions', async () => {
    const model = fakeModel('model-x')

    await saveModel(model)
    const restored = await loadModel('model-x')

    expect(restored).toEqual(model)
  })

  it('loads multiple models by id and skips ids that were never saved', async () => {
    await saveModel(fakeModel('model-a'))
    await saveModel(fakeModel('model-b'))

    const restored = await loadModels(['model-a', 'model-b', 'missing'])

    expect(Object.keys(restored).sort()).toEqual(['model-a', 'model-b'])
  })

  it('deletes a model', async () => {
    await saveModel(fakeModel('model-del'))

    await deleteModel('model-del')
    const restored = await loadModel('model-del')

    expect(restored).toBeUndefined()
  })
})
