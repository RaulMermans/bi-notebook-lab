import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { ValidationRun, ValidationSpec } from '../../domain/validation'
import { hashString } from '../../lib/hash'
import { resolveTableRef } from '../model/modelRuntime'

/**
 * A fingerprint over exactly the semantic inputs a validation run depends
 * on: tables (and their dataset schema), relationships (and active state),
 * calculated-column/measure definitions, and the spec itself. Deliberately
 * excludes UI-only state such as a table's canvas position — dragging a
 * table must never invalidate a previous result (docs/VALIDATION_ENGINE.md
 * "Staleness"). Two models that differ only in ways that don't affect this
 * fingerprint are indistinguishable to validation, by design.
 *
 * A table sourced from a Power Query `Dataset` (`source.type === 'query'`)
 * also contributes its `revision` — Sprint 12's query fingerprint rolled up
 * through dependencies (see `runtime/query/queryFingerprint.ts`). This is
 * what makes a row-only edit (Filter Rows, Replace Values, Remove
 * Duplicates) invalidate a PASS even though the schema never changed
 * (docs/POWER_QUERY_RUNTIME.md "Validation staleness").
 */
export function computeValidationFingerprint(model: SemanticModel, datasets: Record<string, Dataset>, spec: ValidationSpec): string {
  const tables = [...model.tables]
    .map((t) => {
      const resolved = resolveTableRef(datasets, t)
      return {
        tableId: t.tableId,
        datasetId: t.datasetId,
        tableName: resolved?.table.name ?? null,
        datasetRevision: resolved?.dataset.source.type === 'query' ? resolved.dataset.source.revision : null,
        columns:
          resolved?.table.columns
            .map((c) => ({ name: c.name, dataType: c.dataType }))
            .sort((a, b) => a.name.localeCompare(b.name)) ?? [],
      }
    })
    .sort((a, b) => `${a.datasetId}:${a.tableId}`.localeCompare(`${b.datasetId}:${b.tableId}`))

  const relationships = [...model.relationships]
    .map((r) => ({ left: r.left, right: r.right, cardinality: r.cardinality, oneSide: r.oneSide, crossFilterDirection: r.crossFilterDirection, active: r.active }))
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
