import type { ContextRelationshipState, ContextTableState } from '../../domain/context'
import { relationshipCardinalityLabel } from '../../lib/format/relationshipLabel'

const OVERRIDE_REASON_LABEL: Record<NonNullable<ContextRelationshipState['overrideReason']>, string> = {
  'activated-by-userelationship': 'Temporarily activated by USERELATIONSHIP for this calculation',
  'suppressed-by-userelationship': 'Suppressed for this calculation — a competing relationship was activated by USERELATIONSHIP',
  'crossfilter-direction-override': 'Direction temporarily changed by CROSSFILTER for this calculation',
  'crossfilter-none': 'Temporarily disabled by CROSSFILTER(..., NONE) for this calculation',
}

interface ContextDetailsPanelProps {
  tables: ContextTableState[]
  selectedTable: ContextTableState | undefined
  selectedRelationship: ContextRelationshipState | undefined
}

function TableDetails({ table }: { table: ContextTableState }) {
  const filteredOut = table.totalRows - table.visibleRows
  return (
    <div className="context-details">
      <h4>{table.tableName}</h4>
      <dl className="context-details__stats">
        <div>
          <dt>Total rows</dt>
          <dd>{table.totalRows.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Visible rows</dt>
          <dd>{table.visibleRows.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Filtered out</dt>
          <dd>{filteredOut.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Visible %</dt>
          <dd>{table.percentVisible.toFixed(2)}%</dd>
        </div>
      </dl>

      <h5>Direct filters</h5>
      {table.directFilters.length === 0 ? (
        <p className="context-details__empty">None</p>
      ) : (
        <ul className="context-details__list">
          {table.directFilters.map((f, i) => (
            <li key={i}>
              {f.columnName} {f.operator === 'in' ? 'in' : '='} {f.values.map(String).join(', ')}
            </li>
          ))}
        </ul>
      )}

      <h5>Incoming propagated filters</h5>
      {table.incomingPropagation.length === 0 ? (
        <p className="context-details__empty">None</p>
      ) : (
        <ul className="context-details__list">
          {table.incomingPropagation.map((p, i) => (
            <li key={i}>
              {p.sourceTableName}[{p.sourceColumnName}]
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RelationshipDetails({ relationship, tables }: { relationship: ContextRelationshipState; tables: ContextTableState[] }) {
  const tableName = (modelTableId: string) => tables.find((t) => t.modelTableId === modelTableId)?.tableName ?? 'Unknown table'

  return (
    <div className="context-details">
      <h4>Relationship Propagation</h4>
      <p className="context-details__direction">
        {relationship.leftColumnName}
        <br />
        {relationshipCardinalityLabel(relationship.cardinality, relationship.crossFilterDirection, relationship.oneSide)}
        <br />
        {relationship.rightColumnName}
      </p>
      <p className="context-details__note">
        Model: {relationship.active ? 'Active' : 'Inactive'} ({relationship.cardinality})
      </p>

      {relationship.overrideReason && (
        <p className="context-details__note context-details__note--override">{OVERRIDE_REASON_LABEL[relationship.overrideReason]}</p>
      )}

      {!relationship.effectiveActive && (
        <p className="context-details__note">This relationship is not participating in filter propagation right now.</p>
      )}

      {relationship.effectiveActive && relationship.state === 'active-no-effect' && (
        <p className="context-details__note">This relationship is active, but had no effect under the current filters.</p>
      )}

      {relationship.propagation.length > 0 && (
        <dl className="context-details__stats">
          {relationship.propagation.map((p, i) => (
            <div key={i}>
              <dt>
                {tableName(p.targetModelTableId)} rows ({p.direction === 'left-to-right' ? 'left → right' : 'right → left'})
              </dt>
              <dd>
                {p.targetRowsBefore.toLocaleString()} → {p.targetRowsAfter.toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

/**
 * The Sprint 6 "propagation-step inspector" / "table inspector" (brief
 * §18/§19) — selecting a node or edge in `ContextPropagationDiagram` shows
 * its detail here. Every number is read from `ContextTableState`/
 * `ContextRelationshipState`, which are themselves plain adaptations of the
 * real `ResolvedFilterState` — nothing here is independently derived.
 */
export function ContextDetailsPanel({ tables, selectedTable, selectedRelationship }: ContextDetailsPanelProps) {
  if (selectedRelationship) return <RelationshipDetails relationship={selectedRelationship} tables={tables} />
  if (selectedTable) return <TableDetails table={selectedTable} />
  return <p className="context-details__empty">Select a table or relationship in the diagram to inspect it.</p>
}
