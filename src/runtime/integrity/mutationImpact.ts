import type { NotebookCell } from '../../domain/notebook'
import type { SemanticModel } from '../../domain/model'
import type { VisualSpec } from '../../domain/visual'
import { buildMeasureDependencyGraph } from '../measure/dependencyGraph'
import { queryDependencyIds } from '../query/queryGraph'
import type { NotebookRuntimeSnapshot } from '../notebook/notebookRuntime'
import { findCalculatedColumnDependents } from './expressionDependents'
import type { WorkspaceIntegrityIssue, WorkspaceRef } from './types'

/**
 * Pre-mutation impact analysis (brief Part A §4). Every function here is
 * pure and read-only — it never mutates `snapshot`. `NotebookRuntime`'s
 * mutation methods are the single enforcement point (they call these
 * internally before mutating); the UI may also call them ahead of time for
 * a preview/confirmation dialog, but must never treat that preview as the
 * enforcement itself (see docs/WORKSPACE_INTEGRITY.md "Enforcement point").
 */

function blocker(source: WorkspaceRef, target: WorkspaceRef, referenceType: string, reason: string): WorkspaceIntegrityIssue {
  return { source, target, referenceType, reason, severity: 'error' }
}

function visualReferencesMeasure(visual: VisualSpec, measureId: string): boolean {
  switch (visual.type) {
    case 'kpi':
    case 'bar':
    case 'line':
      return visual.measureId === measureId
    case 'table':
      return visual.measureIds.includes(measureId)
    default:
      return false
  }
}

/** VisualCells (of `modelId`) whose `VisualSpec` references any id in `measureIds`. */
function visualCellsReferencingMeasures(cells: NotebookCell[], modelId: string, measureIds: Set<string>): NotebookCell[] {
  return cells.filter(
    (cell) => cell.kind === 'visual' && cell.modelId === modelId && [...measureIds].some((id) => visualReferencesMeasure(cell.visual, id)),
  )
}

export interface CascadeImpact {
  policy: 'cascade'
  allowed: true
  cascadeCellIds: string[]
}

export interface RestrictImpact {
  policy: 'restrict'
  allowed: boolean
  blockers: WorkspaceIntegrityIssue[]
}

/** Every cell that a Semantic Model deletion cascades away with it (brief §5 "Delete Semantic Model"). */
export function analyzeDeleteModel(snapshot: NotebookRuntimeSnapshot, modelId: string): CascadeImpact {
  const cascadeCellIds = snapshot.notebook.cells
    .filter(
      (cell) =>
        (cell.kind === 'model' && cell.modelId === modelId) ||
        (cell.kind === 'calculated-column' && cell.modelId === modelId) ||
        (cell.kind === 'measure' && cell.modelId === modelId) ||
        (cell.kind === 'visual' && cell.modelId === modelId) ||
        (cell.kind === 'test' && cell.scope.kind === 'model' && cell.scope.modelId === modelId),
    )
    .map((cell) => cell.id)

  return { policy: 'cascade', allowed: true, cascadeCellIds }
}

/** Blocked if a Query sources from this dataset, or a model's ModelTable references it directly (brief §5 "Delete raw Dataset"). */
export function analyzeDeleteDataset(snapshot: NotebookRuntimeSnapshot, datasetId: string): RestrictImpact {
  const blockers: WorkspaceIntegrityIssue[] = []
  const datasetRef: WorkspaceRef = { kind: 'dataset', id: datasetId }

  for (const query of Object.values(snapshot.queries)) {
    if (query.source.kind === 'dataset-table' && query.source.datasetId === datasetId) {
      blockers.push(blocker({ kind: 'query', id: query.id }, datasetRef, 'DATASET_IN_USE_BY_QUERY', `Query "${query.name}" sources from this dataset.`))
    }
  }
  for (const model of Object.values(snapshot.models)) {
    if (model.tables.some((t) => t.datasetId === datasetId)) {
      blockers.push(blocker({ kind: 'model', id: model.id }, datasetRef, 'DATASET_IN_USE_BY_MODEL', `Model "${model.name}" has a table loaded from this dataset.`))
    }
  }

  return { policy: 'restrict', allowed: blockers.length === 0, blockers }
}

/** Blocked if another query depends on it, or its output dataset is registered on a model — a hard block, tightening the prior soft-warn (brief §38). */
export function analyzeDeleteQuery(snapshot: NotebookRuntimeSnapshot, queryId: string): RestrictImpact {
  const query = snapshot.queries[queryId]
  if (!query) return { policy: 'restrict', allowed: true, blockers: [] }

  const blockers: WorkspaceIntegrityIssue[] = []
  const queryRef: WorkspaceRef = { kind: 'query', id: queryId }

  for (const other of Object.values(snapshot.queries)) {
    if (other.id !== queryId && queryDependencyIds(other).includes(queryId)) {
      blockers.push(blocker({ kind: 'query', id: other.id }, queryRef, 'QUERY_IN_USE_BY_QUERY', `Query "${other.name}" depends on this query's output.`))
    }
  }
  for (const model of Object.values(snapshot.models)) {
    if (model.tables.some((t) => t.datasetId === query.outputDatasetId)) {
      blockers.push(blocker({ kind: 'model', id: model.id }, queryRef, 'QUERY_IN_USE_BY_MODEL', `Model "${model.name}" uses this query's output.`))
    }
  }

  return { policy: 'restrict', allowed: blockers.length === 0, blockers }
}

