import type { ContextFlowStep } from '../../domain/context'
import type { ExecutionTraceNode } from '../../expression/trace'
import { formatContextValue } from '../../lib/format/formatValue'
import type { ResolvedFilterState } from '../measure/filterPropagation'

function formatFilterValues(values: unknown[]): string {
  return values.map((v) => formatContextValue(v)).join(', ')
}

/** Walks an execution trace collecting `aggregation` leaf nodes — reads the runtime's own trace metadata, never recomputes an aggregation (docs/CONTEXT_VISUALIZER.md). */
function collectAggregationNodes(node: ExecutionTraceNode, out: ExecutionTraceNode[] = []): ExecutionTraceNode[] {
  if (node.kind === 'aggregation') out.push(node)
  for (const child of node.children ?? []) collectAggregationNodes(child, out)
  return out
}

/**
 * Builds a numbered, technical-but-plain-English sequence of what actually
 * happened for this evaluation — generated entirely from `ResolvedFilterState`
 * and the measure's own execution trace, never a hardcoded exercise-specific
 * string (Sprint 6 brief §20 "no hardcoded Retail-specific wording").
 */
export function buildContextNarrative(
  measureName: string,
  measureValue: unknown,
  state: ResolvedFilterState,
  trace: ExecutionTraceNode | undefined,
): ContextFlowStep[] {
  const steps: ContextFlowStep[] = []
  let order = 1

  for (const filter of state.directFilterSummaries) {
    steps.push({
      order: order++,
      description: `${filter.tableName} filtered by ${filter.columnName} ${filter.operator === 'in' ? 'in' : '='} ${formatFilterValues(filter.values)}. ${filter.rowsBefore.toLocaleString()} → ${filter.rowsAfter.toLocaleString()} rows.`,
      metadata: { modelTableId: filter.modelTableId, rowsBefore: filter.rowsBefore, rowsAfter: filter.rowsAfter },
    })
  }

  for (const step of state.propagationSteps) {
    steps.push({
      order: order++,
      description: `${step.oneKeyColumnName} filter propagated from ${step.oneTableName} to ${step.manyTableName}. ${step.manyRowsBefore.toLocaleString()} → ${step.manyRowsAfter.toLocaleString()} rows.`,
      metadata: { relationshipId: step.relationshipId, rowsBefore: step.manyRowsBefore, rowsAfter: step.manyRowsAfter },
    })
  }

  if (steps.length === 0) {
    steps.push({ order: order++, description: 'No filters are applied — no filter propagation was required.' })
  }

  const aggregationNodes = trace ? collectAggregationNodes(trace) : []
  for (const node of aggregationNodes) {
    const visible = node.metadata?.visibleRows
    const total = node.metadata?.totalRows
    const rowsClause = typeof visible === 'number' && typeof total === 'number' ? ` across ${visible.toLocaleString()} / ${total.toLocaleString()} visible rows` : ''
    steps.push({
      order: order++,
      description: `${node.label} evaluated${rowsClause} → ${formatContextValue(node.value)}.`,
      metadata: { visibleRows: visible, totalRows: total },
    })
  }

  steps.push({ order: order++, description: `Result: ${measureName} = ${formatContextValue(measureValue)}.` })

  return steps
}

/**
 * A single prose paragraph covering the same facts as `buildContextNarrative`,
 * for the "Explanation" (beginner) mode — Sprint 6 brief §23. Built from the
 * same real filter/propagation data, never a canned Retail example.
 */
export function buildBeginnerExplanation(measureName: string, measureValue: unknown, state: ResolvedFilterState): string {
  if (state.directFilterSummaries.length === 0 && state.propagationSteps.length === 0) {
    return `No filters are applied, so ${measureName} shows the model's baseline result: ${formatContextValue(measureValue)}.`
  }

  const sentences: string[] = []

  for (const filter of state.directFilterSummaries) {
    sentences.push(`${filter.columnName} = ${formatFilterValues(filter.values)} filters ${filter.tableName}.`)
  }

  for (const step of state.propagationSteps) {
    sentences.push(
      `That filter travels through the active ${step.oneKeyColumnName} relationship. ${step.manyTableName} is reduced from ${step.manyRowsBefore.toLocaleString()} to ${step.manyRowsAfter.toLocaleString()} rows.`,
    )
  }

  sentences.push(`${measureName} is recalculated using those visible rows: ${formatContextValue(measureValue)}.`)

  return sentences.join(' ')
}
