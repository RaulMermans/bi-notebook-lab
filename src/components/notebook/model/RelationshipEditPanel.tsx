import { useState } from 'react'
import type { CrossFilterDirection, Relationship, RelationshipCardinality, RelationshipDiagnostic, RelationshipSide } from '../../../domain/model'
import type { RelationshipConfigInput } from '../../../runtime/model/modelRuntime'
import { directionOptionsFor, naturalSingleDirection } from './RelationshipForm'

interface RelationshipEditPanelProps {
  relationship: Relationship
  onUpdateRelationship: (relationshipId: string, changes: RelationshipConfigInput) => Promise<RelationshipDiagnostic[]>
  onDone: () => void
}

/**
 * In-place relationship editing (sprint brief §10) — cardinality, one-side
 * orientation, cross-filter direction and active state, validated
 * before-apply exactly like creation (`updateRelationship`). Never deletes
 * and recreates the relationship; `left`/`right` stay fixed (editing which
 * physical columns a relationship connects is a delete-and-recreate
 * operation, same as Power BI Desktop).
 */
export function RelationshipEditPanel({ relationship, onUpdateRelationship, onDone }: RelationshipEditPanelProps) {
  const [cardinality, setCardinality] = useState<RelationshipCardinality>(relationship.cardinality)
  const [oneSide, setOneSide] = useState<RelationshipSide>(relationship.oneSide ?? 'left')
  const [crossFilterDirection, setCrossFilterDirection] = useState<CrossFilterDirection>(relationship.crossFilterDirection)
  const [active, setActive] = useState(relationship.active)
  const [diagnostics, setDiagnostics] = useState<RelationshipDiagnostic[]>([])
  const [submitting, setSubmitting] = useState(false)

  function applyCardinality(next: RelationshipCardinality) {
    setCardinality(next)
    setCrossFilterDirection(next === 'one-to-one' ? 'both' : next === 'one-to-many' ? naturalSingleDirection(oneSide) : 'left-to-right')
  }

  async function handleSave() {
    setSubmitting(true)
    try {
      const result = await onUpdateRelationship(relationship.id, {
        left: relationship.left,
        right: relationship.right,
        cardinality,
        oneSide: cardinality === 'one-to-many' ? oneSide : undefined,
        crossFilterDirection,
        active,
      })
      setDiagnostics(result)
      if (!result.some((d) => d.severity === 'error')) onDone()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relationship-edit-panel">
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
            <option value="left">Left</option>
            <option value="right">Right</option>
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

      <div className="relationship-edit-panel__actions">
        <button type="button" className="primary-button" onClick={handleSave} disabled={submitting}>
          Save
        </button>
        <button type="button" className="text-button" onClick={onDone} disabled={submitting}>
          Cancel
        </button>
      </div>

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
