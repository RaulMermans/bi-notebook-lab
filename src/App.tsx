import { useMemo, useState } from 'react'
import { AddTestCellPanel } from './components/notebook/AddTestCellPanel'
import { AddVisualCellPanel } from './components/notebook/AddVisualCellPanel'
import { CreateCalculatedColumnPanel } from './components/notebook/CreateCalculatedColumnPanel'
import { CreateMeasurePanel } from './components/notebook/CreateMeasurePanel'
import { ImportDataPanel } from './components/notebook/ImportDataPanel'
import { NotebookCell } from './components/notebook/NotebookCell'
import type { ValidationRun } from './domain/validation'
import { buildSlicerFilter } from './runtime/visual/visualRuntime'
import { isValidationRunStale } from './runtime/validation/fingerprint'
import { computeNotebookScore } from './runtime/validation/scoring'
import { runValidation } from './runtime/validation/validationEngine'
import { useNotebookRuntime } from './runtime/notebook/useNotebookRuntime'
import { useNotebookVisualContext } from './runtime/notebook/useNotebookVisualContext'
import './styles/app.css'

export default function App() {
  const { notebook, datasets, models, status, actions } = useNotebookRuntime()
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
      const model = models[cell.modelId]
      if (model && !isValidationRunStale(run, model, datasets, cell.validation)) {
        current[cell.id] = run
      } else {
        stale.add(cell.id)
      }
    }
    return { currentRuns: current, staleTestCellIds: stale }
  }, [testCells, validationRuns, models, datasets])

  const notebookScore = useMemo(() => computeNotebookScore(Object.values(currentRuns)), [currentRuns])

  function handleRunValidation(cellId: string) {
    const cell = notebook.cells.find((c) => c.id === cellId)
    if (!cell || cell.kind !== 'test') return
    const run = runValidation({ datasets, models }, cell)
    setValidationRuns((runs) => ({ ...runs, [cellId]: run }))
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">BI NOTEBOOK LAB</div>
        <nav>
          <button className="nav-item nav-item--active">Notebook</button>
          <button className="nav-item">Datasets</button>
          <button className="nav-item">Exercises</button>
          <button className="nav-item">Progress</button>
        </nav>
      </aside>

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
          <div className="notebook">
            {notebook.cells.map((cell) => (
              <NotebookCell
                key={cell.id}
                cell={cell}
                datasets={datasets}
                models={models}
                onRemoveDataset={actions.removeDataset}
                onRemoveModel={actions.removeModel}
                onAddTableToModel={actions.addTableToModel}
                onRemoveTableFromModel={actions.removeTableFromModel}
                onMoveModelTable={actions.moveModelTable}
                onCreateRelationship={actions.createRelationship}
                onRemoveRelationship={actions.removeRelationship}
                onSetRelationshipActive={actions.setRelationshipActive}
                onUpdateCalculatedColumn={actions.updateCalculatedColumn}
                onRemoveCalculatedColumnCell={actions.removeCalculatedColumnCell}
                onUpdateMeasure={actions.updateMeasure}
                onRemoveMeasureCell={actions.removeMeasureCell}
                currentValidationRuns={currentRuns}
                staleTestCellIds={staleTestCellIds}
                onRunValidation={handleRunValidation}
                onRemoveTestCell={actions.removeTestCell}
                notebookVisualContext={visualContext.filterContext}
                slicerSelections={slicerSelections}
                onSlicerChange={handleSlicerChange}
                onUpdateVisualCell={actions.updateVisualCell}
                onRemoveVisualCell={actions.removeVisualCell}
              />
            ))}
            <div className="notebook__add-actions">
              <ImportDataPanel onImportDataset={actions.importDataset} compact />
              <button type="button" className="secondary-button" onClick={() => actions.createModelCell()}>
                + New model
              </button>
              <CreateCalculatedColumnPanel models={models} datasets={datasets} onCreate={actions.createCalculatedColumnCell} />
              <CreateMeasurePanel models={models} datasets={datasets} onCreate={actions.createMeasureCell} />
              <AddTestCellPanel models={models} onCreate={actions.createTestCell} />
              <AddVisualCellPanel models={models} datasets={datasets} onCreate={actions.createVisualCell} />
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
