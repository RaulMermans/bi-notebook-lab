import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'

export interface RelationshipEdgeData extends Record<string, unknown> {
  active: boolean
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
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const active = data?.active ?? true

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
        >
          1 → *
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
