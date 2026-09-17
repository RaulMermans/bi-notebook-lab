import { CreateCalculatedColumnPanel } from './components/notebook/CreateCalculatedColumnPanel'
import { CreateMeasurePanel } from './components/notebook/CreateMeasurePanel'
import { ImportDataPanel } from './components/notebook/ImportDataPanel'
import { NotebookCell } from './components/notebook/NotebookCell'
import { useNotebookRuntime } from './runtime/notebook/useNotebookRuntime'
import './styles/app.css'

export default function App() {
  const { notebook, datasets, models, status, actions } = useNotebookRuntime()
  const hasCells = notebook.cells.length > 0

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
              />
            ))}
            <div className="notebook__add-actions">
              <ImportDataPanel onImportDataset={actions.importDataset} compact />
              <button type="button" className="secondary-button" onClick={() => actions.createModelCell()}>
                + New model
              </button>
              <CreateCalculatedColumnPanel models={models} datasets={datasets} onCreate={actions.createCalculatedColumnCell} />
              <CreateMeasurePanel models={models} datasets={datasets} onCreate={actions.createMeasureCell} />
            </div>
          </div>
        )}
      </section>
    </main>
  )
}
