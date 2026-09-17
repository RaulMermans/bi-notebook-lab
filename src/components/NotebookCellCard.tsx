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
  const prompt = cell.kind !== 'data' && cell.kind !== 'model' ? cell.prompt : undefined
  const source = cell.kind !== 'data' && cell.kind !== 'model' ? cell.source : undefined

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
        {prompt && <p>{prompt}</p>}
        {source && <pre><code>{source}</code></pre>}
        {cell.kind !== 'markdown' && (
          <button type="button" className="run-button">Run cell</button>
        )}
      </div>
    </article>
  )
}
