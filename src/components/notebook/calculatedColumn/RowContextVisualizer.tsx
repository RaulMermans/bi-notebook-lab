import type { DataColumn } from '../../../domain/data'
import type { ExecutionTraceNode } from '../../../expression/trace'
import { formatTraceValue, TraceNodeView } from '../shared/TraceTree'

function formatValue(value: unknown): string {
  return formatTraceValue(value)
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
