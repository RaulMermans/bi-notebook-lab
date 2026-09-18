import type { Dataset } from '../../domain/data'
import type {
  ContextFilterSummary,
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

  const propagationByManyTable = new Map<string, ContextTablePropagationSource[]>()
  for (const step of state.propagationSteps) {
    const relationship = model.relationships.find((r) => r.id === step.relationshipId)
    if (!relationship) continue
    const oneModelTable = modelTableFor(model, relationship.one)
    const manyModelTable = modelTableFor(model, relationship.many)
    if (!oneModelTable || !manyModelTable) continue

    const list = propagationByManyTable.get(manyModelTable.id) ?? []
    list.push({
      relationshipId: step.relationshipId,
      oneModelTableId: oneModelTable.id,
      oneTableName: step.oneTableName,
      oneKeyColumnName: step.oneKeyColumnName,
      manyKeyColumnName: step.manyKeyColumnName,
      manyRowsBefore: step.manyRowsBefore,
      manyRowsAfter: step.manyRowsAfter,
    })
    propagationByManyTable.set(manyModelTable.id, list)
  }

  return model.tables.map((table) => {
    const summary = state.tableSummaries.find((t) => t.modelTableId === table.id)
    const totalRows = summary?.totalRows ?? 0
    const visibleRows = summary?.visibleRows ?? totalRows
    const directFilters = directByTable.get(table.id) ?? []
    const incomingPropagation = propagationByManyTable.get(table.id) ?? []

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
  const tableSummaryById = new Map(state.tableSummaries.map((t) => [t.modelTableId, t]))

  return model.relationships.flatMap((relationship): ContextRelationshipState[] => {
    const oneModelTable = modelTableFor(model, relationship.one)
    const manyModelTable = modelTableFor(model, relationship.many)
    if (!oneModelTable || !manyModelTable) return []

    const oneResolved = resolveTableRef(datasets, oneModelTable)
    const manyResolved = resolveTableRef(datasets, manyModelTable)
    const oneColumn = resolveColumnRef(datasets, relationship.one)
    const manyColumn = resolveColumnRef(datasets, relationship.many)

    const step = state.propagationSteps.find((s) => s.relationshipId === relationship.id)
    const propagated = step !== undefined
    const oneSummary = tableSummaryById.get(oneModelTable.id)

    return [
      {
        relationshipId: relationship.id,
        oneModelTableId: oneModelTable.id,
        manyModelTableId: manyModelTable.id,
        oneTableName: oneResolved?.table.name ?? 'Unknown table',
        manyTableName: manyResolved?.table.name ?? 'Unknown table',
        oneColumnName: oneColumn?.column.name ?? 'Unknown column',
        manyColumnName: manyColumn?.column.name ?? 'Unknown column',
        active: relationship.active,
        propagated,
        state: !relationship.active ? 'inactive' : propagated ? 'propagated' : 'active-no-effect',
        manyRowsBefore: step?.manyRowsBefore,
        manyRowsAfter: step?.manyRowsAfter,
        // The "1" side of a relationship is always unique (enforced by ONE_SIDE_NOT_UNIQUE at
        // creation — docs/MODEL_RUNTIME.md), so its visible row count IS the distinct allowed-key count.
        allowedOneSideKeys: oneSummary?.visibleRows,
      },
    ]
  })
}
