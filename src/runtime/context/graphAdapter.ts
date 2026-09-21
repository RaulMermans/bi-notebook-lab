import type { Dataset } from '../../domain/data'
import type {
  ContextFilterSummary,
  ContextRelationshipPropagationEntry,
  ContextRelationshipState,
  ContextTablePropagationSource,
  ContextTableState,
} from '../../domain/context'
import type { SemanticModel } from '../../domain/model'
import { modelTableFor } from '../model/graphAnalysis'
import { resolveColumnRef, resolveTableRef } from '../model/modelRuntime'
import type { ResolvedFilterState } from '../measure/filterPropagation'

/**
 * Adapts Sprint 4's `ResolvedFilterState` (already-computed row selections,
 * direct-filter summaries and propagation steps) into the presentation
 * contract the Context Explorer renders. This file performs no filtering,
 * no propagation and no aggregation of its own — every number here is read
 * straight from `state` or from `model`/`datasets` structure
 * (docs/CONTEXT_VISUALIZER.md "Runtime-truth reuse").
 */
export function buildTableStates(model: SemanticModel, state: ResolvedFilterState): ContextTableState[] {
  const directByTable = new Map<string, ContextFilterSummary[]>()
  for (const summary of state.directFilterSummaries) {
    const list = directByTable.get(summary.modelTableId) ?? []
    list.push({
      modelTableId: summary.modelTableId,
      tableName: summary.tableName,
      columnName: summary.columnName,
      operator: summary.operator,
      values: summary.values,
      rowsBefore: summary.rowsBefore,
      rowsAfter: summary.rowsAfter,
    })
    directByTable.set(summary.modelTableId, list)
  }

  const propagationByTargetTable = new Map<string, ContextTablePropagationSource[]>()
  for (const step of state.propagationSteps) {
    const list = propagationByTargetTable.get(step.targetModelTableId) ?? []
    list.push({
      relationshipId: step.relationshipId,
      sourceModelTableId: step.sourceModelTableId,
      sourceTableName: step.sourceTableName,
      sourceColumnName: step.sourceColumnName,
      targetColumnName: step.targetColumnName,
      direction: step.direction,
      targetRowsBefore: step.targetRowsBefore,
      targetRowsAfter: step.targetRowsAfter,
    })
    propagationByTargetTable.set(step.targetModelTableId, list)
  }

  return model.tables.map((table) => {
    const summary = state.tableSummaries.find((t) => t.modelTableId === table.id)
    const totalRows = summary?.totalRows ?? 0
    const visibleRows = summary?.visibleRows ?? totalRows
    const directFilters = directByTable.get(table.id) ?? []
    const incomingPropagation = propagationByTargetTable.get(table.id) ?? []

    // A CALCULATE `FILTER`/inequality-derived table selection (Sprint 8) narrows `visibleRows`
    // without adding a `ColumnFilter`-shaped `directFilters` entry (docs/CALCULATE.md "Known
    // limitations" — the *why* only shows up in the execution trace, not this summary). Falling
    // back to 'direct' here keeps the visible/total percentage and the state badge consistent
    // instead of showing "unfiltered" next to a reduced row count.
    const filterState =
      directFilters.length > 0 && incomingPropagation.length > 0
        ? 'direct+propagated'
        : directFilters.length > 0
          ? 'direct'
          : incomingPropagation.length > 0
            ? 'propagated'
            : visibleRows < totalRows
              ? 'direct'
              : 'unfiltered'

    return {
      modelTableId: table.id,
      tableName: summary?.tableName ?? 'Unknown table',
      totalRows,
      visibleRows,
      percentVisible: totalRows === 0 ? 100 : (visibleRows / totalRows) * 100,
      filterState,
      directFilters,
      incomingPropagation,
      position: table.position,
    }
  })
}

export function buildRelationshipStates(
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  state: ResolvedFilterState,
): ContextRelationshipState[] {
  const activated = new Set(state.relationshipOverrides?.activated ?? [])
  const suppressed = new Set(state.relationshipOverrides?.suppressed ?? [])

  return model.relationships.flatMap((relationship): ContextRelationshipState[] => {
    const leftModelTable = modelTableFor(model, relationship.left)
    const rightModelTable = modelTableFor(model, relationship.right)
    if (!leftModelTable || !rightModelTable) return []

    const leftResolved = resolveTableRef(datasets, leftModelTable)
    const rightResolved = resolveTableRef(datasets, rightModelTable)
    const leftColumn = resolveColumnRef(datasets, relationship.left)
    const rightColumn = resolveColumnRef(datasets, relationship.right)

    const propagation: ContextRelationshipPropagationEntry[] = state.propagationSteps
      .filter((s) => s.relationshipId === relationship.id)
      .map((s) => ({
        direction: s.direction,
        targetModelTableId: s.targetModelTableId,
        targetRowsBefore: s.targetRowsBefore,
        targetRowsAfter: s.targetRowsAfter,
      }))

    const effectiveActive = suppressed.has(relationship.id) ? false : activated.has(relationship.id) ? true : relationship.active

    let overrideReason: ContextRelationshipState['overrideReason']
    if (suppressed.has(relationship.id) && relationship.active) overrideReason = 'crossfilter-none'
    else if (suppressed.has(relationship.id)) overrideReason = 'suppressed-by-userelationship'
    else if (activated.has(relationship.id) && !relationship.active) overrideReason = 'activated-by-userelationship'
    else if (activated.has(relationship.id)) overrideReason = 'crossfilter-direction-override'

    return [
      {
        relationshipId: relationship.id,
        leftModelTableId: leftModelTable.id,
        rightModelTableId: rightModelTable.id,
        leftTableName: leftResolved?.table.name ?? 'Unknown table',
        rightTableName: rightResolved?.table.name ?? 'Unknown table',
        leftColumnName: leftColumn?.column.name ?? 'Unknown column',
        rightColumnName: rightColumn?.column.name ?? 'Unknown column',
        cardinality: relationship.cardinality,
        oneSide: relationship.oneSide,
        crossFilterDirection: relationship.crossFilterDirection,
        active: relationship.active,
        effectiveActive,
        overrideReason,
        propagation,
        state: !effectiveActive ? 'inactive' : propagation.length > 0 ? 'propagated' : 'active-no-effect',
      },
    ]
  })
}
