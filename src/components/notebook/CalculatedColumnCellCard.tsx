import { useEffect, useMemo, useState } from 'react'
import type { CalculatedColumnCell } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import type { CalculatedColumn, SemanticModel } from '../../domain/model'
import type { ExpressionDiagnostic } from '../../expression/diagnostics'
import { evaluateCalculatedColumn, type CalculatedColumnExecution } from '../../runtime/calculatedColumn/calculatedColumnRuntime'
import { resolveTableRef } from '../../runtime/model/modelRuntime'
import { CalculatedColumnPreview } from './calculatedColumn/CalculatedColumnPreview'
import { ExpressionEditor } from './calculatedColumn/ExpressionEditor'
import { RowContextVisualizer } from './calculatedColumn/RowContextVisualizer'

interface CalculatedColumnCellCardProps {
  cell: CalculatedColumnCell
  model: SemanticModel | undefined
  datasets: Record<string, Dataset>
  onUpdate: (patch: {
    name?: string
    expression?: string
  }) => Promise<{ calculatedColumn?: CalculatedColumn; execution?: CalculatedColumnExecution; diagnostics: ExpressionDiagnostic[] }>
  onRemove: () => void
}

/**
 * A real, running calculated column: expression editor, live preview
 * (recomputed from current model/dataset state, never a cached snapshot),
 * and a row-context visualizer driven entirely by the runtime's own
 * execution trace (docs/CALCULATED_COLUMNS.md).
 */
export function CalculatedColumnCellCard({ cell, model, datasets, onUpdate, onRemove }: CalculatedColumnCellCardProps) {
  const [expanded, setExpanded] = useState(false)
  const calculatedColumn = model?.calculatedColumns.find((c) => c.id === cell.calculatedColumnId)
  const [draftExpression, setDraftExpression] = useState(calculatedColumn?.expression ?? '')
  const [runDiagnostics, setRunDiagnostics] = useState<ExpressionDiagnostic[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [selectedRowIndex, setSelectedRowIndex] = useState<number | null>(null)

  useEffect(() => {
    setDraftExpression(calculatedColumn?.expression ?? '')
  }, [calculatedColumn?.expression])

  const execution = useMemo(() => {
    if (!model || !calculatedColumn) return undefined
    return evaluateCalculatedColumn(model, datasets, calculatedColumn.id)
  }, [model, datasets, calculatedColumn])

  if (!model || !calculatedColumn) {
    return (
      <article className="cell cell--calculated-column cell--missing">
        <div className="cell__rail">
          <span>fx COLUMN</span>
        </div>
        <div className="cell__body">
          <p>Calculated column for &quot;{cell.title}&quot; is missing. It may still be loading.</p>
        </div>
      </article>
    )
  }

  const modelTable = model.tables.find((t) => t.id === calculatedColumn.modelTableId)
  const resolvedTable = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  const tableName = resolvedTable?.table.name ?? 'Unknown table'
  const sourceColumns = resolvedTable?.table.columns ?? []
  const previewRows = execution ? (resolvedTable?.table.rows.slice(0, execution.previewTraces.length) ?? []) : []

  async function handleRun() {
    setSubmitting(true)
    try {
      const result = await onUpdate({ expression: draftExpression })
      setRunDiagnostics(result.diagnostics)
      if (result.calculatedColumn) setSelectedRowIndex(null)
    } finally {
      setSubmitting(false)
    }
  }

  const selectedTrace =
    selectedRowIndex !== null ? execution?.previewTraces.find((t) => t.rowIndex === selectedRowIndex) : undefined

  const hasColumnErrors = (execution?.columnDiagnostics.length ?? 0) > 0

  return (
    <article className="cell cell--calculated-column">
      <div className="cell__rail">
        <span>fx COLUMN</span>
      </div>
      <div className="cell__body">
        <div className="cell__header">
          <div>
            <h2>{calculatedColumn.name}</h2>
            <p className="cell__meta">
              {tableName} · {calculatedColumn.dataType}
              {execution && !hasColumnErrors && ` · ${execution.values.length.toLocaleString()} rows evaluated`}
              {execution && execution.errors.length > 0 && ` · ${execution.errors.length} row error${execution.errors.length === 1 ? '' : 's'}`}
            </p>
          </div>
          <div className="cell__header-actions">
            <button type="button" className="text-button" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Collapse' : 'Expand'}
            </button>
            <button type="button" className="text-button" onClick={onRemove}>
              Remove
            </button>
          </div>
        </div>

        <pre className="calculated-column-expression-preview">
          <code>{calculatedColumn.expression}</code>
        </pre>

        {hasColumnErrors && execution && (
          <ul className="diagnostic-list">
            {execution.columnDiagnostics.map((d, index) => (
              <li key={index} className={`diagnostic diagnostic--${d.severity}`}>
                {d.message}
              </li>
            ))}
          </ul>
        )}

        {expanded && (
          <div className="calculated-column-expanded">
            <ExpressionEditor
              value={draftExpression}
              onChange={setDraftExpression}
              onRun={handleRun}
              diagnostics={runDiagnostics}
              running={submitting}
              runLabel="Run"
            />

            {execution && !hasColumnErrors && (
              <>
                <CalculatedColumnPreview
                  resultColumnName={calculatedColumn.name}
                  sourceColumns={sourceColumns}
                  rows={previewRows}
                  values={execution.values}
                  totalRowCount={execution.values.length}
                  selectedRowIndex={selectedRowIndex}
                  onSelectRow={setSelectedRowIndex}
                />

                {selectedTrace && (
                  <RowContextVisualizer
                    tableName={tableName}
                    rowIndex={selectedTrace.rowIndex}
                    row={previewRows[selectedTrace.rowIndex]}
                    sourceColumns={sourceColumns}
                    trace={selectedTrace.trace}
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
