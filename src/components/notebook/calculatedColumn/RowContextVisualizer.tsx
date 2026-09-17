import type { DataColumn } from '../../../domain/data'
import type { ExecutionTraceNode } from '../../../expression/trace'

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'BLANK'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function TraceNodeView({ node, depth }: { node: ExecutionTraceNode; depth: number }) {
  return (
    <li className={`trace-node trace-node--${node.kind}`}>
      <div className="trace-node__row">
        <span className="trace-node__label">{node.label}</span>
        {node.value !== undefined && <span className="trace-node__arrow">→ {formatValue(node.value)}</span>}
        {node.kind === 'related-lookup' && node.metadata?.matched === false && (
          <span className="trace-node__note">no matching row</span>
        )}
      </div>
      {node.children && node.children.length > 0 && depth < 8 && (
        <ul className="trace-tree">
          {node.children.map((child, index) => (
            <TraceNodeView key={index} node={child} depth={depth + 1} />
          ))}
        </ul>
      )}
    </li>
  )
}

interface RowContextVisualizerProps {
  tableName: string
  rowIndex: number
  row: Record<string, unknown>
  sourceColumns: DataColumn[]
  trace: ExecutionTraceNode
}

/**
 * Renders the runtime's own execution trace for one row — never a
 * reconstructed explanation string (docs/CALCULATED_COLUMNS.md "Row context
 * visualizer").
 */
export function RowContextVisualizer({ tableName, rowIndex, row, sourceColumns, trace }: RowContextVisualizerProps) {
  return (
    <div className="row-context-visualizer">
      <h4>Row Context</h4>
      <p className="row-context-visualizer__location">
        Table: <strong>{tableName}</strong> · Row {rowIndex + 1}
      </p>
      <ul className="row-context-visualizer__fields">
        {sourceColumns.map((column) => (
          <li key={column.id}>
            <span>{column.name}</span>
            <span>= {formatValue(row[column.name])}</span>
          </li>
        ))}
      </ul>
      <ul className="trace-tree trace-tree--root">
        <TraceNodeView node={trace} depth={0} />
      </ul>
    </div>
  )
}
