import { useState } from 'react'
import type { Dataset } from '../../../domain/data'
import type { ColumnRef, CrossFilterDirection, RelationshipCardinality, RelationshipDiagnostic, RelationshipSide, SemanticModel } from '../../../domain/model'
import { resolveTableRef } from '../../../runtime/model/modelRuntime'
import type { RelationshipConfigInput } from '../../../runtime/model/modelRuntime'

interface RelationshipFormProps {
  model: SemanticModel
  datasets: Record<string, Dataset>
  onCreateRelationship: (input: RelationshipConfigInput) => Promise<RelationshipDiagnostic[]>
}

interface SideSelection {
  modelTableId: string
  columnId: string
}

const EMPTY_SIDE: SideSelection = { modelTableId: '', columnId: '' }

function columnsFor(model: SemanticModel, datasets: Record<string, Dataset>, modelTableId: string) {
  const modelTable = model.tables.find((t) => t.id === modelTableId)
  if (!modelTable) return []
  return resolveTableRef(datasets, modelTable)?.table.columns ?? []
}

function columnRefFor(model: SemanticModel, side: SideSelection): ColumnRef | undefined {
  const modelTable = model.tables.find((t) => t.id === side.modelTableId)
  if (!modelTable || !side.columnId) return undefined
  return { datasetId: modelTable.datasetId, tableId: modelTable.tableId, columnId: side.columnId }
}

function columnValuesFor(model: SemanticModel, datasets: Record<string, Dataset>, side: SideSelection): unknown[] | undefined {
  const modelTable = model.tables.find((t) => t.id === side.modelTableId)
  const resolved = modelTable ? resolveTableRef(datasets, modelTable) : undefined
  const column = resolved?.table.columns.find((c) => c.id === side.columnId)
  if (!resolved || !column) return undefined
  return resolved.table.rows.map((row) => row[column.name]).filter((v) => v !== null && v !== undefined)
}

function isUnique(values: unknown[]): boolean {
  return new Set(values).size === values.length
}

/** The single valid non-`'both'` direction a `one-to-many` relationship's chosen `oneSide` implies. */
export function naturalSingleDirection(oneSide: RelationshipSide): CrossFilterDirection {
  return oneSide === 'left' ? 'left-to-right' : 'right-to-left'
}

export function directionOptionsFor(cardinality: RelationshipCardinality, oneSide: RelationshipSide): { value: CrossFilterDirection; label: string }[] {
  if (cardinality === 'one-to-one') return [{ value: 'both', label: 'Both (required for 1:1)' }]
  if (cardinality === 'one-to-many') {
    return [
      { value: naturalSingleDirection(oneSide), label: 'Single (1 side filters * side)' },
      { value: 'both', label: 'Both' },
    ]
  }
  return [
    { value: 'left-to-right', label: 'Single: Table A → Table B' },
    { value: 'right-to-left', label: 'Single: Table B → Table A' },
    { value: 'both', label: 'Both' },
  ]
}

/**
 * Power BI-style relationship creation form (sprint brief §8): Table A/
 * Column, Table B/Column, a cardinality picker, a "1 side" picker that only
 * appears for 1:*, and a cross-filter-direction picker whose options are
 * computed from the chosen cardinality (locked to Both for 1:1). An optional
 * "Auto detect" button (§9) profiles the two chosen columns' real
 * uniqueness and suggests a cardinality — manual selection always remains
 * available, never the only path.
 */
