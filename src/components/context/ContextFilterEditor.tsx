import { useState } from 'react'
import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { ColumnFilter } from '../../runtime/measure/filterContext'
import { resolveTableRef } from '../../runtime/model/modelRuntime'

interface ContextFilterEditorProps {
  model: SemanticModel
  datasets: Record<string, Dataset>
  filters: ColumnFilter[]
  onChange: (filters: ColumnFilter[]) => void
}

const MAX_PICKER_VALUES = 200

function formatFilterValue(value: unknown): string {
  if (value === null || value === undefined) return 'BLANK'
  return String(value)
}

/** Distinct non-blank values for a column, or `undefined` when the column is too high-cardinality to list (docs/FILTER_CONTEXT.md "Filter value picker"). */
function distinctColumnValues(datasets: Record<string, Dataset>, model: SemanticModel, modelTableId: string, columnName: string): unknown[] | undefined {
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  if (!resolved) return undefined

  const values = new Set<unknown>()
  for (const row of resolved.table.rows) {
    const value = row[columnName]
    if (value === null || value === undefined) continue
    values.add(value)
    if (values.size > MAX_PICKER_VALUES) return undefined
  }
  return [...values].sort((a, b) => String(a).localeCompare(String(b)))
}

/**
 * A reusable, transient evaluation-context editor over `ColumnFilter[]` — the
 * Sprint 6 generalization of the Sprint 4 `FilterContextPanel`, used by both
 * `MeasureCellCard` and `ContextExplorer` (Sprint 6 brief §8 "Do not maintain
 * two implementations"). Not a report slicer: add/remove table+column+value
 * filters, with a value picker sourced from the column's actual distinct
 * values (capped at 200 — larger columns fall back to free text). Filter
 * selections are always transient UI state, never persisted (spec §9/§53).
 */
export function ContextFilterEditor({ model, datasets, filters, onChange }: ContextFilterEditorProps) {
  const [draftTableId, setDraftTableId] = useState('')
  const [draftColumnId, setDraftColumnId] = useState('')
  const [draftValue, setDraftValue] = useState('')

  const draftModelTable = draftTableId ? model.tables.find((t) => t.id === draftTableId) : undefined
  const draftResolvedTable = draftModelTable ? resolveTableRef(datasets, draftModelTable) : undefined
  const draftColumn = draftResolvedTable?.table.columns.find((c) => c.id === draftColumnId)
  const pickerValues = draftModelTable && draftColumn ? distinctColumnValues(datasets, model, draftModelTable.id, draftColumn.name) : undefined

  function resolveFilterTable(column: ColumnFilter['column']) {
    const modelTable = model.tables.find((t) => t.datasetId === column.datasetId && t.tableId === column.tableId)
    return modelTable ? resolveTableRef(datasets, modelTable) : undefined
  }

  function tableLabel(column: ColumnFilter['column']): string {
    return resolveFilterTable(column)?.table.name ?? 'Unknown table'
  }

  function columnLabel(column: ColumnFilter['column']): string {
    return resolveFilterTable(column)?.table.columns.find((c) => c.id === column.columnId)?.name ?? 'Unknown column'
  }

  function resetDraft() {
    setDraftTableId('')
    setDraftColumnId('')
    setDraftValue('')
  }

  function handleAddFilter() {
    if (!draftModelTable || !draftColumn || draftValue.trim() === '') return
    const filter: ColumnFilter = {
      column: { datasetId: draftModelTable.datasetId, tableId: draftModelTable.tableId, columnId: draftColumn.id },
      operator: 'equals',
      values: [draftColumn.dataType === 'integer' || draftColumn.dataType === 'decimal' ? Number(draftValue) : draftValue],
    }
    onChange([...filters, filter])
    resetDraft()
  }

  function handleRemoveFilter(index: number) {
    onChange(filters.filter((_, i) => i !== index))
  }

  return (
    <div className="context-filter-editor">
      <h4>Current Context</h4>

      {filters.length > 0 ? (
        <ul className="context-filter-editor__chips">
          {filters.map((filter, index) => (
            <li key={index} className="context-filter-chip">
              <span>
                {tableLabel(filter.column)}[{columnLabel(filter.column)}] = {filter.values.map(formatFilterValue).join(', ')}
              </span>
              <button
                type="button"
                className="context-filter-chip__remove"
                aria-label={`Remove filter ${tableLabel(filter.column)}[${columnLabel(filter.column)}]`}
                onClick={() => handleRemoveFilter(index)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="context-filter-editor__empty">No filters — showing the model's baseline result.</p>
      )}

      {filters.length > 0 && (
        <button type="button" className="text-button" onClick={() => onChange([])}>
          Clear all
        </button>
      )}

      <div className="context-filter-editor__draft">
        <select
          aria-label="Filter table"
          value={draftTableId}
          onChange={(e) => {
            setDraftTableId(e.target.value)
            setDraftColumnId('')
            setDraftValue('')
          }}
        >
          <option value="">Table…</option>
          {model.tables.map((table) => (
            <option key={table.id} value={table.id}>
              {resolveTableRef(datasets, table)?.table.name ?? 'Unknown table'}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter column"
          value={draftColumnId}
          onChange={(e) => {
            setDraftColumnId(e.target.value)
            setDraftValue('')
          }}
          disabled={!draftResolvedTable}
        >
          <option value="">Column…</option>
          {draftResolvedTable?.table.columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>

        {pickerValues ? (
          <select aria-label="Filter value" value={draftValue} onChange={(e) => setDraftValue(e.target.value)} disabled={!draftColumn}>
            <option value="">Value…</option>
            {pickerValues.map((value) => (
              <option key={String(value)} value={String(value)}>
                {formatFilterValue(value)}
              </option>
            ))}
          </select>
        ) : (
          <input
            aria-label="Filter value"
            type="text"
            placeholder="Value…"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            disabled={!draftColumn}
          />
        )}

        <button type="button" className="secondary-button" onClick={handleAddFilter} disabled={!draftColumn || draftValue.trim() === ''}>
          + Add Filter
        </button>
      </div>
    </div>
  )
}
