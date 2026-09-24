import type { Dataset } from '../../domain/data'
import type { NotebookCell } from '../../domain/notebook'
import type { SemanticModel } from '../../domain/model'
import type { QueryDefinition } from '../../domain/query'
import { resolveColumnRef, resolveTableRef } from '../model/modelRuntime'
import { queryDependencyIds } from '../query/queryGraph'
import type { WorkspaceIntegrityIssue, WorkspaceRef } from './types'

function issue(
  source: WorkspaceRef,
  target: WorkspaceRef,
  referenceType: string,
  reason: string,
  severity: WorkspaceIntegrityIssue['severity'] = 'error',
): WorkspaceIntegrityIssue {
  return { source, target, referenceType, reason, severity }
}

/** Structural reference checks for one notebook cell — brief §2's DataCell/QueryCell/ModelCell/CalculatedColumnCell/MeasureCell/VisualCell/TestCell invariants. */
export function cellReferenceIssues(
  cell: NotebookCell,
  datasets: Record<string, Dataset>,
  models: Record<string, SemanticModel>,
  queries: Record<string, QueryDefinition>,
): WorkspaceIntegrityIssue[] {
  const cellRef: WorkspaceRef = { kind: 'cell', id: cell.id }

  switch (cell.kind) {
    case 'data':
      if (!datasets[cell.datasetId]) {
        return [issue(cellRef, { kind: 'dataset', id: cell.datasetId }, 'DATASET_NOT_FOUND', `DataCell "${cell.title}" references a dataset that no longer exists.`)]
      }
      return []

    case 'query':
      if (!queries[cell.queryId]) {
        return [issue(cellRef, { kind: 'query', id: cell.queryId }, 'QUERY_NOT_FOUND', `QueryCell "${cell.title}" references a query that no longer exists.`)]
      }
      return []

    case 'model':
      if (!models[cell.modelId]) {
        return [issue(cellRef, { kind: 'model', id: cell.modelId }, 'MODEL_NOT_FOUND', `ModelCell "${cell.title}" references a model that no longer exists.`)]
      }
      return []

    case 'calculated-column': {
      const model = models[cell.modelId]
      if (!model) {
        return [issue(cellRef, { kind: 'model', id: cell.modelId }, 'MODEL_NOT_FOUND', `CalculatedColumnCell "${cell.title}" references a model that no longer exists.`)]
      }
      if (!model.calculatedColumns.some((c) => c.id === cell.calculatedColumnId)) {
        return [
          issue(
            cellRef,
            { kind: 'calculated-column', id: cell.calculatedColumnId },
            'CALCULATED_COLUMN_NOT_FOUND',
            `CalculatedColumnCell "${cell.title}" references a calculated column that no longer exists in its model.`,
          ),
        ]
      }
      return []
    }

    case 'measure': {
      const model = models[cell.modelId]
      if (!model) {
        return [issue(cellRef, { kind: 'model', id: cell.modelId }, 'MODEL_NOT_FOUND', `MeasureCell "${cell.title}" references a model that no longer exists.`)]
      }
      if (!model.measures.some((m) => m.id === cell.measureId)) {
        return [
          issue(
            cellRef,
            { kind: 'measure', id: cell.measureId },
            'MEASURE_NOT_FOUND',
            `MeasureCell "${cell.title}" references a measure that no longer exists in its model.`,
          ),
        ]
      }
      return []
    }

    case 'visual':
      if (!models[cell.modelId]) {
        return [issue(cellRef, { kind: 'model', id: cell.modelId }, 'MODEL_NOT_FOUND', `VisualCell "${cell.title}" references a model that no longer exists.`)]
      }
      return []

    case 'test':
      if (cell.scope.kind === 'model' && !models[cell.scope.modelId]) {
        return [issue(cellRef, { kind: 'model', id: cell.scope.modelId }, 'MODEL_NOT_FOUND', `TestCell "${cell.title}" is scoped to a model that no longer exists.`)]
      }
      return []

    default:
      return []
  }
}

