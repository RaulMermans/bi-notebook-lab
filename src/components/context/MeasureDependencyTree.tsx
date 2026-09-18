import type { ExecutionTraceNode } from '../../expression/trace'
import { TraceNodeView } from '../notebook/shared/TraceTree'

interface MeasureDependencyTreeProps {
  trace: ExecutionTraceNode
}

/** True if `trace` (the root measure-reference node for the measure being explored) has at least one *nested* measure-reference descendant — i.e. this measure depends on another measure. */
function hasNestedMeasureReference(node: ExecutionTraceNode, isRoot: boolean): boolean {
  if (!isRoot && node.kind === 'measure-reference') return true
  return (node.children ?? []).some((child) => hasNestedMeasureReference(child, false))
}

/**
 * Renders a measure's dependency chain (e.g. `Average Order Value =
 * DIVIDE([Total Revenue], [Orders])`) by reusing the runtime's own
 * `measure-reference` trace nodes (Sprint 6 brief §22) — the same
 * `TraceNodeView` component the technical trace tree uses, just scoped to
 * "does this measure reference another measure at all". Renders nothing
 * when the measure has no measure-reference dependency.
 */
export function MeasureDependencyTree({ trace }: MeasureDependencyTreeProps) {
  if (!hasNestedMeasureReference(trace, true)) return null

  return (
    <div className="measure-dependency-tree">
      <h4>Measure Dependencies</h4>
      <ul className="trace-tree trace-tree--root">
        <TraceNodeView node={trace} depth={0} />
      </ul>
    </div>
  )
}