export function RelationshipForm({ model, datasets, onCreateRelationship }: RelationshipFormProps) {
  const [left, setLeft] = useState<SideSelection>(EMPTY_SIDE)
  const [right, setRight] = useState<SideSelection>(EMPTY_SIDE)
  const [cardinality, setCardinality] = useState<RelationshipCardinality>('one-to-many')
  const [oneSide, setOneSide] = useState<RelationshipSide>('left')
  const [crossFilterDirection, setCrossFilterDirection] = useState<CrossFilterDirection>('left-to-right')
  const [active, setActive] = useState(true)
  const [diagnostics, setDiagnostics] = useState<RelationshipDiagnostic[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [autoDetectNote, setAutoDetectNote] = useState<string | undefined>()

  const canSubmit = left.modelTableId && left.columnId && right.modelTableId && right.columnId && !submitting

  function applyCardinality(next: RelationshipCardinality, side: RelationshipSide = oneSide) {
    setCardinality(next)
    setOneSide(side)
    setCrossFilterDirection(next === 'one-to-one' ? 'both' : next === 'one-to-many' ? naturalSingleDirection(side) : 'left-to-right')
  }

  function handleAutoDetect() {
    const leftValues = columnValuesFor(model, datasets, left)
    const rightValues = columnValuesFor(model, datasets, right)
    if (!leftValues || !rightValues) {
      setAutoDetectNote('Choose both columns first.')
      return
    }
    const leftUnique = isUnique(leftValues)
    const rightUnique = isUnique(rightValues)

    if (leftUnique && !rightUnique) {
      applyCardinality('one-to-many', 'left')
      setAutoDetectNote('Detected: Table A is unique, Table B has duplicates → one-to-many (1 side: Table A).')
    } else if (!leftUnique && rightUnique) {
      applyCardinality('one-to-many', 'right')
      setAutoDetectNote('Detected: Table B is unique, Table A has duplicates → one-to-many (1 side: Table B).')
    } else if (leftUnique && rightUnique) {
      applyCardinality('one-to-one')
      setAutoDetectNote('Detected: both columns are unique → one-to-one.')
    } else {
      applyCardinality('many-to-many')
      setAutoDetectNote('Detected: both columns have duplicates → many-to-many.')
    }
  }

  async function handleSubmit() {
    const leftRef = columnRefFor(model, left)
    const rightRef = columnRefFor(model, right)
    if (!leftRef || !rightRef) return

    setSubmitting(true)
    try {
      const result = await onCreateRelationship({
        left: leftRef,
        right: rightRef,
        cardinality,
        oneSide: cardinality === 'one-to-many' ? oneSide : undefined,
        crossFilterDirection,
        active,
      })
      setDiagnostics(result)
      if (!result.some((d) => d.severity === 'error')) {
        setLeft(EMPTY_SIDE)
        setRight(EMPTY_SIDE)
        setCardinality('one-to-many')
        setOneSide('left')
        setCrossFilterDirection('left-to-right')
        setActive(true)
        setAutoDetectNote(undefined)
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relationship-form">
      <div className="relationship-form__sides">
        <fieldset>
          <legend>Table A</legend>
          <select value={left.modelTableId} onChange={(e) => setLeft({ modelTableId: e.target.value, columnId: '' })}>
            <option value="">Table…</option>
            {model.tables.map((t) => (
              <option key={t.id} value={t.id}>
                {resolveTableRef(datasets, t)?.table.name ?? t.id}
              </option>
            ))}
          </select>
          <select value={left.columnId} onChange={(e) => setLeft((current) => ({ ...current, columnId: e.target.value }))} disabled={!left.modelTableId}>
            <option value="">Column…</option>
            {columnsFor(model, datasets, left.modelTableId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.dataType})
              </option>
            ))}
          </select>
        </fieldset>

        <span className="relationship-form__arrow">{cardinality === 'one-to-many' ? (oneSide === 'left' ? '1 → *' : '* → 1') : cardinality === 'one-to-one' ? '1 ↔ 1' : '* ↔ *'}</span>

        <fieldset>
          <legend>Table B</legend>
          <select value={right.modelTableId} onChange={(e) => setRight({ modelTableId: e.target.value, columnId: '' })}>
            <option value="">Table…</option>
            {model.tables.map((t) => (
              <option key={t.id} value={t.id}>
                {resolveTableRef(datasets, t)?.table.name ?? t.id}
              </option>
            ))}
          </select>
          <select value={right.columnId} onChange={(e) => setRight((current) => ({ ...current, columnId: e.target.value }))} disabled={!right.modelTableId}>
            <option value="">Column…</option>
            {columnsFor(model, datasets, right.modelTableId).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.dataType})
              </option>
            ))}
          </select>
        </fieldset>
      </div>

      <button type="button" className="text-button" onClick={handleAutoDetect} disabled={!left.columnId || !right.columnId}>
        Auto detect
      </button>
      {autoDetectNote && <p className="relationship-form__hint">{autoDetectNote}</p>}

      <label className="relationship-form__field">
        Cardinality
        <select value={cardinality} onChange={(e) => applyCardinality(e.target.value as RelationshipCardinality)}>
          <option value="one-to-many">1 : *</option>
          <option value="one-to-one">1 : 1</option>
          <option value="many-to-many">* : *</option>
        </select>
      </label>

      {cardinality === 'one-to-many' && (
        <label className="relationship-form__field">
          1 side
          <select
            value={oneSide}
            onChange={(e) => {
              const side = e.target.value as RelationshipSide
              setOneSide(side)
              setCrossFilterDirection((current) => (current === 'both' ? 'both' : naturalSingleDirection(side)))
            }}
          >
            <option value="left">Table A</option>
            <option value="right">Table B</option>
          </select>
        </label>
      )}

      <label className="relationship-form__field">
        Cross-filter direction
        <select
          value={crossFilterDirection}
          onChange={(e) => setCrossFilterDirection(e.target.value as CrossFilterDirection)}
          disabled={cardinality === 'one-to-one'}
        >
          {directionOptionsFor(cardinality, oneSide).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="relationship-form__active">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        Active
      </label>

      <button type="button" className="primary-button" disabled={!canSubmit} onClick={handleSubmit}>
        Create relationship
      </button>

      {diagnostics.length > 0 && (
        <ul className="diagnostic-list">
          {diagnostics.map((d, index) => (
            <li key={index} className={`diagnostic diagnostic--${d.severity}`}>
              {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
