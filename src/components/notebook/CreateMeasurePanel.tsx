import { useState } from 'react'
import type { Dataset } from '../../domain/data'
import type { Measure, SemanticModel } from '../../domain/model'
import type { ExpressionDiagnostic } from '../../expression/diagnostics'
import type { MeasureExecution, MeasureInput } from '../../runtime/measure/measureRuntime'
import { resolveTableRef } from '../../runtime/model/modelRuntime'
import { ExpressionEditor } from './calculatedColumn/ExpressionEditor'

interface CreateMeasurePanelProps {
  models: Record<string, SemanticModel>
  datasets: Record<string, Dataset>
  onCreate: (
    modelId: string,
    input: MeasureInput,
  ) => Promise<{ measure?: Measure; execution?: MeasureExecution; diagnostics: ExpressionDiagnostic[] }>
}

function tableOptions(model: SemanticModel | undefined, datasets: Record<string, Dataset>) {
  if (!model) return []
  return model.tables.map((t) => ({ id: t.id, name: resolveTableRef(datasets, t)?.table.name ?? 'Unknown table' }))
}

/** The only way a MeasureCell comes into existence — mirrors CreateCalculatedColumnPanel exactly (docs/MEASURES.md "Persistence"). */
export function CreateMeasurePanel({ models, datasets, onCreate }: CreateMeasurePanelProps) {
  const [open, setOpen] = useState(false)
  const [modelId, setModelId] = useState('')
  const [homeModelTableId, setHomeModelTableId] = useState('')
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
    setHomeModelTableId('')
    setName('')
    setExpression('')
    setDiagnostics([])
    setOpen(false)
  }

  async function handleCreate() {
    if (!modelId || !homeModelTableId || name.trim() === '' || expression.trim() === '') return
    setSubmitting(true)
    try {
      const result = await onCreate(modelId, { homeModelTableId, name, expression })
      if (result.measure) {
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
        + New measure
      </button>
    )
  }

  const model = modelId ? models[modelId] : undefined

  return (
    <div className="create-calculated-column-panel">
      <h3>New measure</h3>
      <div className="create-calculated-column-panel__fields">
        <select
          value={modelId}
          onChange={(e) => {
            setModelId(e.target.value)
            setHomeModelTableId('')
          }}
        >
          <option value="">Model…</option>
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <select value={homeModelTableId} onChange={(e) => setHomeModelTableId(e.target.value)} disabled={!model}>
          <option value="">Home table…</option>
          {tableOptions(model, datasets).map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <input
          type="text"
          className="create-calculated-column-panel__name"
          placeholder="Measure name (e.g. Total Revenue)"
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
