import type { NotebookCell as NotebookCellModel } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import type { CalculatedColumn, ColumnRef, Measure, RelationshipDiagnostic, SemanticModel, TableRef } from '../../domain/model'
import type { QueryDefinition } from '../../domain/query'
import type { ValidationRun } from '../../domain/validation'
import type { VisualSpec } from '../../domain/visual'
import type { ExpressionDiagnostic } from '../../expression/diagnostics'
import type { DateTableDiagnostic } from '../../runtime/dateTable/dateTableTypes'
import type { CalculatedColumnExecution } from '../../runtime/calculatedColumn/calculatedColumnRuntime'
import type { FilterContext } from '../../runtime/measure/filterContext'
import type { MeasureExecution } from '../../runtime/measure/measureRuntime'
import type { RelationshipConfigInput } from '../../runtime/model/modelRuntime'
import type { DeleteQueryResult } from '../../runtime/notebook/notebookRuntime'
import type { QueryEvaluationDetail } from '../../runtime/query/queryRuntime'
import type { NewStepInput } from '../../runtime/query/queryStepFactory'
import { NotebookCellCard } from '../NotebookCellCard'
import { CalculatedColumnCellCard } from './CalculatedColumnCellCard'
import { DataCellCard } from './DataCellCard'
import { MeasureCellCard } from './MeasureCellCard'
import { ModelCellCard } from './ModelCellCard'
import { QueryCellCard } from './query/QueryCellCard'
import { TestCellCard } from './TestCellCard'
import { VisualCellCard } from './VisualCellCard'

interface NotebookCellProps {
  cell: NotebookCellModel
  datasets: Record<string, Dataset>
  models: Record<string, SemanticModel>
  queries: Record<string, QueryDefinition>
  queryEvaluations: Record<string, QueryEvaluationDetail>
  onRemoveDataset: (datasetId: string) => void
  onTransformDataset: (datasetId: string, tableId: string) => void
  onRenameQuery: (queryId: string, name: string) => void
  onAddQueryStep: (queryId: string, input: NewStepInput, name?: string) => void
  onRenameQueryStep: (queryId: string, stepId: string, name: string) => void
  onRemoveQueryStep: (queryId: string, stepId: string) => void
  onMoveQueryStep: (queryId: string, stepId: string, toIndex: number) => void
  onSetQueryLoadEnabled: (queryId: string, loadEnabled: boolean) => void
  onDeleteQuery: (queryId: string) => Promise<DeleteQueryResult>
  onRemoveModel: (modelId: string) => void
  onAddTableToModel: (modelId: string, ref: TableRef) => void
  onRemoveTableFromModel: (modelId: string, modelTableId: string) => void
  onMoveModelTable: (modelId: string, modelTableId: string, position: { x: number; y: number }) => void
  onCreateRelationship: (modelId: string, input: RelationshipConfigInput) => Promise<RelationshipDiagnostic[]>
  onUpdateRelationship: (modelId: string, relationshipId: string, changes: RelationshipConfigInput) => Promise<RelationshipDiagnostic[]>
  onRemoveRelationship: (modelId: string, relationshipId: string) => void
  onSetRelationshipActive: (modelId: string, relationshipId: string, active: boolean) => Promise<RelationshipDiagnostic[]>
  onMarkDateTable: (modelId: string, modelTableId: string, dateColumn: ColumnRef) => Promise<DateTableDiagnostic[]>
  onUnmarkDateTable: (modelId: string, modelTableId: string) => void
  onUpdateCalculatedColumn: (
    modelId: string,
    calculatedColumnId: string,
    patch: { name?: string; expression?: string },
  ) => Promise<{ calculatedColumn?: CalculatedColumn; execution?: CalculatedColumnExecution; diagnostics: ExpressionDiagnostic[] }>
  onRemoveCalculatedColumnCell: (cellId: string) => void
  onUpdateMeasure: (
    modelId: string,
    measureId: string,
    patch: { name?: string; expression?: string },
  ) => Promise<{ measure?: Measure; execution?: MeasureExecution; diagnostics: ExpressionDiagnostic[] }>
  onRemoveMeasureCell: (cellId: string) => void
  currentValidationRuns: Record<string, ValidationRun>
  staleTestCellIds: Set<string>
  onRunValidation: (cellId: string) => void
  onRemoveTestCell: (cellId: string) => void
  notebookVisualContext: FilterContext
  slicerSelections: Record<string, unknown[]>
  onSlicerChange: (cellId: string, values: unknown[]) => void
  onUpdateVisualCell: (cellId: string, patch: Partial<VisualSpec>, title?: string) => void
  onRemoveVisualCell: (cellId: string) => void
}

