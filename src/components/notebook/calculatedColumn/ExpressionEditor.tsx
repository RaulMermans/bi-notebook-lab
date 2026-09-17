import type { ExpressionDiagnostic } from '../../../expression/diagnostics'

interface ExpressionEditorProps {
  value: string
  onChange: (value: string) => void
  onRun: () => void
  diagnostics: ExpressionDiagnostic[]
  running?: boolean
  runLabel?: string
}

/**
 * A plain monospace textarea + Run button, deliberately not a full IDE
 * (docs/CALCULATED_COLUMNS.md "Expression editor" — Sprint 3 prioritizes
 * runtime correctness over editor polish).
 */
export function ExpressionEditor({ value, onChange, onRun, diagnostics, running, runLabel = 'Run' }: ExpressionEditorProps) {
  return (
    <div className="expression-editor">
      <textarea
        className="expression-editor__textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        spellCheck={false}
        placeholder="Sales[Revenue] - Sales[Cost]"
      />
      <button type="button" className="primary-button" onClick={onRun} disabled={running || value.trim() === ''}>
        {running ? 'Running…' : runLabel}
      </button>

      {diagnostics.length > 0 && (
        <ul className="diagnostic-list">
          {diagnostics.map((d, index) => (
            <li key={index} className={`diagnostic diagnostic--${d.severity}`}>
              <strong>{d.code}</strong> — {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
