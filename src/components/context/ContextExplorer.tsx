import { useMemo, useState } from 'react'
import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { ColumnFilter } from '../../runtime/measure/filterContext'
import { analyzeMeasureContext } from '../../runtime/context/contextAnalysis'
import { MeasureTraceVisualizer } from '../notebook/measure/MeasureTraceVisualizer'
import { ContextComparison } from './ContextComparison'
import { ContextDetailsPanel } from './ContextDetailsPanel'
import { ContextFilterEditor } from './ContextFilterEditor'
import { ContextFlowNarrative } from './ContextFlowNarrative'
import { ContextPropagationDiagram } from './ContextPropagationDiagram'
import { MeasureDependencyTree } from './MeasureDependencyTree'
import { RowVsFilterContextNote } from './RowVsFilterContextNote'

interface ContextExplorerProps {
  model: SemanticModel
  datasets: Record<string, Dataset>
}

/**
 * A reusable, first-class surface for exploring how `FilterContext`
 * propagates through the semantic model (Sprint 6) — usable from any
 * `ModelCell`, independent of any one `MeasureCellCard` (brief §5/§6). All
 * visualization state is derived from `analyzeMeasureContext`, which itself
 * only composes existing Sprint 4 runtime output — see
 * docs/CONTEXT_VISUALIZER.md.
 */
export function ContextExplorer({ model, datasets }: ContextExplorerProps) {
  const [measureId, setMeasureId] = useState(model.measures[0]?.id ?? '')
  const [filters, setFilters] = useState<ColumnFilter[]>([])
  const [selectedTableId, setSelectedTableId] = useState<string | undefined>(undefined)
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | undefined>(undefined)
  const [showTechnicalTrace, setShowTechnicalTrace] = useState(false)

  const measure = model.measures.find((m) => m.id === measureId)

  const analysis = useMemo(() => {
    if (!measure) return undefined
    return analyzeMeasureContext({ model, datasets, measureId: measure.id, filterContext: { filters } })
  }, [model, datasets, measure, filters])

  if (model.measures.length === 0) {
    return (
      <div className="context-explorer context-explorer--empty">
        <p>Create a measure first to explore filter context.</p>
      </div>
    )
  }

  function selectTable(id: string) {
    setSelectedRelationshipId(undefined)
    setSelectedTableId((current) => (current === id ? undefined : id))
  }

  function selectRelationship(id: string) {
    setSelectedTableId(undefined)
    setSelectedRelationshipId((current) => (current === id ? undefined : id))
  }

  const selectedTable = analysis?.tables?.find((t) => t.modelTableId === selectedTableId)
  const selectedRelationship = analysis?.relationships?.find((r) => r.relationshipId === selectedRelationshipId)

  return (
    <div className="context-explorer">
      <div className="context-explorer__measure-picker">
        <label>
          Measure
          <select
            value={measureId}
            onChange={(e) => {
              setMeasureId(e.target.value)
              setSelectedTableId(undefined)
              setSelectedRelationshipId(undefined)
            }}
          >
            {model.measures.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {measure && (
        <pre className="calculated-column-expression-preview">
          <code>{measure.expression}</code>
        </pre>
      )}

      {analysis && (
        <>
          <ContextFilterEditor model={model} datasets={datasets} filters={filters} onChange={setFilters} />

          <ContextComparison measureName={analysis.measureName} comparison={analysis.comparison} hasFilters={filters.length > 0} />

          {analysis.invalid ? (
            <div className="context-explorer__invalid">
              <p>Context cannot be resolved.</p>
              <p>{analysis.invalid.message}</p>
              <p>Fix the model before exploring filter propagation.</p>
            </div>
          ) : (
            <>
              <section className="context-explorer__section">
                <h3>Relationship Propagation</h3>
                <ContextPropagationDiagram
                  tables={analysis.tables ?? []}
                  relationships={analysis.relationships ?? []}
                  selectedTableId={selectedTableId}
                  selectedRelationshipId={selectedRelationshipId}
                  onSelectTable={selectTable}
                  onSelectRelationship={selectRelationship}
                />
                <ContextDetailsPanel
                  tables={analysis.tables ?? []}
                  selectedTable={selectedTable}
                  selectedRelationship={selectedRelationship}
                />
              </section>

              <section className="context-explorer__section">
                <ContextFlowNarrative narrative={analysis.narrative} beginnerExplanation={analysis.beginnerExplanation} />
              </section>

              {analysis.current.trace && (
                <section className="context-explorer__section">
                  <MeasureDependencyTree trace={analysis.current.trace} />
                </section>
              )}

              <section className="context-explorer__section">
                <button type="button" className="text-button" onClick={() => setShowTechnicalTrace((v) => !v)}>
                  {showTechnicalTrace ? 'Hide' : 'Show'} technical execution trace
                </button>
                {showTechnicalTrace && analysis.current.trace && <MeasureTraceVisualizer trace={analysis.current.trace} />}
              </section>
            </>
          )}

          <section className="context-explorer__section">
            <RowVsFilterContextNote />
          </section>
        </>
      )}
    </div>
  )
}
