import { useState } from 'react'
import type { Dataset } from '../../../domain/data'
import type { ColumnRef, RelationshipDiagnostic, SemanticModel } from '../../../domain/model'
import { resolveTableRef } from '../../../runtime/model/modelRuntime'

interface RelationshipFormProps {
  model: SemanticModel
  datasets: Record<string, Dataset>
  onCreateRelationship: (input: { one: ColumnRef; many: ColumnRef; active: boolean }) => Promise<RelationshipDiagnostic[]>
}

interface SideSelection {
  modelTableId: string
  columnId: string
}

const EMPTY_SIDE: SideSelection = { modelTableId: '', columnId: '' }

function columnsFor(model: SemanticModel, datasets: Record<string, Dataset>, modelTableId: string) {
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  if (!modelTable) return []
  return resolveTableRef(datasets, modelTable)?.table.columns ?? []
}

export function RelationshipForm({ model, datasets, onCreateRelationship }: RelationshipFormProps) {
  const [one, setOne] = useState<SideSelection>(EMPTY_SIDE)
  const [many, setMany] = useState<SideSelection>(EMPTY_SIDE)
  const [active, setActive] = useState(true)
  const [diagnostics, setDiagnostics] = useState<RelationshipDiagnostic[]>([])
  const [submitting, setSubmitting] = useState(false)

  const canSubmit = one.modelTableId && one.columnId && many.modelTableId && many.columnId && !submitting

  async function handleSubmit() {
    const oneTable = model.tables.find((t) => t.id === one.modelTableId)
    const manyTable = model.tables.find((t) => t.id === many.modelTableId)
    if (!oneTable || !manyTable) return

    setSubmitting(true)
    try {
      const result = await onCreateRelationship({
        one: { datasetId: oneTable.datasetId, tableId: oneTable.tableId, columnId: one.columnId },
        many: { datasetId: manyTable.datasetId, tableId: manyTable.tableId, columnId: many.columnId },
        active,
      })
      setDiagnostics(result)
      if (!result.some((d) => d.severity === 'error')) {
        setOne(EMPTY_SIDE)
        setMany(EMPTY_SIDE)
        setActive(true)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relationship-form">
      <div className="relationship-form__sides">
        <fieldset>
          <legend>One (unique side)</legend>
          <select value={one.modelTableId} onChange={(e) => setOne({ modelTableId: e.target.value, columnId: '' })}>
            <option value="">Table…</option>
            {model.tables.map((t) => (
              <option key={t.id} value={t.id}>
                {resolveTableRef(datasets, t)?.table.name ?? t.id}
              </option>
            ))}
          </select>
          <select
            value={one.columnId}
            onChange={(e) => setOne((current) => ({ ...current, columnId: e.target.value }))}
            disabled={!one.modelTableId}
          >
            <option value="">Column…</option>
            {columnsFor(model, datasets, one.modelTableId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.dataType})
              </option>
            ))}
          </select>
        </fieldset>

        <span className="relationship-form__arrow">1 → *</span>

        <fieldset>
          <legend>Many side</legend>
          <select value={many.modelTableId} onChange={(e) => setMany({ modelTableId: e.target.value, columnId: '' })}>
            <option value="">Table…</option>
            {model.tables.map((t) => (
              <option key={t.id} value={t.id}>
                {resolveTableRef(datasets, t)?.table.name ?? t.id}
              </option>
            ))}
          </select>
          <select
            value={many.columnId}
            onChange={(e) => setMany((current) => ({ ...current, columnId: e.target.value }))}
            disabled={!many.modelTableId}
          >
            <option value="">Column…</option>
            {columnsFor(model, datasets, many.modelTableId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.dataType})
              </option>
            ))}
          </select>
        </fieldset>
      </div>

      <label className="relationship-form__active">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active
      </label>

      <button type="button" className="primary-button" disabled={!canSubmit} onClick={handleSubmit}>
        Create relationship
      </button>

      {diagnostics.length > 0 && (
        <ul className="diagnostic-list">
          {diagnostics.map((d, index) => (
            <li key={index} className={`diagnostic diagnostic--${d.severity}`}>
              {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
