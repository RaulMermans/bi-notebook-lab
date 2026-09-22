import { useMemo, useState } from 'react'
import type { QueryCell } from '../../../domain/notebook'
import type { Dataset } from '../../../domain/data'
import type { QueryDefinition, QueryStep, QueryStepKind } from '../../../domain/query'
import { frameAtStep, resolveSourceColumns, type QueryEvaluationDetail } from '../../../runtime/query/queryRuntime'
import type { NewStepInput } from '../../../runtime/query/queryStepFactory'
import {
  AppendQueriesForm,
  ChangeTypeForm,
  ConditionalColumnForm,
  CustomColumnForm,
  FillForm,
  FilterRowsForm,
  GroupByForm,
  IndexColumnForm,
  MergeColumnsForm,
  MergeQueriesForm,
  PivotColumnForm,
  RemoveColumnsForm,
  RemoveDuplicatesForm,
  RenameColumnsForm,
  ReorderColumnsForm,
  ReplaceValuesForm,
  SortRowsForm,
  SplitColumnForm,
  UnpivotColumnsForm,
} from './queryStepForms'

const PREVIEW_ROW_LIMIT = 500

interface QueryCellCardProps {
  cell: QueryCell
  query: QueryDefinition | undefined
  evaluation: QueryEvaluationDetail | undefined
  queries: Record<string, QueryDefinition>
  queryEvaluations: Record<string, QueryEvaluationDetail>
  datasets: Record<string, Dataset>
  onRename: (name: string) => void
  onAddStep: (input: NewStepInput, name?: string) => void
  onRenameStep: (stepId: string, name: string) => void
  onRemoveStep: (stepId: string) => void
  onMoveStep: (stepId: string, toIndex: number) => void
  onSetLoadEnabled: (loadEnabled: boolean) => void
  onRemove: () => Promise<{ deleted: boolean; blockedByQueries: string[]; referencedByModels: string[] }>
}

const TOOLBAR_KINDS: { kind: QueryStepKind; label: string }[] = [
  { kind: 'rename-columns', label: 'Rename' },
  { kind: 'remove-columns', label: 'Remove' },
  { kind: 'reorder-columns', label: 'Reorder' },
  { kind: 'change-type', label: 'Change Type' },
  { kind: 'filter-rows', label: 'Filter' },
  { kind: 'replace-values', label: 'Replace' },
  { kind: 'remove-duplicates', label: 'Remove Duplicates' },
  { kind: 'sort-rows', label: 'Sort' },
  { kind: 'fill', label: 'Fill' },
  { kind: 'split-column', label: 'Split' },
  { kind: 'merge-columns', label: 'Merge Columns' },
  { kind: 'group-by', label: 'Group By' },
  { kind: 'merge-queries', label: 'Merge Queries' },
  { kind: 'append-queries', label: 'Append Queries' },
  { kind: 'pivot-column', label: 'Pivot' },
  { kind: 'unpivot-columns', label: 'Unpivot' },
  { kind: 'conditional-column', label: 'Conditional Column' },
  { kind: 'index-column', label: 'Index Column' },
  { kind: 'custom-column', label: 'Custom Column' },
]

