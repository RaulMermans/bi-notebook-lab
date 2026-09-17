import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { ValidationRun, ValidationSpec } from '../../domain/validation'
import { resolveTableRef } from '../model/modelRuntime'

/** Deterministic, dependency-free 32-bit string hash (FNV-1a) — good enough for change-detection, not cryptographic use. */
function hashString(input: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * A fingerprint over exactly the semantic inputs a validation run depends
 * on: tables (and their dataset schema), relationships (and active state),
 * calculated-column/measure definitions, and the spec itself. Deliberately
 * excludes UI-only state such as a table's canvas position — dragging a
 * table must never invalidate a previous result (docs/VALIDATION_ENGINE.md
 * "Staleness"). Two models that differ only in ways that don't affect this
 * fingerprint are indistinguishable to validation, by design.
 */
export function computeValidationFingerprint(model: SemanticModel, datasets: Record<string, Dataset>, spec: ValidationSpec): string {
  const tables = [...model.tables]
    .map((t) => {
      const resolved = resolveTableRef(datasets, t)
      return {
        tableId: t.tableId,
        datasetId: t.datasetId,
        tableName: resolved?.table.name ?? null,
        columns:
          resolved?.table.columns
            .map((c) => ({ name: c.name, dataType: c.dataType }))
            .sort((a, b) => a.name.localeCompare(b.name)) ?? [],
      }
    })
    .sort((a, b) => `${a.datasetId}:${a.tableId}`.localeCompare(`${b.datasetId}:${b.tableId}`))

  const relationships = [...model.relationships]
    .map((r) => ({ one: r.one, many: r.many, active: r.active, cardinality: r.cardinality }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))

  const calculatedColumns = [...model.calculatedColumns]
    .map((c) => ({ modelTableId: c.modelTableId, name: c.name, expression: c.expression }))
    .sort((a, b) => `${a.modelTableId}:${a.name}`.localeCompare(`${b.modelTableId}:${b.name}`))

  const measures = [...model.measures]
    .map((m) => ({ homeModelTableId: m.homeModelTableId, name: m.name, expression: m.expression }))
    .sort((a, b) => a.name.localeCompare(b.name))

  const payload = JSON.stringify({ tables, relationships, calculatedColumns, measures, spec })
  return hashString(payload)
}

/** True when the model/datasets have changed (in any way the fingerprint tracks) since `run` was produced — a stale PASS must never be shown as current (docs/VALIDATION_ENGINE.md "Staleness"). */
export function isValidationRunStale(
  run: ValidationRun,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
  spec: ValidationSpec,
): boolean {
  return computeValidationFingerprint(model, datasets, spec) !== run.fingerprint
}
