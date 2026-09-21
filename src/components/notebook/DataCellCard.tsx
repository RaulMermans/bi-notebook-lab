import { useState } from 'react'
import type { NotebookCell } from '../../domain/notebook'
import { primaryTable, type Dataset } from '../../domain/data'
import { TablePreview } from './TablePreview'
import { TableProfile } from './TableProfile'
import { TableSchema } from './TableSchema'

type Tab = 'preview' | 'profile' | 'schema'
const TABS: Tab[] = ['preview', 'profile', 'schema']

interface DataCellCardProps {
  cell: NotebookCell
  dataset: Dataset | undefined
  onRemove: () => void
  onTransformData: (tableId: string) => void
}

export function DataCellCard({ cell, dataset, onRemove, onTransformData }: DataCellCardProps) {
  const [activeTab, setActiveTab] = useState<Tab | null>(null)

  if (!dataset) {
    return (
      <article className="cell cell--data cell--missing">
        <div className="cell__rail">
          <span>DATA</span>
        </div>
        <div className="cell__body">
          <p>Dataset for &quot;{cell.title}&quot; is missing. It may still be loading.</p>
        </div>
      </article>
    )
  }

  const table = primaryTable(dataset)

  return (
    <article className="cell cell--data">
      <div className="cell__rail">
        <span>DATA</span>
      </div>
      <div className="cell__body">
        <div className="cell__header">
          <div>
            <h2>{table.name}</h2>
            <p className="cell__meta">
              {table.rowCount.toLocaleString()} rows · {table.columns.length} columns
            </p>
          </div>
          <div className="cell__header-actions">
            <button type="button" className="secondary-button" onClick={() => onTransformData(table.id)}>
              Transform Data
            </button>
            <button type="button" className="text-button" onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>

        <ul className="column-summary">
          {table.columns.slice(0, 8).map((column) => (
            <li key={column.id}>
              <span>{column.name}</span>
              <span className="type-badge">{column.dataType}</span>
            </li>
          ))}
          {table.columns.length > 8 && (
            <li className="column-summary__more">+{table.columns.length - 8} more</li>
          )}
        </ul>

        <div className="cell__tabs">
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`tab-button ${activeTab === tab ? 'tab-button--active' : ''}`}
              onClick={() => setActiveTab((current) => (current === tab ? null : tab))}
            >
              {tab[0].toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === 'preview' && <TablePreview table={table} />}
        {activeTab === 'profile' && <TableProfile table={table} />}
        {activeTab === 'schema' && <TableSchema table={table} />}
      </div>
    </article>
  )
}
