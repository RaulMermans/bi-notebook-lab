import { NotebookCellCard } from './components/NotebookCellCard'
import { sampleNotebook } from './data/sampleNotebook'
import './styles/app.css'

export default function App() {
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
            <h1>{sampleNotebook.title}</h1>
            <p>{sampleNotebook.description}</p>
          </div>
          <button className="secondary-button">Reset notebook</button>
        </header>

        <div className="notebook">
          {sampleNotebook.cells.map((cell) => (
            <NotebookCellCard key={cell.id} cell={cell} />
          ))}
        </div>
      </section>
    </main>
  )
}