/** Structural reference checks inside one SemanticModel — brief §2's ModelTable/Relationship/CalculatedColumn/Measure/DateTableDefinition invariants. */
export function modelReferenceIssues(model: SemanticModel, datasets: Record<string, Dataset>): WorkspaceIntegrityIssue[] {
  const issues: WorkspaceIntegrityIssue[] = []
  const tableIds = new Set(model.tables.map((t) => t.id))

  for (const table of model.tables) {
    if (!resolveTableRef(datasets, table)) {
      issues.push(
        issue(
          { kind: 'model-table', id: table.id },
          { kind: 'dataset-table', id: `${table.datasetId}/${table.tableId}` },
          'DATASET_TABLE_NOT_FOUND',
          `A table in model "${model.name}" references a dataset/table that no longer exists.`,
        ),
      )
    }
  }

  for (const relationship of model.relationships) {
    if (!resolveColumnRef(datasets, relationship.left)) {
      issues.push(
        issue(
          { kind: 'relationship', id: relationship.id },
          { kind: 'dataset-column', id: `${relationship.left.datasetId}/${relationship.left.tableId}/${relationship.left.columnId}` },
          'COLUMN_NOT_FOUND',
          `A relationship in model "${model.name}" references a column that no longer exists (left side).`,
        ),
      )
    }
    if (!resolveColumnRef(datasets, relationship.right)) {
      issues.push(
        issue(
          { kind: 'relationship', id: relationship.id },
          { kind: 'dataset-column', id: `${relationship.right.datasetId}/${relationship.right.tableId}/${relationship.right.columnId}` },
          'COLUMN_NOT_FOUND',
          `A relationship in model "${model.name}" references a column that no longer exists (right side).`,
        ),
      )
    }
  }

  for (const calculatedColumn of model.calculatedColumns) {
    if (!tableIds.has(calculatedColumn.modelTableId)) {
      issues.push(
        issue(
          { kind: 'calculated-column', id: calculatedColumn.id },
          { kind: 'model-table', id: calculatedColumn.modelTableId },
          'MODEL_TABLE_NOT_FOUND',
          `Calculated column "${calculatedColumn.name}" references a table that no longer exists in model "${model.name}".`,
        ),
      )
    }
  }

  for (const measure of model.measures) {
    if (!tableIds.has(measure.homeModelTableId)) {
      issues.push(
        issue(
          { kind: 'measure', id: measure.id },
          { kind: 'model-table', id: measure.homeModelTableId },
          'MODEL_TABLE_NOT_FOUND',
          `Measure "${measure.name}" references a home table that no longer exists in model "${model.name}".`,
        ),
      )
    }
  }

  for (const dateTable of model.dateTables) {
    if (!tableIds.has(dateTable.modelTableId)) {
      issues.push(
        issue(
          { kind: 'date-table', id: dateTable.modelTableId },
          { kind: 'model-table', id: dateTable.modelTableId },
          'MODEL_TABLE_NOT_FOUND',
          `A date table marking in model "${model.name}" references a table that no longer exists.`,
        ),
      )
      continue
    }
    if (!resolveColumnRef(datasets, dateTable.dateColumn)) {
      issues.push(
        issue(
          { kind: 'date-table', id: dateTable.modelTableId },
          {
            kind: 'dataset-column',
            id: `${dateTable.dateColumn.datasetId}/${dateTable.dateColumn.tableId}/${dateTable.dateColumn.columnId}`,
          },
          'COLUMN_NOT_FOUND',
          `The date column for a date table marking in model "${model.name}" no longer exists.`,
        ),
      )
    }
  }

  return issues
}

/** Structural reference checks for one QueryDefinition — brief §2's "Query source"/"Query merge/append dependencies" invariants. */
export function queryReferenceIssues(
  query: QueryDefinition,
  datasets: Record<string, Dataset>,
  queries: Record<string, QueryDefinition>,
): WorkspaceIntegrityIssue[] {
  const issues: WorkspaceIntegrityIssue[] = []
  const queryRef: WorkspaceRef = { kind: 'query', id: query.id }

  if (query.source.kind === 'dataset-table') {
    const source = query.source
    const dataset = datasets[source.datasetId]
    const table = dataset?.tables.find((t) => t.id === source.tableId)
    if (!dataset || !table) {
      issues.push(
        issue(
          queryRef,
          { kind: 'dataset-table', id: `${source.datasetId}/${source.tableId}` },
          'DATASET_TABLE_NOT_FOUND',
          `Query "${query.name}" sources from a dataset/table that no longer exists.`,
        ),
      )
    }
  }

  // queryDependencyIds already covers a query-kind source plus every Merge/Append reference.
  for (const depId of queryDependencyIds(query)) {
    if (!queries[depId]) {
      issues.push(issue(queryRef, { kind: 'query', id: depId }, 'QUERY_NOT_FOUND', `Query "${query.name}" references a query that no longer exists.`))
    }
  }

  return issues
}
