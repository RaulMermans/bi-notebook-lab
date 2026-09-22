import { useState } from 'react'
import type { TestCell, TestCellScope } from '../../domain/notebook'
import type { SemanticModel } from '../../domain/model'
import type { ValidationSpec } from '../../domain/validation'
import { retailFoundationsValidationSpec } from '../../data/exercises/retailFoundationsValidation'

interface AddTestCellPanelProps {
  models: Record<string, SemanticModel>
  onCreate: (scope: TestCellScope, validation: ValidationSpec) => TestCell
}

/**
 * Sprint 5 has no exercise-authoring UI yet (brief §35) — this is the one
 * predefined creation path for the built-in Retail Foundations checkpoint.
 * If more than one model exists, the learner picks which one the checkpoint
 * grades.
 */
export function AddTestCellPanel({ models, onCreate }: AddTestCellPanelProps) {
  const [open, setOpen] = useState(false)
  const [modelId, setModelId] = useState('')

  const availableModels = Object.values(models)
  if (availableModels.length === 0) return null

  if (!open) {
    return (
      <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
        + Add Retail checkpoint
      </button>
    )
  }

  function handleAdd() {
    const targetModelId = modelId || availableModels[0].id
    onCreate({ kind: 'model', modelId: targetModelId }, retailFoundationsValidationSpec)
    setOpen(false)
    setModelId('')
  }

  return (
    <div className="create-calculated-column-panel">
      <h3>Add Retail checkpoint</h3>
      {availableModels.length > 1 && (
        <div className="create-calculated-column-panel__fields">
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">Model…</option>
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="create-calculated-column-panel__fields">
        <button type="button" className="primary-button" onClick={handleAdd} disabled={availableModels.length > 1 && !modelId}>
          Add checkpoint
        </button>
        <button type="button" className="text-button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
