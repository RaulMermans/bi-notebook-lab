import { useState } from 'react'
import type { Dataset } from '../../../domain/data'
import type { ColumnRef, SemanticModel } from '../../../domain/model'
import type { BarSortOrder, LineSortOrder, SlicerMode, VisualType } from '../../../domain/visual'
import { resolveTableRef } from '../../../runtime/model/modelRuntime'

/**
 * A loose "draft bag" rather than `Partial<VisualSpec>`: the discriminated
 * union distributes across `Partial<>` in a way that makes an in-progress
 * draft (which may not yet even have a `type` chosen, or may carry stale
 * fields from a type the learner switched away from) awkward to type
 * precisely. Validated into a real `VisualSpec` only at submit time
 * (`AddVisualCellPanel`/`VisualCellCard`).
 */
export type VisualDraft = Record<string, unknown>

interface VisualFieldsFormProps {
  type: VisualType
  model: SemanticModel
  datasets: Record<string, Dataset>
  value: VisualDraft
  onChange: (patch: VisualDraft) => void
}

function tableOptions(model: SemanticModel, datasets: Record<string, Dataset>) {
  return model.tables.map((t) => ({ modelTableId: t.id, datasetId: t.datasetId, tableId: t.tableId, name: resolveTableRef(datasets, t)?.table.name ?? 'Unknown table' }))
}

function columnsForModelTable(model: SemanticModel, datasets: Record<string, Dataset>, modelTableId: string) {
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  return resolved?.table.columns ?? []
}

/**
 * A `Table[Column]` picker that always resolves to a `ColumnRef` built from
 * the model table's own `{ datasetId, tableId }`, never `ModelTable.id`
 * (brief §34 — the Sprint 4 table-id regression every Visual field mapping
 * must avoid). Shared by every visual type's Category/Axis/Rows/Field
 * mapping (brief §39-42).
 */
function ColumnPicker({
  label,
  model,
  datasets,
  value,
  onChange,
}: {
  label: string
  model: SemanticModel
  datasets: Record<string, Dataset>
  value: ColumnRef | undefined
  onChange: (column: ColumnRef | undefined) => void
}) {
  const currentModelTable = value ? model.tables.find((t) => t.datasetId === value.datasetId && t.tableId === value.tableId) : undefined
  const [draftModelTableId, setDraftModelTableId] = useState(currentModelTable?.id ?? '')

  const columns = draftModelTableId ? columnsForModelTable(model, datasets, draftModelTableId) : []

  return (
    <div className="visual-fields-form__field">
      <label>{label}</label>
      <div className="visual-fields-form__picker">
        <select
          aria-label={`${label} table`}
          value={draftModelTableId}
          onChange={(e) => {
            setDraftModelTableId(e.target.value)
            onChange(undefined)
          }}
        >
          <option value="">Table…</option>
          {tableOptions(model, datasets).map((t) => (
            <option key={t.modelTableId} value={t.modelTableId}>
              {t.name}
            </option>
          ))}
        </select>
        <select
          aria-label={`${label} column`}
          value={value?.columnId ?? ''}
          disabled={!draftModelTableId}
          onChange={(e) => {
            const modelTable = model.tables.find((t) => t.id === draftModelTableId)
            if (!modelTable || !e.target.value) return
            onChange({ datasetId: modelTable.datasetId, tableId: modelTable.tableId, columnId: e.target.value })
          }}
        >
          <option value="">Column…</option>
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function MeasurePicker({
  label,
  model,
  value,
  onChange,
}: {
  label: string
  model: SemanticModel
  value: string | undefined
  onChange: (measureId: string) => void
}) {
  return (
    <div className="visual-fields-form__field">
      <label>{label}</label>
      <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Measure…</option>
        {model.measures.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * The per-type field mapping editor shared by `AddVisualCellPanel` (create)
 * and `VisualCellCard` (edit) — one implementation, so editing a visual's
 * mapping (brief §44) can never drift from how it was created (brief
 * §38-42).
 */
export function VisualFieldsForm({ type, model, datasets, value, onChange }: VisualFieldsFormProps) {
  if (type === 'kpi') {
    return <MeasurePicker label="Measure" model={model} value={(value as { measureId?: string }).measureId} onChange={(measureId) => onChange({ measureId })} />
  }

  if (type === 'bar') {
    const v = value as { category?: ColumnRef; measureId?: string; sort?: BarSortOrder }
    return (
      <>
        <ColumnPicker label="Category" model={model} datasets={datasets} value={v.category} onChange={(category) => onChange({ category })} />
        <MeasurePicker label="Value" model={model} value={v.measureId} onChange={(measureId) => onChange({ measureId })} />
        <div className="visual-fields-form__field">
          <label>Sort</label>
          <select aria-label="Sort" value={v.sort ?? 'value-desc'} onChange={(e) => onChange({ sort: e.target.value as BarSortOrder })}>
            <option value="value-desc">Value descending</option>
            <option value="value-asc">Value ascending</option>
            <option value="category-asc">Category ascending</option>
            <option value="category-desc">Category descending</option>
          </select>
        </div>
      </>
    )
  }

  if (type === 'line') {
    const v = value as { axis?: ColumnRef; measureId?: string; sort?: LineSortOrder }
    return (
      <>
        <ColumnPicker label="Axis" model={model} datasets={datasets} value={v.axis} onChange={(axis) => onChange({ axis })} />
        <MeasurePicker label="Value" model={model} value={v.measureId} onChange={(measureId) => onChange({ measureId })} />
      </>
    )
  }

  if (type === 'table') {
    const v = value as { dimension?: ColumnRef; measureIds?: string[] }
    const selectedMeasureIds = v.measureIds ?? []
    return (
      <>
        <ColumnPicker label="Rows (optional)" model={model} datasets={datasets} value={v.dimension} onChange={(dimension) => onChange({ dimension })} />
        <div className="visual-fields-form__field">
          <label>Values</label>
          <div className="visual-fields-form__checkboxes">
            {model.measures.map((m) => (
              <label key={m.id} className="visual-fields-form__checkbox">
                <input
                  type="checkbox"
                  checked={selectedMeasureIds.includes(m.id)}
                  onChange={(e) => {
                    const next = e.target.checked ? [...selectedMeasureIds, m.id] : selectedMeasureIds.filter((id) => id !== m.id)
                    onChange({ measureIds: next })
                  }}
                />
                {m.name}
              </label>
            ))}
          </div>
        </div>
      </>
    )
  }

  // slicer
  const v = value as { column?: ColumnRef; mode?: SlicerMode }
  return (
    <>
      <ColumnPicker label="Field" model={model} datasets={datasets} value={v.column} onChange={(column) => onChange({ column })} />
      <div className="visual-fields-form__field">
        <label>Selection</label>
        <select aria-label="Selection" value={v.mode ?? 'single'} onChange={(e) => onChange({ mode: e.target.value as SlicerMode })}>
          <option value="single">Single</option>
          <option value="multi">Multi</option>
        </select>
      </div>
    </>
  )
}
