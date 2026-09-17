import type { ExecutionTraceNode } from '../../../expression/trace'
import { TraceNodeView } from '../shared/TraceTree'

interface MeasureTraceVisualizerProps {
  trace: ExecutionTraceNode
}

/**
 * Renders the runtime's own measure execution trace — filter context,
 * relationship propagation and aggregation are all real runtime metadata,
 * never a reconstructed explanation string (docs/FILTER_CONTEXT.md).
 */
export function MeasureTraceVisualizer({ trace }: MeasureTraceVisualizerProps) {
  return (
    <div className="measure-trace-visualizer">
      <h4>Execution Trace</h4>
      <ul className="trace-tree trace-tree--root">
        <TraceNodeView node={trace} depth={0} />
      </ul>
    </div>
  )
}
