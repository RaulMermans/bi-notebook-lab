import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { DataColumn } from '../../../domain/data'
import type { CalculatedColumn } from '../../../domain/model'

export interface ModelTableNodeData extends Record<string, unknown> {
  tableName: string
  columns: DataColumn[]
  keyColumnIds: Set<string>
  calculatedColumns: CalculatedColumn[]
}

export type ModelTableNodeType = Node<ModelTableNodeData, 'modelTable'>

/** `fx` distinguishes a calculated column from a physical one — Sprint 3 calculated columns don't participate in relationships (docs/CALCULATED_COLUMNS.md "Model canvas integration"). */
export function ModelTableNode({ data }: NodeProps<ModelTableNodeType>) {
  return (
    <div className="model-node">
      <Handle type="target" position={Position.Left} />
      <div className="model-node__header">{data.tableName}</div>
      <ul className="model-node__columns">
        {data.columns.map((column) => (
          <li key={column.id} className={data.keyColumnIds.has(column.id) ? 'model-node__column--key' : undefined}>
            <span>{column.name}</span>
            <span className="type-badge">{column.dataType}</span>
          </li>
        ))}
        {data.calculatedColumns.map((column) => (
          <li key={column.id} className="model-node__column--calculated">
            <span>
              <span className="model-node__fx">fx</span> {column.name}
            </span>
            <span className="type-badge">{column.dataType}</span>
          </li>
        ))}
      </ul>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
