import { useState } from 'react'
import type { Dataset } from '../../domain/data'
import type { CalculatedColumn, SemanticModel } from '../../domain/model'
import type { ExpressionDiagnostic } from '../../expression/diagnostics'
import type { CalculatedColumnExecution, CalculatedColumnInput } from '../../runtime/calculatedColumn/calculatedColumnRuntime'
import { resolveTableRef } from '../../runtime/model/modelRuntime'
import { ExpressionEditor } from './calculatedColumn/ExpressionEditor'

interface CreateCalculatedColumnPanelProps {
  models: Record<string, SemanticModel>
  datasets: Record<string, Dataset>
  onCreate: (
    modelId: string,
    input: CalculatedColumnInput,
  ) => Promise<{ calculatedColumn?: CalculatedColumn; execution?: CalculatedColumnExecution; diagnostics: ExpressionDiagnostic[] }>
}

function tableOptions(model: SemanticModel | undefined, datasets: Record<string, Dataset>) {
  if (!model) return []
  return model.tables.map((t) => ({ id: t.id, name: resolveTableRef(datasets, t)?.table.name ?? 'Unknown table' }))
}

/** The only way a CalculatedColumnCell comes into existence — see docs/CALCULATED_COLUMNS.md "Persistence" for why a cell always references a valid, already-created definition. */
export function CreateCalculatedColumnPanel({ models, datasets, onCreate }: CreateCalculatedColumnPanelProps) {
  const [open, setOpen] = useState(false)
  const [modelId, setModelId] = useState('')
  const [modelTableId, setModelTableId] = useState('')
  const [name, setName] = useState('')
  const [expression, setExpression] = useState('')
  const [diagnostics, setDiagnostics] = useState<ExpressionDiagnostic[]>([])
  const [submitting, setSubmitting] = useState(false)

  const availableModels = Object.values(models).filter((m) => m.tables.length > 0)

  if (availableModels.length === 0) {
    return null
  }

  function reset() {
    setModelId('')
    setModelTableId('')
    setName('')
    setExpression('')
    setDiagnostics([])
    setOpen(false)
  }

  async function handleCreate() {
    if (!modelId || !modelTableId || name.trim() === '' || expression.trim() === '') return
    setSubmitting(true)
    try {
      const result = await onCreate(modelId, { modelTableId, name, expression })
      if (result.calculatedColumn) {
        reset()
      } else {
        setDiagnostics(result.diagnostics)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) {
    return (
      <button type="button" className="secondary-button" onClick={() => setOpen(true)}>
        + New calculated column
      </button>
    )
  }

  const model = modelId ? models[modelId] : undefined

  return (
    <div className="create-calculated-column-panel">
      <h3>New calculated column</h3>
      <div className="create-calculated-column-panel__fields">
        <select
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value)
            setModelTableId('')
          }}
        >
          <option value="">Model…</option>
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select value={modelTableId} onChange={(e) => setModelTableId(e.target.value)} disabled={!model}>
          <option value="">Table…</option>
          {tableOptions(model, datasets).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="create-calculated-column-panel__name"
          placeholder="Column name (e.g. Margin)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <ExpressionEditor
        value={expression}
        onChange={setExpression}
        onRun={handleCreate}
        diagnostics={diagnostics}
        running={submitting}
        runLabel="Create"
      />

      <button type="button" className="text-button" onClick={reset}>
        Cancel
      </button>
    </div>
  )
}
