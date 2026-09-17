import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { NotebookCell } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import { deleteDataset, loadDatasets, loadNotebook, saveDataset, saveNotebook } from '../../persistence/notebookStore'
import { NotebookRuntime, emptyNotebook } from './notebookRuntime'

export type HydrationStatus = 'loading' | 'ready'

/**
 * Wires the framework-free NotebookRuntime to React state and to
 * IndexedDB persistence. Hydrates once on mount, then keeps the persisted
 * notebook document in sync with every structural change. Datasets are
 * saved/deleted explicitly at import/remove time rather than on every
 * snapshot change, since their row payloads shouldn't be rewritten on
 * unrelated notebook edits.
 */
export function useNotebookRuntime() {
  const runtimeRef = useRef<NotebookRuntime | null>(null)
  if (!runtimeRef.current) {
    runtimeRef.current = new NotebookRuntime({ notebook: emptyNotebook('Retail Foundations'), datasets: {} })
  }
  const runtime = runtimeRef.current

  const snapshot = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot)
  const [status, setStatus] = useState<HydrationStatus>('loading')

  useEffect(() => {
    let cancelled = false

    async function hydrate() {
      const persisted = await loadNotebook()
      if (cancelled) return

      if (persisted) {
        const datasetIds = persisted.cells
          .map((cell) => cell.datasetId)
          .filter((id): id is string => Boolean(id))
        const datasets = await loadDatasets(datasetIds)
        if (cancelled) return
        runtime.replaceAll({ notebook: persisted, datasets })
      }

      setStatus('ready')
    }

    hydrate()
    return () => {
      cancelled = true
    }
  }, [runtime])

  useEffect(() => {
    if (status !== 'ready') return
    void saveNotebook(snapshot.notebook)
  }, [snapshot.notebook, status])

  const actions = useMemo(
    () => ({
      async importDataset(dataset: Dataset): Promise<NotebookCell> {
        await saveDataset(dataset)
        return runtime.importDataset(dataset)
      },
      async removeDataset(datasetId: string): Promise<void> {
        runtime.removeDataset(datasetId)
        await deleteDataset(datasetId)
      },
      renameNotebook(title: string): void {
        runtime.renameNotebook(title)
      },
    }),
    [runtime],
  )

  return { notebook: snapshot.notebook, datasets: snapshot.datasets, status, actions }
}
