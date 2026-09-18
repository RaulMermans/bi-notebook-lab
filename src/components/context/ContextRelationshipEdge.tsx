import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import type { RelationshipPropagationState } from '../../domain/context'

export interface ContextRelationshipEdgeData extends Record<string, unknown> {
  state: RelationshipPropagationState
  oneColumnName: string
  manyColumnName: string
  manyRowsBefore?: number
  manyRowsAfter?: number
  selected: boolean
  onSelect: (relationshipId: string) => void
}

export type ContextRelationshipEdgeType = Edge<ContextRelationshipEdgeData, 'contextRelationship'>

const STATE_LABEL: Record<RelationshipPropagationState, string> = {
  propagated: 'PROPAGATED',
  'active-no-effect': 'ACTIVE · NO EFFECT',
  inactive: 'INACTIVE',
}

/**
 * A propagation-aware relationship edge — line style, an explicit textual
 * state label and the `1 → *` direction are always shown together, so the
 * distinction never depends on color alone (Sprint 6 brief §14/§36). The
 * label is a real `<button>` (not a click-only `<div>`) so selecting an
 * edge for the propagation-step inspector is keyboard accessible.
 */
export function ContextRelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<ContextRelationshipEdgeType>) {
  const state = data?.state ?? 'active-no-effect'
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })

  const strokeWidth = state === 'propagated' ? 2.5 : 1.5
  const stroke = state === 'inactive' ? '#c7c7c1' : state === 'propagated' ? '#171717' : '#6b6b66'

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke, strokeDasharray: state === 'inactive' ? '4 4' : undefined, strokeWidth }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          className={`context-edge-label context-edge-label--${state} ${data?.selected ? 'context-edge-label--selected' : ''}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onClick={() => data?.onSelect(id)}
          aria-pressed={data?.selected}
        >
          <span className="context-edge-label__direction">
            {data?.oneColumnName} 1 → * {data?.manyColumnName}
          </span>
          <span className="context-edge-label__state">{STATE_LABEL[state]}</span>
          {state === 'propagated' && typeof data?.manyRowsBefore === 'number' && (
            <span className="context-edge-label__impact">
              {data.manyRowsBefore.toLocaleString()} → {data.manyRowsAfter?.toLocaleString()}
            </span>
          )}
        </button>
      </EdgeLabelRenderer>
    </>
  )
}
