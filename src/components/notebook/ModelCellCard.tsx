import { useMemo, useState } from 'react'
import type { ModelCell } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import type { ColumnRef, RelationshipDiagnostic, SemanticModel, TableRef } from '../../domain/model'
import type { DateTableDiagnostic } from '../../runtime/dateTable/dateTableTypes'
import { resolveColumnRef } from '../../runtime/model/modelRuntime'
import { validateModel } from '../../runtime/model/graphAnalysis'
import { ContextExplorer } from '../context/ContextExplorer'
import { DateTableControls } from './model/DateTableControls'
import { ModelCanvas } from './model/ModelCanvas'
import { ModelHealthSummary, modelHealthLabel } from './model/ModelHealthSummary'
import { RelationshipForm } from './model/RelationshipForm'
import { TableRegistrationPanel } from './model/TableRegistrationPanel'

type ModelCellView = 'model' | 'context'

interface ModelCellCardProps {
  cell: ModelCell
  model: SemanticModel | undefined
  datasets: Record<string, Dataset>
  onRemoveModel: () => void
  onAddTable: (ref: TableRef) => void
  onRemoveTable: (modelTableId: string) => void
  onMoveTable: (modelTableId: string, position: { x: number; y: number }) => void
  onCreateRelationship: (input: { one: ColumnRef; many: ColumnRef; active: boolean }) => Promise<RelationshipDiagnostic[]>
  onRemoveRelationship: (relationshipId: string) => void
  onSetRelationshipActive: (relationshipId: string, active: boolean) => void
  onMarkDateTable: (modelTableId: string, dateColumn: ColumnRef) => Promise<DateTableDiagnostic[]>
  onUnmarkDateTable: (modelTableId: string) => void
}

function columnLabel(datasets: Record<string, Dataset>, ref: ColumnRef): string {
  const resolved = resolveColumnRef(datasets, ref)
  if (!resolved) return 'Unknown column'
  return `${resolved.table.name}[${resolved.column.name}]`
}

export function ModelCellCard({
  cell,
  model,
  datasets,
  onRemoveModel,
  onAddTable,
  onRemoveTable,
  onMoveTable,
  onCreateRelationship,
  onRemoveRelationship,
  onSetRelationshipActive,
  onMarkDateTable,
  onUnmarkDateTable,
}: ModelCellCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState<ModelCellView>('model')

  const diagnostics = useMemo(() => (model ? validateModel(model, datasets) : []), [model, datasets])

  if (!model) {
    return (
      <article className="cell cell--model cell--missing">
        <div className="cell__rail">
          <span>MODEL</span>
        </div>
        <div className="cell__body">
          <p>Model for &quot;{cell.title}&quot; is missing. It may still be loading.</p>
        </div>
      </article>
    )
  }

  const health = modelHealthLabel(diagnostics)

  return (
    <article className="cell cell--model">
      <div className="cell__rail">
        <span>MODEL</span>
      </div>
      <div className="cell__body">
        <div className="cell__header">
          <div>
            <h2>{model.name}</h2>
            <p className="cell__meta">
              {model.tables.length} table{model.tables.length === 1 ? '' : 's'} · {model.relationships.length} relationship
              {model.relationships.length === 1 ? '' : 's'} ·{' '}
              <span className={`health-badge health-badge--${health.tone}`}>{health.label}</span>
            </p>
          </div>
          <div className="cell__header-actions">
            <button type="button" className="text-button" onClick={() => setExpanded((v) => !v)}>
              {expanded ? 'Collapse' : 'Expand'}
            </button>
            <button type="button" className="text-button" onClick={onRemoveModel}>
              Remove
            </button>
          </div>
        </div>

        {expanded && (
          <div className="model-expanded">
            <div className="model-view-tabs" role="tablist" aria-label="Model view">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'model'}
                className={`model-view-tabs__tab ${view === 'model' ? 'model-view-tabs__tab--active' : ''}`}
                onClick={() => setView('model')}
              >
                Model
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'context'}
                className={`model-view-tabs__tab ${view === 'context' ? 'model-view-tabs__tab--active' : ''}`}
                onClick={() => setView('context')}
              >
                Context Explorer
              </button>
            </div>

            {/* Both views stay mounted — only hidden — so switching tabs never resets the
                Context Explorer's in-progress filter selection (e.g. toggling a relationship
                active/inactive on the Model tab and coming straight back to see the effect). */}
            <div hidden={view !== 'model'}>
              <section className="model-section">
                <h3>Available tables</h3>
                <TableRegistrationPanel model={model} datasets={datasets} onAddTable={onAddTable} />
              </section>

              {model.tables.length > 0 && (
                <section className="model-section">
                  <h3>Canvas</h3>
                  <ModelCanvas model={model} datasets={datasets} onMoveTable={onMoveTable} />
                  <ul className="model-table-list">
                    {model.tables.map((table) => (
                      <li key={table.id}>
                        <span>{datasets[table.datasetId]?.tables.find((t) => t.id === table.tableId)?.name ?? table.tableId}</span>
                        <DateTableControls
                          model={model}
                          datasets={datasets}
                          table={table}
                          onMarkDateTable={onMarkDateTable}
                          onUnmarkDateTable={onUnmarkDateTable}
                        />
                        <button type="button" className="text-button" onClick={() => onRemoveTable(table.id)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {model.tables.length >= 2 && (
                <section className="model-section">
                  <h3>Create relationship</h3>
                  <RelationshipForm model={model} datasets={datasets} onCreateRelationship={onCreateRelationship} />
                </section>
              )}

              {model.relationships.length > 0 && (
                <section className="model-section">
                  <h3>Relationships</h3>
                  <ul className="relationship-list">
                    {model.relationships.map((relationship) => (
                      <li key={relationship.id} className={relationship.active ? '' : 'relationship-list__item--inactive'}>
                        <span>
                          {columnLabel(datasets, relationship.one)} <strong>1 → *</strong> {columnLabel(datasets, relationship.many)}
                        </span>
                        <label className="relationship-list__active">
                          <input
                            type="checkbox"
                            checked={relationship.active}
                            onChange={(e) => onSetRelationshipActive(relationship.id, e.target.checked)}
                          />
                          Active
                        </label>
                        <button type="button" className="text-button" onClick={() => onRemoveRelationship(relationship.id)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <section className="model-section">
                <h3>Model health</h3>
                <ModelHealthSummary diagnostics={diagnostics} />
              </section>
            </div>

            <div hidden={view !== 'context'}>
              <section className="model-section">
                <ContextExplorer model={model} datasets={datasets} />
              </section>
            </div>
          </div>
        )}
      </div>
    </article>
  )
}
