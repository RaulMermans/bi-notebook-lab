import type { NotebookCell as NotebookCellModel } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import { NotebookCellCard } from '../NotebookCellCard'
import { DataCellCard } from './DataCellCard'

interface NotebookCellProps {
  cell: NotebookCellModel
  datasets: Record<string, Dataset>
  onRemoveDataset: (datasetId: string) => void
}

/** Dispatches a notebook cell to its renderer. Only `data` is functional in Sprint 1. */
export function NotebookCell({ cell, datasets, onRemoveDataset }: NotebookCellProps) {
  if (cell.kind === 'data') {
    const dataset = cell.datasetId ? datasets[cell.datasetId] : undefined
    return (
      <DataCellCard
        cell={cell}
        dataset={dataset}
        onRemove={() => cell.datasetId && onRemoveDataset(cell.datasetId)}
      />
    )
  }
  return <NotebookCellCard cell={cell} />
}
