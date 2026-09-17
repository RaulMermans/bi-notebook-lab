import { useCallback, useEffect, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { Dataset } from '../../../domain/data'
import type { SemanticModel } from '../../../domain/model'
import { resolveTableRef } from '../../../runtime/model/modelRuntime'
import { ModelTableNode, type ModelTableNodeType } from './ModelTableNode'
import { RelationshipEdge, type RelationshipEdgeType } from './RelationshipEdge'

const nodeTypes: NodeTypes = { modelTable: ModelTableNode }
const edgeTypes: EdgeTypes = { relationship: RelationshipEdge }

interface ModelCanvasProps {
  model: SemanticModel
  datasets: Record<string, Dataset>
  onMoveTable: (modelTableId: string, position: { x: number; y: number }) => void
}

function defaultPosition(index: number): { x: number; y: number } {
  return { x: (index % 3) * 260, y: Math.floor(index / 3) * 220 }
}

function keyColumnIdsFor(model: SemanticModel, modelTable: SemanticModel['tables'][number]): Set<string> {
  const ids = new Set<string>()
  for (const relationship of model.relationships) {
    if (relationship.one.datasetId === modelTable.datasetId && relationship.one.tableId === modelTable.tableId) {
      ids.add(relationship.one.columnId)
    }
    if (relationship.many.datasetId === modelTable.datasetId && relationship.many.tableId === modelTable.tableId) {
      ids.add(relationship.many.columnId)
    }
  }
  return ids
}

function deriveNodes(model: SemanticModel, datasets: Record<string, Dataset>): ModelTableNodeType[] {
  return model.tables.map((table, index) => {
    const resolved = resolveTableRef(datasets, table)
    return {
      id: table.id,
      type: 'modelTable',
      position: table.position ?? defaultPosition(index),
      data: {
        tableName: resolved?.table.name ?? 'Missing table',
        columns: resolved?.table.columns ?? [],
        keyColumnIds: keyColumnIdsFor(model, table),
        calculatedColumns: model.calculatedColumns.filter((c) => c.modelTableId === table.id),
        measures: model.measures.filter((m) => m.homeModelTableId === table.id),
      },
    }
  })
}

function deriveEdges(model: SemanticModel): RelationshipEdgeType[] {
  return model.relationships.flatMap((relationship) => {
    const manyTable = model.tables.find(
      (t) => t.datasetId === relationship.many.datasetId && t.tableId === relationship.many.tableId,
    )
    const oneTable = model.tables.find(
      (t) => t.datasetId === relationship.one.datasetId && t.tableId === relationship.one.tableId,
    )
    if (!manyTable || !oneTable) return []
    return [
      {
        id: relationship.id,
        source: manyTable.id,
        target: oneTable.id,
        type: 'relationship' as const,
        data: { active: relationship.active },
      },
    ]
  })
}

/**
 * Renderer/editor for a SemanticModel. The model is always the source of
 * truth: nodes are re-derived from it whenever it changes; the only write
 * path back is `onMoveTable`, fired on drag stop (not on every drag frame).
 * Local `nodes` state exists only so React Flow can show a live drag
 * preview between "model changed" renders.
 */
export function ModelCanvas({ model, datasets, onMoveTable }: ModelCanvasProps) {
  const [nodes, setNodes] = useState<Node[]>(() => deriveNodes(model, datasets))

  useEffect(() => {
    setNodes(deriveNodes(model, datasets))
  }, [model, datasets])

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])

  const edges: Edge[] = deriveEdges(model)

  return (
    <div className="model-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={(_, node) => onMoveTable(node.id, node.position)}
        fitView
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
