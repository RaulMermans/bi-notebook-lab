import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import type { CrossFilterDirection, RelationshipCardinality, RelationshipSide } from '../../../domain/model'
import { relationshipCardinalityLabel } from '../../../lib/format/relationshipLabel'

export interface RelationshipEdgeData extends Record<string, unknown> {
  active: boolean
  cardinality: RelationshipCardinality
  oneSide?: RelationshipSide
  crossFilterDirection: CrossFilterDirection
  leftColumnName: string
  rightColumnName: string
  /** Which parallel edge (0, 1, 2, ...) this is among relationships connecting the same table pair (sprint brief §48) — offsets the curve so they never overlap. */
  parallelIndex: number
}

export type RelationshipEdgeType = Edge<RelationshipEdgeData, 'relationship'>

export function RelationshipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<RelationshipEdgeType>) {
  const active = data?.active ?? true
  const parallelIndex = data?.parallelIndex ?? 0
  // Alternates curvature direction/magnitude per parallel edge so a second (third, ...) relationship
  // between the same two tables draws as a visibly separate arc rather than on top of the first.
  const curvature = parallelIndex === 0 ? 0.25 : parallelIndex % 2 === 1 ? 0.25 + 0.15 * Math.ceil(parallelIndex / 2) : -0.15 * (parallelIndex / 2)
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature })

  const cardinalityLabel = data ? relationshipCardinalityLabel(data.cardinality, data.crossFilterDirection, data.oneSide) : ''

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: active ? '#171717' : '#c7c7c1',
          strokeDasharray: active ? undefined : '4 4',
          strokeWidth: 1.5,
        }}
      />
      <EdgeLabelRenderer>
        <div
          className={`relationship-edge-label ${active ? '' : 'relationship-edge-label--inactive'}`}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          title={data ? `${data.leftColumnName} ${cardinalityLabel} ${data.rightColumnName}` : undefined}
        >
          {cardinalityLabel}
          {!active && <span className="relationship-edge-label__inactive-text"> INACTIVE</span>}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
