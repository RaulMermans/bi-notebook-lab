import type { Dataset } from '../../../domain/data'
import type { SemanticModel, TableRef } from '../../../domain/model'

interface AvailableTable {
  ref: TableRef
  name: string
}

function availableTables(model: SemanticModel, datasets: Record<string, Dataset>): AvailableTable[] {
  const inModel = new Set(model.tables.map((t) => `${t.datasetId}:${t.tableId}`))
  const result: AvailableTable[] = []

  for (const dataset of Object.values(datasets)) {
    for (const table of dataset.tables) {
      const key = `${dataset.id}:${table.id}`
      if (inModel.has(key)) continue
      result.push({ ref: { datasetId: dataset.id, tableId: table.id }, name: table.name })
    }
  }

  return result
}

interface TableRegistrationPanelProps {
  model: SemanticModel
  datasets: Record<string, Dataset>
  onAddTable: (ref: TableRef) => void
}

/** Lets the learner explicitly choose which imported tables belong to the model — nothing is added automatically. */
export function TableRegistrationPanel({ model, datasets, onAddTable }: TableRegistrationPanelProps) {
  const tables = availableTables(model, datasets)

  if (tables.length === 0) {
    return <p className="model-panel__empty">Every imported table is already in this model.</p>
  }

  return (
    <ul className="table-registration-list">
      {tables.map((table) => (
        <li key={`${table.ref.datasetId}:${table.ref.tableId}`}>
          <span>{table.name}</span>
          <button type="button" className="secondary-button" onClick={() => onAddTable(table.ref)}>
            + Add
          </button>
        </li>
      ))}
    </ul>
  )
}
