import type { ExecutionTraceNode } from '../../../expression/trace'

export function formatTraceValue(value: unknown): string {
  if (value === null || value === undefined) return 'BLANK'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function noteFor(node: ExecutionTraceNode): string | undefined {
  if (node.kind === 'related-lookup' && node.metadata?.matched === false) return 'no matching row'

  if (node.kind === 'aggregation' && typeof node.metadata?.visibleRows === 'number' && typeof node.metadata?.totalRows === 'number') {
    return `${(node.metadata.visibleRows as number).toLocaleString()} / ${(node.metadata.totalRows as number).toLocaleString()} rows`
  }

  if (node.kind === 'relationship-propagation' && typeof node.metadata?.manyRowsBefore === 'number') {
    return `${(node.metadata.manyRowsBefore as number).toLocaleString()} → ${(node.metadata.manyRowsAfter as number).toLocaleString()} rows`
  }

  if (node.kind === 'filter-context' && typeof node.metadata?.rowsAfter === 'number') {
    return `${(node.metadata.rowsBefore as number).toLocaleString()} → ${(node.metadata.rowsAfter as number).toLocaleString()} rows`
  }

  return undefined
}

/**
 * Renders one `ExecutionTraceNode` and its children — the runtime's own
 * execution trace, never a reconstructed explanation string. Shared by the
 * calculated-column row-context visualizer and the measure trace
 * visualizer so both Sprint 3 and Sprint 4 traces render through the same
 * component (docs/EXPRESSION_ENGINE.md).
 */
export function TraceNodeView({ node, depth }: { node: ExecutionTraceNode; depth: number }) {
  const note = noteFor(node)
  return (
    <li className={`trace-node trace-node--${node.kind}`}>
      <div className="trace-node__row">
        <span className="trace-node__label">{node.label}</span>
        {node.value !== undefined && <span className="trace-node__arrow">→ {formatTraceValue(node.value)}</span>}
        {note && <span className="trace-node__note">{note}</span>}
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
