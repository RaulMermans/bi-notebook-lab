import type { NotebookCell } from '../domain/notebook'

const labels: Record<NotebookCell['kind'], string> = {
  markdown: 'NOTE',
  data: 'DATA',
  model: 'MODEL',
  'calculated-column': 'COLUMN',
  measure: 'MEASURE',
  visual: 'VISUAL',
  question: 'QUESTION',
  test: 'TEST',
}

export function NotebookCellCard({ cell }: { cell: NotebookCell }) {
  return (
    <article className="cell">
      <div className="cell__rail">
        <span>{labels[cell.kind]}</span>
      </div>
      <div className="cell__body">
        <div className="cell__header">
          <h2>{cell.title}</h2>
          {cell.status && <span className={`status status--${cell.status}`}>{cell.status}</span>}
        </div>
        {cell.prompt && <p>{cell.prompt}</p>}
        {cell.source && <pre><code>{cell.source}</code></pre>}
        {cell.kind !== 'markdown' && (
          <button type="button" className="run-button">Run cell</button>
        )}
      </div>
    </article>
  )
}