/** Dispatches a notebook cell to its renderer. `data`, `model`, `calculated-column` and `measure` are functional so far. */
export function NotebookCell({
  cell,
  datasets,
  models,
  queries,
  queryEvaluations,
  onRemoveDataset,
  onTransformDataset,
  onRenameQuery,
  onAddQueryStep,
  onRenameQueryStep,
  onRemoveQueryStep,
  onMoveQueryStep,
  onSetQueryLoadEnabled,
  onDeleteQuery,
  onRemoveModel,
  onAddTableToModel,
  onRemoveTableFromModel,
  onMoveModelTable,
  onCreateRelationship,
  onUpdateRelationship,
  onRemoveRelationship,
  onSetRelationshipActive,
  onMarkDateTable,
  onUnmarkDateTable,
  onUpdateCalculatedColumn,
  onRemoveCalculatedColumnCell,
  onUpdateMeasure,
  onRemoveMeasureCell,
  currentValidationRuns,
  staleTestCellIds,
  onRunValidation,
  onRemoveTestCell,
  notebookVisualContext,
  slicerSelections,
  onSlicerChange,
  onUpdateVisualCell,
  onRemoveVisualCell,
}: NotebookCellProps) {
  if (cell.kind === 'data') {
    const dataset = datasets[cell.datasetId]
    return (
      <DataCellCard
        cell={cell}
        dataset={dataset}
        onRemove={() => onRemoveDataset(cell.datasetId)}
        onTransformData={(tableId) => onTransformDataset(cell.datasetId, tableId)}
      />
    )
  }

  if (cell.kind === 'query') {
    const query = queries[cell.queryId]
    return (
      <QueryCellCard
        cell={cell}
        query={query}
        evaluation={queryEvaluations[cell.queryId]}
        queries={queries}
        queryEvaluations={queryEvaluations}
        datasets={datasets}
        onRename={(name) => onRenameQuery(cell.queryId, name)}
        onAddStep={(input, name) => onAddQueryStep(cell.queryId, input, name)}
        onRenameStep={(stepId, name) => onRenameQueryStep(cell.queryId, stepId, name)}
        onRemoveStep={(stepId) => onRemoveQueryStep(cell.queryId, stepId)}
        onMoveStep={(stepId, toIndex) => onMoveQueryStep(cell.queryId, stepId, toIndex)}
        onSetLoadEnabled={(loadEnabled) => onSetQueryLoadEnabled(cell.queryId, loadEnabled)}
        onRemove={() => onDeleteQuery(cell.queryId)}
      />
    )
  }

  if (cell.kind === 'model') {
    const model = models[cell.modelId]
    return (
      <ModelCellCard
        cell={cell}
        model={model}
        datasets={datasets}
        onRemoveModel={() => onRemoveModel(cell.modelId)}
        onAddTable={(ref) => onAddTableToModel(cell.modelId, ref)}
        onRemoveTable={(modelTableId) => onRemoveTableFromModel(cell.modelId, modelTableId)}
        onMoveTable={(modelTableId, position) => onMoveModelTable(cell.modelId, modelTableId, position)}
        onCreateRelationship={(input) => onCreateRelationship(cell.modelId, input)}
        onUpdateRelationship={(relationshipId, changes) => onUpdateRelationship(cell.modelId, relationshipId, changes)}
        onRemoveRelationship={(relationshipId) => onRemoveRelationship(cell.modelId, relationshipId)}
        onSetRelationshipActive={(relationshipId, active) => onSetRelationshipActive(cell.modelId, relationshipId, active)}
        onMarkDateTable={(modelTableId, dateColumn) => onMarkDateTable(cell.modelId, modelTableId, dateColumn)}
        onUnmarkDateTable={(modelTableId) => onUnmarkDateTable(cell.modelId, modelTableId)}
      />
    )
  }

  if (cell.kind === 'calculated-column') {
    const model = models[cell.modelId]
    return (
      <CalculatedColumnCellCard
        cell={cell}
        model={model}
        datasets={datasets}
        onUpdate={(patch) => onUpdateCalculatedColumn(cell.modelId, cell.calculatedColumnId, patch)}
        onRemove={() => onRemoveCalculatedColumnCell(cell.id)}
      />
    )
  }

  if (cell.kind === 'measure') {
    const model = models[cell.modelId]
    return (
      <MeasureCellCard
        cell={cell}
        model={model}
        datasets={datasets}
        onUpdate={(patch) => onUpdateMeasure(cell.modelId, cell.measureId, patch)}
        onRemove={() => onRemoveMeasureCell(cell.id)}
      />
    )
  }

  if (cell.kind === 'test') {
    const model = models[cell.modelId]
    return (
      <TestCellCard
        cell={cell}
        model={model}
        datasets={datasets}
        run={currentValidationRuns[cell.id]}
        hasStaleRun={staleTestCellIds.has(cell.id)}
        onRun={() => onRunValidation(cell.id)}
        onRemove={() => onRemoveTestCell(cell.id)}
      />
    )
  }

  if (cell.kind === 'visual') {
    const model = models[cell.modelId]
    return (
      <VisualCellCard
        cell={cell}
        model={model}
        datasets={datasets}
        notebookContext={notebookVisualContext}
        slicerSelection={slicerSelections[cell.id] ?? []}
        onSlicerChange={(values) => onSlicerChange(cell.id, values)}
        onUpdate={(patch, title) => onUpdateVisualCell(cell.id, patch, title)}
        onRemove={() => onRemoveVisualCell(cell.id)}
      />
    )
  }

  return <NotebookCellCard cell={cell} />
}
