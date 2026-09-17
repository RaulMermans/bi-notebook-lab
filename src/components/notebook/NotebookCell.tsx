import type { NotebookCell as NotebookCellModel } from '../../domain/notebook'
import type { Dataset } from '../../domain/data'
import type { CalculatedColumn, ColumnRef, Measure, RelationshipDiagnostic, SemanticModel, TableRef } from '../../domain/model'
import type { ExpressionDiagnostic } from '../../expression/diagnostics'
import type { CalculatedColumnExecution } from '../../runtime/calculatedColumn/calculatedColumnRuntime'
import type { MeasureExecution } from '../../runtime/measure/measureRuntime'
import { NotebookCellCard } from '../NotebookCellCard'
import { CalculatedColumnCellCard } from './CalculatedColumnCellCard'
import { DataCellCard } from './DataCellCard'
import { MeasureCellCard } from './MeasureCellCard'
import { ModelCellCard } from './ModelCellCard'

interface NotebookCellProps {
  cell: NotebookCellModel
  datasets: Record<string, Dataset>
  models: Record<string, SemanticModel>
  onRemoveDataset: (datasetId: string) => void
  onRemoveModel: (modelId: string) => void
  onAddTableToModel: (modelId: string, ref: TableRef) => void
  onRemoveTableFromModel: (modelId: string, modelTableId: string) => void
  onMoveModelTable: (modelId: string, modelTableId: string, position: { x: number; y: number }) => void
  onCreateRelationship: (
    modelId: string,
    input: { one: ColumnRef; many: ColumnRef; active: boolean },
  ) => Promise<RelationshipDiagnostic[]>
  onRemoveRelationship: (modelId: string, relationshipId: string) => void
  onSetRelationshipActive: (modelId: string, relationshipId: string, active: boolean) => void
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
}

/** Dispatches a notebook cell to its renderer. `data`, `model`, `calculated-column` and `measure` are functional so far. */
export function NotebookCell({
  cell,
  datasets,
  models,
  onRemoveDataset,
  onRemoveModel,
  onAddTableToModel,
  onRemoveTableFromModel,
  onMoveModelTable,
  onCreateRelationship,
  onRemoveRelationship,
  onSetRelationshipActive,
  onUpdateCalculatedColumn,
  onRemoveCalculatedColumnCell,
  onUpdateMeasure,
  onRemoveMeasureCell,
}: NotebookCellProps) {
  if (cell.kind === 'data') {
    const dataset = datasets[cell.datasetId]
    return <DataCellCard cell={cell} dataset={dataset} onRemove={() => onRemoveDataset(cell.datasetId)} />
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
        onRemoveRelationship={(relationshipId) => onRemoveRelationship(cell.modelId, relationshipId)}
        onSetRelationshipActive={(relationshipId, active) => onSetRelationshipActive(cell.modelId, relationshipId, active)}
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

  return <NotebookCellCard cell={cell} />
}
