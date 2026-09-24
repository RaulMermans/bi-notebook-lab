import { useEffect, useMemo, useState } from 'react'
import type { MeasureCell } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import type { Measure, SemanticModel } from '../../domain/model'
import type { ExpressionDiagnostic } from '../../expression/diagnostics'
import type { ColumnFilter } from '../../runtime/measure/filterContext'
import { evaluateMeasure, type MeasureExecution } from '../../runtime/measure/measureRuntime'
import type { RemovalResult } from '../../runtime/notebook/notebookRuntime'
import { resolveTableRef } from '../../runtime/model/modelRuntime'
import { ContextFilterEditor } from '../context/ContextFilterEditor'
import { ExpressionEditor } from './calculatedColumn/ExpressionEditor'
import { MeasureTraceVisualizer } from './measure/MeasureTraceVisualizer'
import { BlockedActionNotice } from '../common/BlockedActionNotice'
import type { WorkspaceIntegrityIssue } from '../../runtime/integrity/types'

interface MeasureCellCardProps {
  cell: MeasureCell
  model: SemanticModel | undefined
  datasets: Record<string, Dataset>
  onUpdate: (patch: { name?: string; expression?: string }) => Promise<{ measure?: Measure; execution?: MeasureExecution; diagnostics: ExpressionDiagnostic[] }>
  onRemove: () => Promise<RemovalResult>
}

function formatMeasureValue(value: unknown): string {
  if (value === null || value === undefined) return 'BLANK'
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return String(value)
}

/**
 * A real, running measure: expression editor, an evaluation-context panel
 * for testing filters, a no-filter/current-context comparison, and a trace
 * visualizer driven entirely by the runtime's own execution trace
 * (docs/MEASURES.md, docs/FILTER_CONTEXT.md).
 */
export function MeasureCellCard({ cell, model, datasets, onUpdate, onRemove }: MeasureCellCardProps) {
  const [expanded, setExpanded] = useState(false)
  const measure = model?.measures.find((m) => m.id === cell.measureId)
  const [draftExpression, setDraftExpression] = useState(measure?.expression ?? '')
  const [runDiagnostics, setRunDiagnostics] = useState<ExpressionDiagnostic[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [filters, setFilters] = useState<ColumnFilter[]>([])
  const [removeBlockers, setRemoveBlockers] = useState<WorkspaceIntegrityIssue[]>([])

  useEffect(() => {
    setDraftExpression(measure?.expression ?? '')
  }, [measure?.expression])

  const unfilteredExecution = useMemo(() => {
    if (!model || !measure) return undefined
    return evaluateMeasure(model, datasets, measure.id)
  }, [model, datasets, measure])

  const filteredExecution = useMemo(() => {
    if (!model || !measure) return undefined
    if (filters.length === 0) return unfilteredExecution
    return evaluateMeasure(model, datasets, measure.id, { filters })
  }, [model, datasets, measure, filters, unfilteredExecution])

  if (!model || !measure) {
    return (
      <article className="cell cell--measure cell--missing">
        <div className="cell__rail">
          <span>∑ MEASURE</span>
        </div>
        <div className="cell__body">
          <p>Measure for &quot;{cell.title}&quot; is missing. It may still be loading.</p>
        </div>
      </article>
    )
  }

  const homeTable = model.tables.find((t) => t.id === measure.homeModelTableId)
  const homeTableName = homeTable ? (resolveTableRef(datasets, homeTable)?.table.name ?? 'Unknown table') : 'Unknown table'
  const activeExecution = filteredExecution ?? unfilteredExecution
  const hasErrors = (activeExecution?.diagnostics.length ?? 0) > 0

  async function handleRun() {
    setSubmitting(true)
    try {
      const result = await onUpdate({ expression: draftExpression })
      setRunDiagnostics(result.diagnostics)
    } finally {
      setSubmitting(false)
    }
  }

  const measureName = measure.name

  async function handleRemove() {
    const result = await onRemove()
    setRemoveBlockers(result.removed ? [] : (result.blockers ?? []))
  }

  return (
    <article className="cell cell--measure">
      <div className="cell__rail">
        <span>∑ MEASURE</span>
      </div>
      <div className="cell__body">
        <div className="cell__header">
          <div>
            <h2>{measure.name}</h2>
            <p className="cell__meta">
              {homeTableName} · {measure.dataType}
            </p>
          </div>
          <div className="cell__header-actions">
            <button type="button" className="text-button" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Collapse' : 'Expand'}
            </button>
            <button type="button" className="text-button" onClick={handleRemove}>
              Remove
            </button>
          </div>
        </div>

        <BlockedActionNotice title={`Can't remove "${measureName}".`} blockers={removeBlockers} />

        <pre className="calculated-column-expression-preview">
          <code>{measure.expression}</code>
        </pre>

        {hasErrors && activeExecution && (
          <ul className="diagnostic-list">
            {activeExecution.diagnostics.map((d, index) => (
              <li key={index} className={`diagnostic diagnostic--${d.severity}`}>
                <strong>{d.code}</strong> — {d.message}
              </li>
            ))}
          </ul>
        )}

        {!hasErrors && activeExecution && (
          <div className="measure-result">
            {filters.length === 0 ? (
              <p className="measure-result__value">{formatMeasureValue(activeExecution.value)}</p>
            ) : (
              <div className="measure-result__comparison">
                <div>
                  <span className="measure-result__label">No filters</span>
                  <span className="measure-result__value">{formatMeasureValue(unfilteredExecution?.value)}</span>
                </div>
                <div>
                  <span className="measure-result__label">Current context</span>
                  <span className="measure-result__value">{formatMeasureValue(activeExecution.value)}</span>
                </div>
              </div>
            )}
          </div>
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

            <ContextFilterEditor model={model} datasets={datasets} filters={filters} onChange={setFilters} />

            {!hasErrors && activeExecution?.trace && <MeasureTraceVisualizer trace={activeExecution.trace} />}
          </div>
        )}
      </div>
    </article>
  )
}
