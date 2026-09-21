import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { DataColumn } from '../../../domain/data'
import type { CalculatedColumn, Measure } from '../../../domain/model'

export interface ModelTableNodeData extends Record<string, unknown> {
  tableName: string
  columns: DataColumn[]
  keyColumnIds: Set<string>
  calculatedColumns: CalculatedColumn[]
  measures: Measure[]
  /** Sprint 10: whether this table is marked as a Date Table (docs/DATE_TABLES.md "Model Canvas"). */
  isDateTable: boolean
  dateColumnName?: string
}

export type ModelTableNodeType = Node<ModelTableNodeData, 'modelTable'>

/**
 * `fx` distinguishes a calculated column from a physical one — Sprint 3
 * calculated columns don't participate in relationships
 * (docs/CALCULATED_COLUMNS.md "Model canvas integration"). `∑` distinguishes
 * a measure the same way — measures never become relationship endpoints
 * either (docs/MEASURES.md "Model Canvas Integration").
 */
export function ModelTableNode({ data }: NodeProps<ModelTableNodeType>) {
  return (
    <div className="model-node">
      <Handle type="target" position={Position.Left} />
      <div className="model-node__header">
        {data.tableName}
        {data.isDateTable && (
          <span className="model-node__date-table-badge" title={data.dateColumnName ? `Date Table · ${data.tableName}[${data.dateColumnName}]` : 'Date Table'}>
            DATE TABLE
          </span>
        )}
      </div>
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
        {data.measures.map((measure) => (
          <li key={measure.id} className="model-node__column--measure">
            <span>
              <span className="model-node__sigma">∑</span> {measure.name}
            </span>
            <span className="type-badge">{measure.dataType}</span>
          </li>
        ))}
      </ul>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