/** Blocked if the currently-loaded output is registered on a model (brief §39/§19 — never silently orphan the ModelTable). */
export function analyzeDisableQueryLoad(snapshot: NotebookRuntimeSnapshot, queryId: string): RestrictImpact {
  const query = snapshot.queries[queryId]
  if (!query) return { policy: 'restrict', allowed: true, blockers: [] }

  const blockers: WorkspaceIntegrityIssue[] = Object.values(snapshot.models)
    .filter((model) => model.tables.some((t) => t.datasetId === query.outputDatasetId))
    .map((model) => blocker({ kind: 'model', id: model.id }, { kind: 'query', id: queryId }, 'QUERY_LOAD_IN_USE_BY_MODEL', `Model "${model.name}" uses this query's loaded output.`))

  return { policy: 'restrict', allowed: blockers.length === 0, blockers }
}

export interface RemoveModelTableImpact {
  policy: 'cascade'
  allowed: true
  cascadeCalculatedColumnIds: string[]
  cascadeMeasureIds: string[]
  cascadeCellIds: string[]
}

/** Removing a ModelTable cascades its calculated columns and (Sprint 15) any measure homed on it, plus their cells and any VisualCell that referenced those measures (brief §5 "Remove Model Table"). */
export function analyzeRemoveModelTable(snapshot: NotebookRuntimeSnapshot, modelId: string, modelTableId: string): RemoveModelTableImpact {
  const model = snapshot.models[modelId]
  if (!model) return { policy: 'cascade', allowed: true, cascadeCalculatedColumnIds: [], cascadeMeasureIds: [], cascadeCellIds: [] }

  const cascadeCalculatedColumnIds = model.calculatedColumns.filter((c) => c.modelTableId === modelTableId).map((c) => c.id)
  const cascadeMeasureIds = model.measures.filter((m) => m.homeModelTableId === modelTableId).map((m) => m.id)
  const measureIdSet = new Set(cascadeMeasureIds)
  const calculatedColumnIdSet = new Set(cascadeCalculatedColumnIds)

  const cascadeCellIds = snapshot.notebook.cells
    .filter(
      (cell) =>
        (cell.kind === 'calculated-column' && cell.modelId === modelId && calculatedColumnIdSet.has(cell.calculatedColumnId)) ||
        (cell.kind === 'measure' && cell.modelId === modelId && measureIdSet.has(cell.measureId)),
    )
    .map((cell) => cell.id)
    .concat(visualCellsReferencingMeasures(snapshot.notebook.cells, modelId, measureIdSet).map((cell) => cell.id))

  return { policy: 'cascade', allowed: true, cascadeCalculatedColumnIds, cascadeMeasureIds, cascadeCellIds }
}

/** Blocked if another measure depends on it, or a VisualCell references it (brief §6 — "prefer restricting" for visual-only dependents too). */
export function analyzeDeleteMeasure(snapshot: NotebookRuntimeSnapshot, modelId: string, measureId: string): RestrictImpact {
  const model = snapshot.models[modelId]
  if (!model) return { policy: 'restrict', allowed: true, blockers: [] }

  const measureRef: WorkspaceRef = { kind: 'measure', id: measureId }
  const blockers: WorkspaceIntegrityIssue[] = []

  const graph = buildMeasureDependencyGraph(model)
  for (const [id, deps] of graph) {
    if (id !== measureId && deps.has(measureId)) {
      const dependent = model.measures.find((m) => m.id === id)
      blockers.push(blocker({ kind: 'measure', id }, measureRef, 'MEASURE_IN_USE_BY_MEASURE', `Measure "${dependent?.name ?? id}" references this measure.`))
    }
  }
  for (const cell of visualCellsReferencingMeasures(snapshot.notebook.cells, modelId, new Set([measureId]))) {
    blockers.push(blocker({ kind: 'cell', id: cell.id }, measureRef, 'MEASURE_IN_USE_BY_VISUAL', `Visual "${cell.title}" references this measure.`))
  }

  return { policy: 'restrict', allowed: blockers.length === 0, blockers }
}

/** Blocked if a measure or another calculated column structurally references it by name (brief §7, via `expressionDependents.ts` — parser/AST-based, not regex). */
export function analyzeDeleteCalculatedColumn(snapshot: NotebookRuntimeSnapshot, modelId: string, calculatedColumnId: string): RestrictImpact {
  const model: SemanticModel | undefined = snapshot.models[modelId]
  const column = model?.calculatedColumns.find((c) => c.id === calculatedColumnId)
  if (!model || !column) return { policy: 'restrict', allowed: true, blockers: [] }

  const columnRef: WorkspaceRef = { kind: 'calculated-column', id: calculatedColumnId }
  const dependents = findCalculatedColumnDependents(model, calculatedColumnId, column.name)
  const blockers: WorkspaceIntegrityIssue[] = [
    ...dependents.calculatedColumnIds.map((id) => {
      const dependent = model.calculatedColumns.find((c) => c.id === id)
      return blocker({ kind: 'calculated-column', id }, columnRef, 'COLUMN_IN_USE_BY_CALCULATED_COLUMN', `Calculated column "${dependent?.name ?? id}" references "${column.name}".`)
    }),
    ...dependents.measureIds.map((id) => {
      const dependent = model.measures.find((m) => m.id === id)
      return blocker({ kind: 'measure', id }, columnRef, 'COLUMN_IN_USE_BY_MEASURE', `Measure "${dependent?.name ?? id}" references "${column.name}".`)
    }),
  ]

  return { policy: 'restrict', allowed: blockers.length === 0, blockers }
}
