import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { ContextTableFilterState, ContextTablePropagationSource, ContextFilterSummary } from '../../domain/context'

export interface ContextTableNodeData extends Record<string, unknown> {
  tableName: string
  totalRows: number
  visibleRows: number
  percentVisible: number
  filterState: ContextTableFilterState
  directFilters: ContextFilterSummary[]
  incomingPropagation: ContextTablePropagationSource[]
  selected: boolean
  onSelect: (modelTableId: string) => void
}

export type ContextTableNodeType = Node<ContextTableNodeData, 'contextTable'>

const STATE_LABEL: Record<ContextTableFilterState, string> = {
  unfiltered: 'UNFILTERED',
  direct: 'DIRECT',
  propagated: 'PROPAGATED',
  'direct+propagated': 'DIRECT + PROPAGATED',
}

/**
 * A read-only table card for the Context Explorer's propagation diagram —
 * visible/total row counts and *why* the table is filtered are always
 * textual, never color-only (Sprint 6 brief §36 accessibility). Reuses
 * `ContextTableState`, computed entirely by `runtime/context/graphAdapter.ts`
 * from the real Sprint 4 `ResolvedFilterState` — nothing here is recomputed.
 */
export function ContextTableNode({ id, data }: NodeProps<ContextTableNodeType>) {
  return (
    <div className={`context-node context-node--${data.filterState} ${data.selected ? 'context-node--selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <button
        type="button"
        className="context-node__button"
        onClick={() => data.onSelect(id)}
        aria-pressed={data.selected}
      >
        <div className="context-node__header">{data.tableName}</div>
        <div className="context-node__rows">
          {data.visibleRows.toLocaleString()} / {data.totalRows.toLocaleString()} rows
        </div>
        <div className="context-node__percent">{data.percentVisible.toFixed(1)}% visible</div>
        <div className={`context-node__state context-node__state--${data.filterState}`}>{STATE_LABEL[data.filterState]}</div>
        {data.filterState === 'direct' || data.filterState === 'direct+propagated' ? (
          <div className="context-node__reason">
            {data.directFilters.map((f, i) => (
              <div key={i}>
                {f.columnName} = {f.values.map(String).join(', ')}
              </div>
            ))}
          </div>
        ) : null}
        {(data.filterState === 'propagated' || data.filterState === 'direct+propagated') && data.incomingPropagation.length > 0 ? (
          <div className="context-node__reason">
            Via {data.incomingPropagation.map((p) => `${p.sourceTableName} → ${p.targetColumnName}`).join(', ')}
          </div>
        ) : null}
      </button>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
