import { useState } from 'react'
import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { VisualCell } from '../../domain/notebook'
import type { VisualSpec } from '../../domain/visual'
import type { FilterContext } from '../../runtime/measure/filterContext'
import { VisualRenderer } from '../visual/VisualRenderer'
import { VisualFieldsForm, type VisualDraft } from './visual/VisualFieldsForm'

interface VisualCellCardProps {
  cell: VisualCell
  model: SemanticModel | undefined
  datasets: Record<string, Dataset>
  notebookContext: FilterContext
  slicerSelection: unknown[]
  onSlicerChange: (values: unknown[]) => void
  onUpdate: (patch: Partial<VisualSpec>, title?: string) => void
  onRemove: () => void
}

/**
 * A Visual is notebook output, not raw configuration — the learner never
 * sees the `VisualSpec` JSON (brief §43). Editing (brief §44) reuses the
 * exact same `VisualFieldsForm` the creation panel uses, so a field mapping
 * can be changed without deleting/recreating the cell.
 */
export function VisualCellCard({ cell, model, datasets, notebookContext, slicerSelection, onSlicerChange, onUpdate, onRemove }: VisualCellCardProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<VisualDraft>(cell.visual as unknown as VisualDraft)
  const [draftTitle, setDraftTitle] = useState(cell.title)

  if (!model) {
    return (
      <article className="cell cell--visual cell--missing">
        <div className="cell__rail">
          <span>VISUAL</span>
        </div>
        <div className="cell__body">
          <p>This visual references a model that no longer exists. Edit or remove the visual.</p>
          <button type="button" className="text-button" onClick={onRemove}>
            Remove
          </button>
        </div>
      </article>
    )
  }

  function startEditing() {
    setDraft(cell.visual as unknown as VisualDraft)
    setDraftTitle(cell.title)
    setEditing(true)
  }

  function handleSave() {
    onUpdate(draft as Partial<VisualSpec>, draftTitle.trim() || undefined)
    setEditing(false)
  }

  return (
    <article className="cell cell--visual">
      <div className="cell__rail">
        <span>VISUAL · {cell.visual.type.toUpperCase()}</span>
      </div>
      <div className="cell__body">
        <div className="cell__header">
          <h2>{cell.title}</h2>
          <div className="cell__header-actions">
            <button type="button" className="text-button" onClick={editing ? () => setEditing(false) : startEditing}>
              {editing ? 'Cancel' : 'Edit'}
            </button>
            <button type="button" className="text-button" onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>

        {editing ? (
          <div className="visual-fields-form">
            <div className="create-calculated-column-panel__fields">
              <input type="text" placeholder="Title" value={draftTitle} onChange={(e) => setDraftTitle(e.target.value)} />
            </div>
            <div className="visual-fields-form__fields">
              <VisualFieldsForm
                type={cell.visual.type}
                model={model}
                datasets={datasets}
                value={draft}
                onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
              />
            </div>
            <button type="button" className="primary-button" onClick={handleSave}>
              Save
            </button>
          </div>
        ) : (
          <VisualRenderer
            visual={cell.visual}
            model={model}
            datasets={datasets}
            notebookContext={notebookContext}
            slicerSelection={slicerSelection}
            onSlicerChange={onSlicerChange}
          />
        )}
      </div>
    </article>
  )
}
