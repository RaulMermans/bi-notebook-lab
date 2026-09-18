import type { ContextRelationshipState, ContextTableState } from '../../domain/context'

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
              {p.oneTableName}[{p.oneKeyColumnName}]
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RelationshipDetails({ relationship, tables }: { relationship: ContextRelationshipState; tables: ContextTableState[] }) {
  const oneTable = tables.find((t) => t.modelTableId === relationship.oneModelTableId)

  return (
    <div className="context-details">
      <h4>Relationship Propagation</h4>
      <p className="context-details__direction">
        {relationship.oneTableName}[{relationship.oneColumnName}]
        <br />
        1 → *
        <br />
        {relationship.manyTableName}[{relationship.manyColumnName}]
      </p>

      {!relationship.active && (
        <p className="context-details__note">This relationship is inactive — it does not participate in filter propagation right now.</p>
      )}

      {relationship.active && relationship.state === 'active-no-effect' && (
        <p className="context-details__note">
          This relationship is active, but had no effect under the current filters — its "1" side ({relationship.oneTableName}) isn't
          currently constrained.
        </p>
      )}

      {relationship.state === 'propagated' && (
        <dl className="context-details__stats">
          {oneTable && (
            <div>
              <dt>{relationship.oneTableName} visible rows</dt>
              <dd>
                {oneTable.visibleRows.toLocaleString()} / {oneTable.totalRows.toLocaleString()}
              </dd>
            </div>
          )}
          {typeof relationship.allowedOneSideKeys === 'number' && (
            <div>
              <dt>Allowed {relationship.oneColumnName} keys</dt>
              <dd>{relationship.allowedOneSideKeys.toLocaleString()}</dd>
            </div>
          )}
          <div>
            <dt>{relationship.manyTableName} rows before</dt>
            <dd>{relationship.manyRowsBefore?.toLocaleString()}</dd>
          </div>
          <div>
            <dt>{relationship.manyTableName} rows after</dt>
            <dd>{relationship.manyRowsAfter?.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Rows removed</dt>
            <dd>{((relationship.manyRowsBefore ?? 0) - (relationship.manyRowsAfter ?? 0)).toLocaleString()}</dd>
          </div>
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
