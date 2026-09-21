import { useMemo, useState } from 'react'
import type { Dataset } from '../../../domain/data'
import type { ColumnRef, ModelTable, SemanticModel } from '../../../domain/model'
import type { DateTableDiagnostic } from '../../../runtime/dateTable/dateTableTypes'
import { validateDateTableDefinition } from '../../../runtime/dateTable/dateTableRuntime'
import { resolveTableRef } from '../../../runtime/model/modelRuntime'

interface DateTableControlsProps {
  model: SemanticModel
  datasets: Record<string, Dataset>
  table: ModelTable
  onMarkDateTable: (modelTableId: string, dateColumn: ColumnRef) => Promise<DateTableDiagnostic[]>
  onUnmarkDateTable: (modelTableId: string) => void
}

/**
 * Sprint 10 "Mark as Date Table" workflow (sprint brief §9): pick a
 * date/datetime column, then mark — an invalid selection is rejected with
 * the exact structured diagnostics `validateDateTableDefinition` produced,
 * never a raw JS error, and never becomes canonical model state (sprint
 * brief §9 "Do not allow invalid metadata to become canonical").
 */
export function DateTableControls({ model, datasets, table, onMarkDateTable, onUnmarkDateTable }: DateTableControlsProps) {
  const [picking, setPicking] = useState(false)
  const [selectedColumnId, setSelectedColumnId] = useState<string>('')
  const [markDiagnostics, setMarkDiagnostics] = useState<DateTableDiagnostic[]>([])

  const resolved = resolveTableRef(datasets, table)
  const dateColumns = useMemo(
    () => (resolved?.table.columns ?? []).filter((c) => c.dataType === 'date' || c.dataType === 'datetime'),
    [resolved],
  )

  const definition = model.dateTables.find((dt) => dt.modelTableId === table.id)

  if (definition && resolved) {
    const column = resolved.table.columns.find((c) => c.id === definition.dateColumn.columnId)
    const validation = validateDateTableDefinition(model, datasets, table.id, definition.dateColumn)
    return (
      <div className="date-table-controls">
        <span className={`date-table-controls__badge ${validation.valid ? 'date-table-controls__badge--valid' : 'date-table-controls__badge--invalid'}`}>
          DATE TABLE · {resolved.table.name}[{column?.name ?? definition.dateColumn.columnId}] {validation.valid ? '✓ Valid' : '✗ Invalid'}
        </span>
        {!validation.valid && (
          <ul className="date-table-controls__errors">
            {validation.diagnostics.map((d, i) => (
              <li key={i}>{d.message}</li>
            ))}
          </ul>
        )}
        <button type="button" className="text-button" onClick={() => onUnmarkDateTable(table.id)}>
          Unmark
        </button>
      </div>
    )
  }

  if (!picking) {
    return (
      <button type="button" className="text-button" onClick={() => setPicking(true)}>
        Mark as Date Table
      </button>
    )
  }

  return (
    <div className="date-table-controls">
      {dateColumns.length === 0 ? (
        <span className="date-table-controls__errors">"{resolved?.table.name}" has no date/datetime column.</span>
      ) : (
        <>
          <select value={selectedColumnId} onChange={(e) => setSelectedColumnId(e.target.value)}>
            <option value="">Select date column…</option>
            {dateColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="text-button"
            disabled={!selectedColumnId}
            onClick={async () => {
              if (!resolved) return
              const diagnostics = await onMarkDateTable(table.id, { datasetId: resolved.dataset.id, tableId: resolved.table.id, columnId: selectedColumnId })
              setMarkDiagnostics(diagnostics)
            }}
          >
            Mark
          </button>
        </>
      )}
      <button type="button" className="text-button" onClick={() => setPicking(false)}>
        Cancel
      </button>
      {markDiagnostics.length > 0 && (
        <ul className="date-table-controls__errors">
          {markDiagnostics.map((d, i) => (
            <li key={i}>{d.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