function stepStatusIcon(step: QueryStep, evaluation: QueryEvaluationDetail | undefined): string {
  const result = evaluation?.stepResults.find((r) => r.stepId === step.id)
  if (!result) return '•'
  if (result.status === 'success') return '✓'
  if (result.status === 'error') return '✗'
  return '…'
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

export function QueryCellCard({
  cell,
  query,
  evaluation,
  queries,
  queryEvaluations,
  datasets,
  onRename,
  onAddStep,
  onRenameStep,
  onRemoveStep,
  onMoveStep,
  onSetLoadEnabled,
  onRemove,
}: QueryCellCardProps) {
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null)
  const [activeToolbarKind, setActiveToolbarKind] = useState<QueryStepKind | null>(null)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [deleteWarning, setDeleteWarning] = useState<string | null>(null)

  const otherQueries = useMemo(() => {
    if (!query) return []
    return Object.values(queries)
      .filter((q) => q.id !== query.id)
      .map((q) => ({
        queryId: q.id,
        name: q.name,
        columns: resolveSourceColumns({ kind: 'query', queryId: q.id }, datasets, queryEvaluations) ?? [],
      }))
  }, [query, queries, queryEvaluations, datasets])

  if (!query) {
    return (
      <article className="cell cell--query cell--missing">
        <div className="cell__rail"><span>QUERY</span></div>
        <div className="cell__body"><p>Query for &quot;{cell.title}&quot; is missing. It may still be loading.</p></div>
      </article>
    )
  }

  const stepCount = query.steps.length
  const effectiveIndex = selectedStepIndex ?? stepCount
  const frame = evaluation ? frameAtStep(evaluation, effectiveIndex) : undefined
  const selectedStepResult = effectiveIndex > 0 ? evaluation?.stepResults[effectiveIndex - 1] : undefined
  const selectedStepDiagnostics = selectedStepResult?.diagnostics ?? (effectiveIndex === 0 ? evaluation?.diagnostics.filter((d) => !d.stepId) : [])

  const formColumns = frame?.columns ?? []

  function handleSubmitStep(input: NewStepInput) {
    onAddStep(input)
    setActiveToolbarKind(null)
    setSelectedStepIndex(null)
  }

  async function handleRemove() {
    const result = await onRemove()
    if (!result.deleted) {
      setDeleteWarning(
        result.blockedByQueries.length > 0
          ? `Can't delete: ${result.blockedByQueries.length} other quer${result.blockedByQueries.length === 1 ? 'y' : 'ies'} still reference this one.`
          : "Can't delete this query.",
      )
    }
  }

  return (
    <article className="cell cell--query">
      <div className="cell__rail"><span>QUERY</span></div>
      <div className="cell__body">
        <div className="cell__header">
          <div>
            {nameDraft !== null ? (
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={() => {
                  if (nameDraft.trim()) onRename(nameDraft.trim())
                  setNameDraft(null)
                }}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            ) : (
              <h2 onClick={() => setNameDraft(query.name)} title="Click to rename">{query.name}</h2>
            )}
            <p className="cell__meta">
              {evaluation?.output ? `${evaluation.output.tables[0].rowCount.toLocaleString()} rows · ${evaluation.output.tables[0].columns.length} columns` : 'Not yet evaluated'}
              {evaluation?.status === 'error' && ' · has errors'}
            </p>
          </div>
          <div className="cell__header-actions">
            <label className="query-load-toggle">
              <input type="checkbox" checked={query.loadEnabled} onChange={(e) => onSetLoadEnabled(e.target.checked)} />
              Enable Load
            </label>
            <button type="button" className="text-button" onClick={handleRemove}>Remove</button>
          </div>
        </div>

        {deleteWarning && <p className="import-panel__error" role="alert">{deleteWarning}</p>}

        <div className="query-layout">
          <ol className="query-steps">
            <li className={effectiveIndex === 0 ? 'query-step query-step--active' : 'query-step'} onClick={() => setSelectedStepIndex(0)}>
              <span className="query-step__status">✓</span>
              <span>Source</span>
            </li>
            {query.steps.map((step, index) => {
              const position = index + 1
              const result = evaluation?.stepResults[index]
              return (
                <li
                  key={step.id}
                  className={`query-step ${effectiveIndex === position ? 'query-step--active' : ''} ${result?.status === 'error' ? 'query-step--error' : ''}`}
                  onClick={() => setSelectedStepIndex(position)}
                >
                  <span className="query-step__status">{stepStatusIcon(step, evaluation)}</span>
                  <span>{step.name}</span>
                  {result?.status === 'success' && (
                    <span className="query-step__metrics">{result.inputRows.toLocaleString()} → {result.outputRows.toLocaleString()} rows</span>
                  )}
                  <span className="query-step__actions">
                    <button type="button" className="text-button" onClick={(e) => { e.stopPropagation(); onMoveStep(step.id, index - 1) }} disabled={index === 0}>↑</button>
                    <button type="button" className="text-button" onClick={(e) => { e.stopPropagation(); onMoveStep(step.id, index + 1) }} disabled={index === stepCount - 1}>↓</button>
                    <button type="button" className="text-button" onClick={(e) => { e.stopPropagation(); onRemoveStep(step.id) }}>Delete</button>
                  </span>
                </li>
              )
            })}
          </ol>

          <div className="query-preview">
            {selectedStepDiagnostics && selectedStepDiagnostics.length > 0 && (
              <ul className="diagnostic-list">
                {selectedStepDiagnostics.map((d, i) => (
                  <li key={i} className={`diagnostic diagnostic--${d.severity}`}>
                    <strong>{d.code}</strong> — {d.message}
                  </li>
                ))}
              </ul>
            )}

            {frame ? (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      {frame.columns.map((c) => (
                        <th key={c.id}>
                          <span className="data-table__name">{c.name}</span>
                          <span className="type-badge">{c.dataType}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {frame.rows.slice(0, PREVIEW_ROW_LIMIT).map((row, i) => (
                      <tr key={i}>
                        {frame.columns.map((c) => (
                          <td key={c.id}>{formatCell(row[c.name])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {frame.rows.length > PREVIEW_ROW_LIMIT && (
                  <p className="table-scroll__note">Previewing {PREVIEW_ROW_LIMIT} of {frame.rows.length.toLocaleString()} rows.</p>
                )}
              </div>
            ) : (
              <p className="cell__meta">This step did not produce output — fix the diagnostic above, or an earlier step.</p>
            )}
          </div>
        </div>

        <div className="query-toolbar">
          {TOOLBAR_KINDS.map((t) => (
            <button key={t.kind} type="button" className="secondary-button" onClick={() => setActiveToolbarKind((k) => (k === t.kind ? null : t.kind))}>
              {t.label}
            </button>
          ))}
        </div>

        {activeToolbarKind === 'rename-columns' && <RenameColumnsForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'remove-columns' && <RemoveColumnsForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'reorder-columns' && <ReorderColumnsForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'change-type' && <ChangeTypeForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'filter-rows' && <FilterRowsForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'replace-values' && <ReplaceValuesForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'remove-duplicates' && <RemoveDuplicatesForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'sort-rows' && <SortRowsForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'fill' && <FillForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'split-column' && <SplitColumnForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'merge-columns' && <MergeColumnsForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'group-by' && <GroupByForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'merge-queries' && (
          <MergeQueriesForm columns={formColumns} otherQueries={otherQueries} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />
        )}
        {activeToolbarKind === 'append-queries' && (
          <AppendQueriesForm otherQueries={otherQueries} currentColumnNames={formColumns.map((c) => c.name)} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />
        )}
        {activeToolbarKind === 'pivot-column' && <PivotColumnForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'unpivot-columns' && <UnpivotColumnsForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'conditional-column' && <ConditionalColumnForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'index-column' && <IndexColumnForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}
        {activeToolbarKind === 'custom-column' && <CustomColumnForm columns={formColumns} onSubmit={handleSubmitStep} onCancel={() => setActiveToolbarKind(null)} />}

        <details className="query-settings">
          <summary>Query Settings</summary>
          <ul className="query-settings__steps">
            <li>Source</li>
            {query.steps.map((step) => (
              <li key={step.id}>
                <input value={step.name} onChange={(e) => onRenameStep(step.id, e.target.value)} />
              </li>
            ))}
          </ul>
        </details>
      </div>
    </article>
  )
}
