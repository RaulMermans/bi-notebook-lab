import type { ModelDiagnostic } from '../../../domain/model'

interface ModelHealthSummaryProps {
  diagnostics: ModelDiagnostic[]
}

export function ModelHealthSummary({ diagnostics }: ModelHealthSummaryProps) {
  if (diagnostics.length === 0) {
    return <p className="model-health__empty">Add tables and relationships to see model diagnostics.</p>
  }

  return (
    <ul className="diagnostic-list">
      {diagnostics.map((d, index) => (
        <li key={index} className={`diagnostic diagnostic--${d.severity}`}>
          {d.message}
        </li>
      ))}
    </ul>
  )
}

export function modelHealthLabel(diagnostics: ModelDiagnostic[]): { label: string; tone: 'valid' | 'warning' | 'error' } {
  if (diagnostics.some((d) => d.severity === 'error')) return { label: 'Invalid', tone: 'error' }
  if (diagnostics.some((d) => d.severity === 'warning')) return { label: 'Needs review', tone: 'warning' }
  if (diagnostics.some((d) => d.code === 'STAR_SCHEMA_VALID')) return { label: 'Valid star schema', tone: 'valid' }
  return { label: 'No issues found', tone: 'valid' }
}
