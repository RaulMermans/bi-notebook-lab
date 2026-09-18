import { useState } from 'react'
import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { VisualCell } from '../../domain/notebook'
import type { VisualSpec, VisualType } from '../../domain/visual'
import { generateId } from '../../lib/ids'
import { VisualFieldsForm, type VisualDraft } from './visual/VisualFieldsForm'

interface AddVisualCellPanelProps {
  models: Record<string, SemanticModel>
  datasets: Record<string, Dataset>
  onCreate: (modelId: string, visual: VisualSpec, title?: string) => VisualCell
}

const VISUAL_TYPE_LABELS: Record<VisualType, string> = { kpi: 'KPI', table: 'Table', bar: 'Bar', line: 'Line', slicer: 'Slicer' }

function isComplete(type: VisualType, draft: VisualDraft): boolean {
  switch (type) {
    case 'kpi':
      return Boolean((draft as { measureId?: string }).measureId)
    case 'bar':
      return Boolean((draft as { category?: unknown; measureId?: string }).category && (draft as { measureId?: string }).measureId)
    case 'line':
      return Boolean((draft as { axis?: unknown; measureId?: string }).axis && (draft as { measureId?: string }).measureId)
    case 'table':
      return ((draft as { measureIds?: string[] }).measureIds?.length ?? 0) > 0
    case 'slicer':
      return Boolean((draft as { column?: unknown }).column)
  }
}

/** The creation flow for every Visual type (brief §37-42): pick a type, a model, then only the field mappings relevant to that type. */
export function AddVisualCellPanel({ models, datasets, onCreate }: AddVisualCellPanelProps) {
  const [open, setOpen] = useState(false)
  const [visualType, setVisualType] = useState<VisualType | ''>('')
  const [modelId, setModelId] = useState('')
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState<VisualDraft>({})

  const availableModels = Object.values(models).filter((m) => m.tables.length > 0)
  if (availableModels.length === 0) return null

  function reset() {
    setVisualType('')
    setModelId('')
    setTitle('')
    setDraft({})
    setOpen(false)
  }

  function handleCreate() {
    if (!visualType || !modelId || !isComplete(visualType, draft)) return
    const visual = { id: generateId('visual'), type: visualType, title: title.trim() || undefined, ...draft } as VisualSpec
    onCreate(modelId, visual, title.trim() || undefined)
    reset()
  }

  if (!open) {
    return (
      <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
        + Add Visual
      </button>
    )
  }

  const model = modelId ? models[modelId] : undefined

  return (
    <div className="create-calculated-column-panel visual-fields-form">
      <h3>Add Visual</h3>
      <div className="create-calculated-column-panel__fields">
        <select value={visualType} onChange={(e) => { setVisualType(e.target.value as VisualType); setDraft({}) }}>
          <option value="">Type…</option>
          {(Object.keys(VISUAL_TYPE_LABELS) as VisualType[]).map((t) => (
            <option key={t} value={t}>
              {VISUAL_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
          <option value="">Model…</option>
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <input type="text" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>

      {visualType && model && (
        <div className="visual-fields-form__fields">
          <VisualFieldsForm type={visualType} model={model} datasets={datasets} value={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} />
        </div>
      )}

      <div className="create-calculated-column-panel__fields">
        <button type="button" className="primary-button" onClick={handleCreate} disabled={!visualType || !modelId || !isComplete(visualType || 'kpi', draft)}>
          Create
        </button>
        <button type="button" className="text-button" onClick={reset}>
          Cancel
        </button>
      </div>
    </div>
  )
}
