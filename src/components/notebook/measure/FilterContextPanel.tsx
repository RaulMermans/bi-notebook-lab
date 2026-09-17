import { useState } from 'react'
import type { Dataset } from '../../../domain/data'
import type { SemanticModel } from '../../../domain/model'
import type { ColumnFilter } from '../../../runtime/measure/filterContext'
import { resolveTableRef } from '../../../runtime/model/modelRuntime'

interface FilterContextPanelProps {
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
 * A lightweight evaluation-context editor for testing a measure under a
 * filter, not a report slicer (docs/FILTER_CONTEXT.md "Filter Context UI").
 * Filters here are transient UI state, never persisted (spec §53).
 */
export function FilterContextPanel({ model, datasets, filters, onChange }: FilterContextPanelProps) {
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
    <div className="filter-context-panel">
      <h4>Evaluation Context</h4>

      {filters.length > 0 && (
        <ul className="filter-context-panel__list">
          {filters.map((filter, index) => (
            <li key={index}>
              <span>
                {tableLabel(filter.column)}[{columnLabel(filter.column)}] = {filter.values.map(formatFilterValue).join(', ')}
              </span>
              <button type="button" className="text-button" onClick={() => handleRemoveFilter(index)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="filter-context-panel__draft">
        <select
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
          <select value={draftValue} onChange={(e) => setDraftValue(e.target.value)} disabled={!draftColumn}>
            <option value="">Value…</option>
            {pickerValues.map((value) => (
              <option key={String(value)} value={String(value)}>
                {formatFilterValue(value)}
              </option>
            ))}
          </select>
        ) : (
          <input
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
