import type { SemanticModel } from '../../domain/model'
import type { TestCell } from '../../domain/notebook'
import type { QuerySelector, ValidationRule, ValidationRun, ValidationSpec } from '../../domain/validation'
import { hashString } from '../../lib/hash'
import { resolveTableRef } from '../model/modelRuntime'
import { resolveQuerySelector } from './selectorResolver'
import type { ValidationSnapshot } from './validationEngine'

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
function modelFingerprintPayload(model: SemanticModel, snapshot: ValidationSnapshot) {
  const tables = [...model.tables]
    .map((t) => {
      const resolved = resolveTableRef(snapshot.datasets, t)
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

  return { tables, relationships, calculatedColumns, measures }
}

/** Every query-rule variant names its target with a `QuerySelector` under `.query` — this walks a spec's rules to find them all, for fingerprinting and for any future author-facing "what does this checkpoint touch" tooling. */
function referencedQuerySelectors(spec: ValidationSpec): QuerySelector[] {
  const selectors: QuerySelector[] = []
  for (const rule of spec.rules) {
    const withQuery = rule as ValidationRule & { query?: QuerySelector }
    if (withQuery.query) selectors.push(withQuery.query)
  }
  return selectors
}

/**
 * Sprint 14: folds in, for every query a spec's rules reference, that
 * query's own semantic fingerprint (`runtime/query/queryFingerprint.ts`) —
 * already exactly the right shape, since it already excludes step display
 * name/UI state and already changes on filter/custom-column/pivot-config/
 * upstream-dependency edits (docs/POWER_QUERY_RUNTIME.md "Validation
 * staleness"). A learner renaming an Applied Step never invalidates a PASS;
 * editing what it actually does always does.
 */
function queryFingerprintPayload(snapshot: ValidationSnapshot, spec: ValidationSpec) {
  return referencedQuerySelectors(spec)
    .map((selector) => {
      const resolution = resolveQuerySelector(snapshot.queries, selector)
      return { queryName: selector.queryName, queryFingerprint: resolution.ok ? (snapshot.queryEvaluations[resolution.value.id]?.fingerprint ?? null) : null }
    })
    .sort((a, b) => a.queryName.localeCompare(b.queryName))
}

/**
 * A successful checkpoint becomes stale exactly when the semantics it
 * depends on change — never on UI-only edits (step display name, canvas
 * position, previewed step). Model-scoped checkpoints keep the Sprint 5-13
 * payload; any query the spec references contributes its own semantic
 * fingerprint regardless of scope, so a mixed model+query checkpoint (rare,
 * but not disallowed) is still fully covered.
 */
export function computeValidationFingerprint(snapshot: ValidationSnapshot, testCell: TestCell): string {
  const model = testCell.scope.kind === 'model' ? snapshot.models[testCell.scope.modelId] : undefined
  const modelPayload = model ? modelFingerprintPayload(model, snapshot) : null
  const queries = queryFingerprintPayload(snapshot, testCell.validation)

  const payload = JSON.stringify({ scope: testCell.scope, model: modelPayload, queries, spec: testCell.validation })
  return hashString(payload)
}

/** True when the model/datasets/queries have changed (in any way the fingerprint tracks) since `run` was produced — a stale PASS must never be shown as current (docs/VALIDATION_ENGINE.md "Staleness"). */
export function isValidationRunStale(run: ValidationRun, snapshot: ValidationSnapshot, testCell: TestCell): boolean {
  return computeValidationFingerprint(snapshot, testCell) !== run.fingerprint
}
