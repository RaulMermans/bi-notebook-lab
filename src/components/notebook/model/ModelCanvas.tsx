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
import { defaultTablePosition } from '../../../lib/layout/modelLayout'
import { resolveColumnRef, resolveTableRef } from '../../../runtime/model/modelRuntime'
import { ModelTableNode, type ModelTableNodeType } from './ModelTableNode'
import { RelationshipEdge, type RelationshipEdgeType } from './RelationshipEdge'

const nodeTypes: NodeTypes = { modelTable: ModelTableNode }
const edgeTypes: EdgeTypes = { relationship: RelationshipEdge }

interface ModelCanvasProps {
  model: SemanticModel
  datasets: Record<string, Dataset>
  onMoveTable: (modelTableId: string, position: { x: number; y: number }) => void
}

function keyColumnIdsFor(model: SemanticModel, modelTable: SemanticModel['tables'][number]): Set<string> {
  const ids = new Set<string>()
  for (const relationship of model.relationships) {
    if (relationship.left.datasetId === modelTable.datasetId && relationship.left.tableId === modelTable.tableId) {
      ids.add(relationship.left.columnId)
    }
    if (relationship.right.datasetId === modelTable.datasetId && relationship.right.tableId === modelTable.tableId) {
      ids.add(relationship.right.columnId)
    }
  }
  return ids
}

function deriveNodes(model: SemanticModel, datasets: Record<string, Dataset>): ModelTableNodeType[] {
  return model.tables.map((table, index) => {
    const resolved = resolveTableRef(datasets, table)
    const dateTableDefinition = model.dateTables.find((dt) => dt.modelTableId === table.id)
    const dateColumnName = dateTableDefinition && resolved?.table.columns.find((c) => c.id === dateTableDefinition.dateColumn.columnId)?.name
    return {
      id: table.id,
      type: 'modelTable',
      position: table.position ?? defaultTablePosition(index),
      data: {
        tableName: resolved?.table.name ?? 'Missing table',
        columns: resolved?.table.columns ?? [],
        keyColumnIds: keyColumnIdsFor(model, table),
        calculatedColumns: model.calculatedColumns.filter((c) => c.modelTableId === table.id),
        measures: model.measures.filter((m) => m.homeModelTableId === table.id),
        isDateTable: Boolean(dateTableDefinition),
        dateColumnName,
      },
    }
  })
}

/** Offsets parallel edges between the same table pair (sprint brief §48) so two relationships connecting the same two tables — e.g. OrderDate + ShipDate — never draw directly on top of each other. */
function pairKey(a: string, b: string): string {
  return [a, b].sort().join(':')
}

function deriveEdges(model: SemanticModel, datasets: Record<string, Dataset>): RelationshipEdgeType[] {
  const seenPerPair = new Map<string, number>()

  return model.relationships.flatMap((relationship) => {
    const leftTable = model.tables.find((t) => t.datasetId === relationship.left.datasetId && t.tableId === relationship.left.tableId)
    const rightTable = model.tables.find((t) => t.datasetId === relationship.right.datasetId && t.tableId === relationship.right.tableId)
    if (!leftTable || !rightTable) return []

    const key = pairKey(leftTable.id, rightTable.id)
    const index = seenPerPair.get(key) ?? 0
    seenPerPair.set(key, index + 1)

    const leftColumn = resolveColumnRef(datasets, relationship.left)
    const rightColumn = resolveColumnRef(datasets, relationship.right)

    return [
      {
        id: relationship.id,
        source: leftTable.id,
        target: rightTable.id,
        type: 'relationship' as const,
        data: {
          active: relationship.active,
          cardinality: relationship.cardinality,
          oneSide: relationship.oneSide,
          crossFilterDirection: relationship.crossFilterDirection,
          leftColumnName: leftColumn?.column.name ?? '?',
          rightColumnName: rightColumn?.column.name ?? '?',
          parallelIndex: index,
        },
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

  const edges: Edge[] = deriveEdges(model, datasets)

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
