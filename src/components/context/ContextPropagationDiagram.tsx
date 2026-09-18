import { ReactFlow, Background, Controls, type Edge, type EdgeTypes, type Node, type NodeTypes } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { ContextRelationshipState, ContextTableState } from '../../domain/context'
import { defaultTablePosition } from '../../lib/layout/modelLayout'
import { ContextRelationshipEdge, type ContextRelationshipEdgeType } from './ContextRelationshipEdge'
import { ContextTableNode, type ContextTableNodeType } from './ContextTableNode'

const nodeTypes: NodeTypes = { contextTable: ContextTableNode }
const edgeTypes: EdgeTypes = { contextRelationship: ContextRelationshipEdge }

interface ContextPropagationDiagramProps {
  tables: ContextTableState[]
  relationships: ContextRelationshipState[]
  selectedTableId: string | undefined
  selectedRelationshipId: string | undefined
  onSelectTable: (modelTableId: string) => void
  onSelectRelationship: (relationshipId: string) => void
}

function deriveNodes(tables: ContextTableState[], selectedTableId: string | undefined, onSelectTable: (id: string) => void): Node[] {
  return tables.map((table, index) => ({
    id: table.modelTableId,
    type: 'contextTable',
    position: table.position ?? defaultTablePosition(index),
    data: { ...table, selected: table.modelTableId === selectedTableId, onSelect: onSelectTable },
  })) as ContextTableNodeType[]
}

function deriveEdges(
  relationships: ContextRelationshipState[],
  selectedRelationshipId: string | undefined,
  onSelectRelationship: (id: string) => void,
): Edge[] {
  return relationships.map((relationship) => ({
    id: relationship.relationshipId,
    source: relationship.manyModelTableId,
    target: relationship.oneModelTableId,
    type: 'contextRelationship',
    data: {
      state: relationship.state,
      oneColumnName: relationship.oneColumnName,
      manyColumnName: relationship.manyColumnName,
      manyRowsBefore: relationship.manyRowsBefore,
      manyRowsAfter: relationship.manyRowsAfter,
      selected: relationship.relationshipId === selectedRelationshipId,
      onSelect: onSelectRelationship,
    },
  })) as ContextRelationshipEdgeType[]
}

/**
 * The core Sprint 6 visual: a `@xyflow/react` graph of the semantic model
 * (reusing the same library as `ModelCanvas` per brief §34), but read-only —
 * an explanation surface, not a model editor. Nodes reuse `ModelTable.position`
 * when the learner has already arranged their own model canvas, falling back
 * to the same deterministic grid `ModelCanvas` uses (brief §13/§41).
 */
export function ContextPropagationDiagram({
  tables,
  relationships,
  selectedTableId,
  selectedRelationshipId,
  onSelectTable,
  onSelectRelationship,
}: ContextPropagationDiagramProps) {
  const nodes = deriveNodes(tables, selectedTableId, onSelectTable)
  const edges = deriveEdges(relationships, selectedRelationshipId, onSelectRelationship)

  return (
    <div className="context-propagation-diagram">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesReconnectable={false}
        elementsSelectable={false}
        fitView
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
