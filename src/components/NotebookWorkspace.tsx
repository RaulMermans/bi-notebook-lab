import { useMemo, useState } from 'react'
import { NotebookBody } from './notebook/NotebookBody'
import { ImportDataPanel } from './notebook/ImportDataPanel'
import type { ValidationRun } from '../domain/validation'
import { buildSlicerFilter } from '../runtime/visual/visualRuntime'
import { isValidationRunStale } from '../runtime/validation/fingerprint'
import { computeNotebookScore } from '../runtime/validation/scoring'
import { runValidation } from '../runtime/validation/validationEngine'
import { useNotebookRuntime } from '../runtime/notebook/useNotebookRuntime'
import { useNotebookVisualContext } from '../runtime/notebook/useNotebookVisualContext'

/**
 * The Free Lab / open sandbox — exactly what `App.tsx` rendered inline
 * before Sprint 13, now its own component so it can be mounted or
 * unmounted independently of the lesson catalog/workspace/progress views
 * without losing its own persisted state (it always reloads from
 * IndexedDB, sprint brief "Free Lab Must Survive").
 */
export function NotebookWorkspace() {
  const { notebook, datasets, models, queries, queryEvaluations, status, actions } = useNotebookRuntime()
  const hasCells = notebook.cells.length > 0
  const [validationRuns, setValidationRuns] = useState<Record<string, ValidationRun>>({})
  const visualContext = useNotebookVisualContext()

  const slicerSelections = useMemo(() => {
    const selections: Record<string, unknown[]> = {}
    for (const [cellId, filter] of Object.entries(visualContext.bySlicer)) {
      selections[cellId] = filter.values
    }
    return selections
  }, [visualContext.bySlicer])

  function handleSlicerChange(cellId: string, values: unknown[]) {
    const cell = notebook.cells.find((c) => c.id === cellId)
    if (!cell || cell.kind !== 'visual' || cell.visual.type !== 'slicer') return
    const filter = buildSlicerFilter(cell.visual.column, values, cell.visual.mode)
    visualContext.setSlicerFilter(cellId, filter)
  }

  const testCells = useMemo(() => notebook.cells.filter((cell) => cell.kind === 'test'), [notebook.cells])

  const { currentRuns, staleTestCellIds } = useMemo(() => {
    const current: Record<string, ValidationRun> = {}
    const stale = new Set<string>()
    for (const cell of testCells) {
      const run = validationRuns[cell.id]
      if (!run) continue
      if (!isValidationRunStale(run, { models, datasets, queries, queryEvaluations }, cell)) {
        current[cell.id] = run
      } else {
        stale.add(cell.id)
      }
    }
    return { currentRuns: current, staleTestCellIds: stale }
  }, [testCells, validationRuns, models, datasets, queries, queryEvaluations])

  const notebookScore = useMemo(() => computeNotebookScore(Object.values(currentRuns)), [currentRuns])

  function handleRunValidation(cellId: string) {
    const cell = notebook.cells.find((c) => c.id === cellId)
    if (!cell || cell.kind !== 'test') return
    const run = runValidation({ datasets, models, queries, queryEvaluations }, cell)
    setValidationRuns((runs) => ({ ...runs, [cellId]: run }))
  }

  return (
    <section className="workspace">
      <header className="workspace__header">
        <div>
          <span className="eyebrow">BEGINNER · RETAIL</span>
          <h1>{notebook.title}</h1>
          <p>Import a dataset, inspect its schema and profile, then keep building on it.</p>
        </div>
        {testCells.length > 0 && Object.keys(currentRuns).length > 0 && (
          <div className="notebook-score">
            <span className="notebook-score__label">Notebook Score</span>
            <span className="notebook-score__value">
              {Math.round(notebookScore.pointsEarned * 10) / 10} / {notebookScore.pointsPossible}
            </span>
          </div>
        )}
      </header>

      {status === 'loading' ? (
        <p className="workspace__status">Loading notebook…</p>
      ) : !hasCells ? (
        <div className="empty-state">
          <h2>Add your first dataset</h2>
          <p>Import a CSV or Excel file, or start from the built-in retail dataset.</p>
          <ImportDataPanel onImportDataset={actions.importDataset} />
        </div>
      ) : (
        <NotebookBody
          notebook={notebook}
          datasets={datasets}
          models={models}
          queries={queries}
          queryEvaluations={queryEvaluations}
          actions={actions}
          currentValidationRuns={currentRuns}
          staleTestCellIds={staleTestCellIds}
          onRunValidation={handleRunValidation}
          notebookVisualContext={visualContext.filterContext}
          slicerSelections={slicerSelections}
          onSlicerChange={handleSlicerChange}
        />
      )}
    </section>
  )
}
