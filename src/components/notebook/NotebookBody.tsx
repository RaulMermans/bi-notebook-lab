import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { NotebookDocument } from '../../domain/notebook'
import type { QueryDefinition } from '../../domain/query'
import type { ValidationRun } from '../../domain/validation'
import type { FilterContext } from '../../runtime/measure/filterContext'
import type { useNotebookRuntime } from '../../runtime/notebook/useNotebookRuntime'
import type { QueryEvaluationDetail } from '../../runtime/query/queryRuntime'
import { AddTestCellPanel } from './AddTestCellPanel'
import { AddVisualCellPanel } from './AddVisualCellPanel'
import { CreateCalculatedColumnPanel } from './CreateCalculatedColumnPanel'
import { CreateMeasurePanel } from './CreateMeasurePanel'
import { ImportDataPanel } from './ImportDataPanel'
import { NotebookCell } from './NotebookCell'

type NotebookActions = ReturnType<typeof useNotebookRuntime>['actions']

interface NotebookBodyProps {
  notebook: NotebookDocument
  datasets: Record<string, Dataset>
  models: Record<string, SemanticModel>
  queries: Record<string, QueryDefinition>
  queryEvaluations: Record<string, QueryEvaluationDetail>
  actions: NotebookActions
  currentValidationRuns: Record<string, ValidationRun>
  staleTestCellIds: Set<string>
  onRunValidation: (cellId: string) => void
  notebookVisualContext: FilterContext
  slicerSelections: Record<string, unknown[]>
  onSlicerChange: (cellId: string, values: unknown[]) => void
}

/**
 * The notebook cell list plus the "add cell" action bar — exactly what
 * `App.tsx` rendered inline before Sprint 13. Shared by the Free Lab
 * (`NotebookWorkspace`) and every lesson (`LessonWorkspace`) so there is
 * only one notebook execution UI (sprint brief "Do not build a second
 * execution UI for lessons").
 */
export function NotebookBody({
  notebook,
  datasets,
  models,
  queries,
  queryEvaluations,
  actions,
  currentValidationRuns,
  staleTestCellIds,
  onRunValidation,
  notebookVisualContext,
  slicerSelections,
  onSlicerChange,
}: NotebookBodyProps) {
  return (
    <div className="notebook">
      {notebook.cells.map((cell) => (
        <NotebookCell
          key={cell.id}
          cell={cell}
          datasets={datasets}
          models={models}
          queries={queries}
          queryEvaluations={queryEvaluations}
          onRemoveDataset={actions.removeDataset}
          onTransformDataset={(datasetId, tableId) => void actions.createQueryFromDataset(datasetId, tableId)}
          onRenameQuery={(queryId, name) => void actions.renameQuery(queryId, name)}
          onAddQueryStep={(queryId, input, name) => void actions.addQueryStep(queryId, input, name)}
          onRenameQueryStep={(queryId, stepId, name) => void actions.renameQueryStep(queryId, stepId, name)}
          onRemoveQueryStep={(queryId, stepId) => void actions.removeQueryStep(queryId, stepId)}
          onMoveQueryStep={(queryId, stepId, toIndex) => void actions.moveQueryStep(queryId, stepId, toIndex)}
          onSetQueryLoadEnabled={(queryId, loadEnabled) => actions.setQueryLoadEnabled(queryId, loadEnabled)}
          onDeleteQuery={actions.deleteQuery}
          onRemoveModel={actions.removeModel}
          onAddTableToModel={actions.addTableToModel}
          onRemoveTableFromModel={actions.removeTableFromModel}
          onMoveModelTable={actions.moveModelTable}
          onCreateRelationship={actions.createRelationship}
          onUpdateRelationship={actions.updateRelationship}
          onRemoveRelationship={actions.removeRelationship}
          onSetRelationshipActive={actions.setRelationshipActive}
          onMarkDateTable={actions.markDateTable}
          onUnmarkDateTable={actions.unmarkDateTable}
          onUpdateCalculatedColumn={actions.updateCalculatedColumn}
          onRemoveCalculatedColumnCell={actions.removeCalculatedColumnCell}
          onUpdateMeasure={actions.updateMeasure}
          onRemoveMeasureCell={actions.removeMeasureCell}
          currentValidationRuns={currentValidationRuns}
          staleTestCellIds={staleTestCellIds}
          onRunValidation={onRunValidation}
          onRemoveTestCell={actions.removeTestCell}
          notebookVisualContext={notebookVisualContext}
          slicerSelections={slicerSelections}
          onSlicerChange={onSlicerChange}
          onUpdateVisualCell={actions.updateVisualCell}
          onRemoveVisualCell={actions.removeVisualCell}
        />
      ))}
      <div className="notebook__add-actions">
        <ImportDataPanel onImportDataset={actions.importDataset} compact />
        <button type="button" className="secondary-button" onClick={() => actions.createModelCell()}>
          + New model
        </button>
        <CreateCalculatedColumnPanel models={models} datasets={datasets} onCreate={actions.createCalculatedColumnCell} />
        <CreateMeasurePanel models={models} datasets={datasets} onCreate={actions.createMeasureCell} />
        <AddTestCellPanel models={models} onCreate={actions.createTestCell} />
        <AddVisualCellPanel models={models} datasets={datasets} onCreate={actions.createVisualCell} />
        {Object.keys(queries).length > 0 && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              const sourceId = window.prompt(`Reference which query?\n${Object.values(queries).map((q) => `${q.name} (${q.id})`).join('\n')}`)
              if (sourceId) void actions.createQueryFromQuery(sourceId.trim())
            }}
          >
            + Reference Query
          </button>
        )}
      </div>
    </div>
  )
}
