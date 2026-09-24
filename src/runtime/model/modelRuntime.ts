import type { Dataset, DataColumn, DataTable } from '../../domain/data'
import type {
  ColumnRef,
  CrossFilterDirection,
  ModelTable,
  Relationship,
  RelationshipCardinality,
  RelationshipDiagnostic,
  RelationshipSide,
  SemanticModel,
  TableRef,
} from '../../domain/model'
import { generateId } from '../../lib/ids'
import { typesCompatible } from './columnCompatibility'
import { hasAmbiguousDirectedPath, relationshipConnectsColumns } from './relationshipHelpers'

export function createModel(name = 'Untitled Model'): SemanticModel {
  const now = new Date().toISOString()
  return {
    id: generateId('model'),
    name,
    tables: [],
    relationships: [],
    calculatedColumns: [],
    measures: [],
    dateTables: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** The Sprint 1-10 persisted shape — never constructed at runtime after this sprint, only matched against on load. */
interface LegacyRelationship {
  id: string
  one: ColumnRef
  many: ColumnRef
  cardinality: 'one-to-many'
  crossFilterDirection: 'single'
  active: boolean
  createdAt: string
}

function isLegacyRelationship(r: Relationship | LegacyRelationship): r is LegacyRelationship {
  return !('left' in r) || !('right' in r)
}

/**
 * Converts a Sprint 1-10 persisted relationship (`{one, many, cardinality:
 * 'one-to-many', crossFilterDirection: 'single'}`) into the Sprint 11
 * canonical shape — `left = one, right = many, oneSide = 'left',
 * crossFilterDirection = 'left-to-right'` is exactly the old always-single
 * one→many propagation direction, so hydrated Retail models produce
 * numerically identical results (docs/ADVANCED_RELATIONSHIPS.md "Legacy
 * hydration"). Already-canonical relationships pass through unchanged.
 */
function hydrateRelationship(r: Relationship | LegacyRelationship): Relationship {
  if (!isLegacyRelationship(r)) return r
  return {
    id: r.id,
    left: r.one,
    right: r.many,
    cardinality: 'one-to-many',
    oneSide: 'left',
    crossFilterDirection: 'left-to-right',
    active: r.active,
    createdAt: r.createdAt,
  }
}

/**
 * Normalizes a `SemanticModel` loaded from persistence: models saved before
 * Sprint 4 have no `measures` field on disk at all, models saved before
 * Sprint 10 have no `dateTables` field, and models saved before Sprint 11
 * store relationships in the legacy `one`/`many` shape. Always route a
 * persisted model through this before treating it as a real `SemanticModel`
 * — see docs/MEASURES.md "Persistence", docs/DATE_TABLES.md "Persistence"
 * and docs/ADVANCED_RELATIONSHIPS.md "Legacy hydration".
 */
export function hydrateSemanticModel(model: SemanticModel): SemanticModel {
  const persistedRelationships = (model.relationships ?? []) as unknown as (Relationship | LegacyRelationship)[]
  return {
    ...model,
    relationships: persistedRelationships.map(hydrateRelationship),
    measures: model.measures ?? [],
    dateTables: model.dateTables ?? [],
  }
}

function touch(): Pick<SemanticModel, 'updatedAt'> {
  return { updatedAt: new Date().toISOString() }
}

export function addTable(model: SemanticModel, ref: TableRef): SemanticModel {
  const modelTable: ModelTable = {
    id: generateId('modeltable'),
    datasetId: ref.datasetId,
    tableId: ref.tableId,
  }
  return { ...model, tables: [...model.tables, modelTable], ...touch() }
}

/**
 * Removes a table and any relationships (in either role), calculated
 * columns, measures homed on it, or Date Table marking that reference it
 * (docs/DATE_TABLES.md "Table removal cleanup" — no dangling
 * `DateTableDefinition` may survive its `ModelTable`; Sprint 15 extends this
 * to measures — see docs/WORKSPACE_INTEGRITY.md "Remove Model Table": a
 * measure's `homeModelTableId` can never point at a removed table, so it
 * cascades away with the table rather than dangling). The caller
 * (`NotebookRuntime.removeTableFromModel`) is responsible for also removing
 * any cell that referenced a cascaded calculated column/measure.
 */
export function removeTable(model: SemanticModel, modelTableId: string): SemanticModel {
  const table = model.tables.find((t) => t.id === modelTableId)
  if (!table) return model

  const tables = model.tables.filter((t) => t.id !== modelTableId)
  const relationships = model.relationships.filter(
    (r) =>
      !(r.left.datasetId === table.datasetId && r.left.tableId === table.tableId) &&
      !(r.right.datasetId === table.datasetId && r.right.tableId === table.tableId),
  )
  const calculatedColumns = model.calculatedColumns.filter((c) => c.modelTableId !== modelTableId)
  const measures = model.measures.filter((m) => m.homeModelTableId !== modelTableId)
  const dateTables = model.dateTables.filter((dt) => dt.modelTableId !== modelTableId)
  return { ...model, tables, relationships, calculatedColumns, measures, dateTables, ...touch() }
}

export function moveTable(model: SemanticModel, modelTableId: string, position: { x: number; y: number }): SemanticModel {
  const tables = model.tables.map((t) => (t.id === modelTableId ? { ...t, position } : t))
  return { ...model, tables, ...touch() }
}

export function removeRelationship(model: SemanticModel, relationshipId: string): SemanticModel {
  const relationships = model.relationships.filter((r) => r.id !== relationshipId)
  return { ...model, relationships, ...touch() }
}

export interface SetRelationshipActiveResult {
  model: SemanticModel
  diagnostics: RelationshipDiagnostic[]
}

/**
 * Activating a relationship can no longer blindly flip a boolean (sprint
 * brief §20): clone the model with the flip applied, check whether the
 * *effective* propagation graph becomes ambiguous, and reject — leaving the
 * existing valid model untouched — if it does.  Deactivating never
 * introduces ambiguity (it only removes edges), so only the active===true
 * transition needs the check.
 */
export function setRelationshipActive(model: SemanticModel, relationshipId: string, active: boolean): SetRelationshipActiveResult {
  const target = model.relationships.find((r) => r.id === relationshipId)
  if (!target || target.active === active) return { model, diagnostics: [] }

  const proposedModel: SemanticModel = {
    ...model,
    relationships: model.relationships.map((r) => (r.id === relationshipId ? { ...r, active } : r)),
  }

  if (active && hasAmbiguousDirectedPath(proposedModel)) {
    return {
      model,
      diagnostics: [
        {
          severity: 'error',
          code: 'RELATIONSHIP_CREATES_AMBIGUOUS_PATH',
          message:
            'Activating this relationship would create more than one active filter path between two tables, making propagation ambiguous. Deactivate the competing relationship first, or use USERELATIONSHIP to switch relationships for a single calculation instead.',
        },
      ],
    }
  }

  return { model: { ...proposedModel, ...touch() }, diagnostics: [] }
}

export interface ResolvedColumnRef {
  dataset: Dataset
  table: DataTable
  column: DataColumn
}

export interface ResolvedTableRef {
  dataset: Dataset
  table: DataTable
}

/** Resolves a TableRef against the dataset registry. Never uses `primaryTable()` — a ref always names its table explicitly, staying forward-compatible with multi-table datasets. */
export function resolveTableRef(datasets: Record<string, Dataset>, ref: TableRef): ResolvedTableRef | undefined {
  const dataset = datasets[ref.datasetId]
  const table = dataset?.tables.find((t) => t.id === ref.tableId)
  if (!dataset || !table) return undefined
  return { dataset, table }
}

/** Resolves a ColumnRef against the dataset registry. See `resolveTableRef` for why refs are always resolved explicitly. */
export function resolveColumnRef(datasets: Record<string, Dataset>, ref: ColumnRef): ResolvedColumnRef | undefined {
  const resolved = resolveTableRef(datasets, ref)
  const column = resolved?.table.columns.find((c) => c.id === ref.columnId)
  if (!resolved || !column) return undefined
  return { dataset: resolved.dataset, table: resolved.table, column }
}

function sameTable(a: ColumnRef, b: ColumnRef): boolean {
  return a.datasetId === b.datasetId && a.tableId === b.tableId
}

function columnValues(table: DataTable, column: DataColumn): unknown[] {
  return table.rows.map((row) => row[column.name]).filter((value) => value !== null && value !== undefined)
}

function isUnique(values: unknown[]): boolean {
  return new Set(values).size === values.length
}

export interface RelationshipConfigInput {
  left: ColumnRef
  right: ColumnRef
  cardinality: RelationshipCardinality
  /** Required (and only meaningful) for `one-to-many` — which side is the unique "1" side. */
  oneSide?: RelationshipSide
  crossFilterDirection: CrossFilterDirection
  active: boolean
}

/** The single valid non-`'both'` direction a `one-to-many` relationship's configured `oneSide` implies — the "1" side always naturally filters the "*" side. */
function naturalSingleDirection(oneSide: RelationshipSide): CrossFilterDirection {
  return oneSide === 'left' ? 'left-to-right' : 'right-to-left'
}

/**
 * Cardinality-aware relationship validation (sprint brief §5-7): uniqueness
 * requirements, valid cross-filter directions and foreign-key diagnostics
 * all branch on `candidate.cardinality` rather than assuming `one-to-many`
 * unconditionally. `excludeRelationshipId` lets `updateRelationship` validate
 * a proposed edit against every *other* relationship without permanently
 * flagging itself as a duplicate of its own pre-edit state.
 */
export function validateRelationshipConfig(
  model: SemanticModel,
  candidate: RelationshipConfigInput,
  datasets: Record<string, Dataset>,
  excludeRelationshipId?: string,
): RelationshipDiagnostic[] {
  const diagnostics: RelationshipDiagnostic[] = []

  const resolvedLeft = resolveColumnRef(datasets, candidate.left)
  const resolvedRight = resolveColumnRef(datasets, candidate.right)

  if (!resolvedLeft || !resolvedRight) {
    return [
      {
        severity: 'error',
        code: 'MISSING_REFERENCE',
        message: 'One or both of the selected columns could not be found in the loaded datasets.',
        details: { leftResolved: Boolean(resolvedLeft), rightResolved: Boolean(resolvedRight) },
      },
    ]
  }

  if (sameTable(candidate.left, candidate.right)) {
    return [{ severity: 'error', code: 'SELF_RELATIONSHIP', message: 'A relationship cannot connect a table to itself.' }]
  }

  if (!typesCompatible(resolvedLeft.column.dataType, resolvedRight.column.dataType)) {
    diagnostics.push({
      severity: 'error',
      code: 'COLUMN_TYPE_MISMATCH',
      message: `"${resolvedLeft.table.name}[${resolvedLeft.column.name}]" is ${resolvedLeft.column.dataType} but "${resolvedRight.table.name}[${resolvedRight.column.name}]" is ${resolvedRight.column.dataType}. Relationship columns must use compatible types.`,
      details: { leftType: resolvedLeft.column.dataType, rightType: resolvedRight.column.dataType },
    })
  }

  if (candidate.cardinality === 'one-to-many' && !candidate.oneSide) {
    diagnostics.push({
      severity: 'error',
      code: 'INVALID_CARDINALITY',
      message: 'A one-to-many relationship must specify which side is the "1" side.',
    })
  }
  if (candidate.cardinality !== 'one-to-many' && candidate.oneSide) {
    diagnostics.push({
      severity: 'error',
      code: 'INVALID_CARDINALITY',
      message: 'Only a one-to-many relationship has a "1" side — one-to-one and many-to-many relationships do not.',
    })
  }

  if (candidate.cardinality === 'one-to-many' && candidate.oneSide) {
    const valid = new Set([naturalSingleDirection(candidate.oneSide), 'both'])
    if (!valid.has(candidate.crossFilterDirection)) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_CROSS_FILTER_DIRECTION',
        message: `A one-to-many relationship can only filter from the "1" side to the "many" side (single), or both ways — not the reverse single direction.`,
      })
    }
  }
  if (candidate.cardinality === 'one-to-one' && candidate.crossFilterDirection !== 'both') {
    diagnostics.push({
      severity: 'error',
      code: 'ONE_TO_ONE_REQUIRES_BOTH',
      message: 'A one-to-one relationship must filter in both directions — Power BI does not allow a single-direction 1:1 relationship.',
    })
  }

  const leftValues = columnValues(resolvedLeft.table, resolvedLeft.column)
  const rightValues = columnValues(resolvedRight.table, resolvedRight.column)

  if (candidate.cardinality === 'one-to-many' && candidate.oneSide) {
    const oneValues = candidate.oneSide === 'left' ? leftValues : rightValues
    const oneLabel = candidate.oneSide === 'left' ? `${resolvedLeft.table.name}[${resolvedLeft.column.name}]` : `${resolvedRight.table.name}[${resolvedRight.column.name}]`
    if (!isUnique(oneValues)) {
      diagnostics.push({
        severity: 'error',
        code: 'ONE_SIDE_NOT_UNIQUE',
        message: `"${oneLabel}" contains duplicate values, so it cannot be used on the "1" side of a relationship.`,
        details: { rowCount: oneValues.length, distinctCount: new Set(oneValues).size },
      })
    }
  } else if (candidate.cardinality === 'one-to-one') {
    if (!isUnique(leftValues)) {
      diagnostics.push({
        severity: 'error',
        code: 'LEFT_SIDE_NOT_UNIQUE',
        message: `"${resolvedLeft.table.name}[${resolvedLeft.column.name}]" contains duplicate values — both sides of a one-to-one relationship must be unique.`,
        details: { rowCount: leftValues.length, distinctCount: new Set(leftValues).size },
      })
    }
    if (!isUnique(rightValues)) {
      diagnostics.push({
        severity: 'error',
        code: 'RIGHT_SIDE_NOT_UNIQUE',
        message: `"${resolvedRight.table.name}[${resolvedRight.column.name}]" contains duplicate values — both sides of a one-to-one relationship must be unique.`,
        details: { rowCount: rightValues.length, distinctCount: new Set(rightValues).size },
      })
    }
  }

  const duplicate = model.relationships.some(
    (r) => r.id !== excludeRelationshipId && relationshipConnectsColumns(r, candidate.left, candidate.right),
  )
  if (duplicate) {
    diagnostics.push({
      severity: 'error',
      code: 'DUPLICATE_RELATIONSHIP',
      message: 'A relationship between these two columns already exists in this model.',
    })
  }

  if (candidate.cardinality === 'one-to-many' && candidate.oneSide) {
    const oneValues = candidate.oneSide === 'left' ? leftValues : rightValues
    const manyValues = candidate.oneSide === 'left' ? rightValues : leftValues
    const manyLabel =
      candidate.oneSide === 'left' ? `${resolvedRight.table.name}[${resolvedRight.column.name}]` : `${resolvedLeft.table.name}[${resolvedLeft.column.name}]`
    const oneLabel =
      candidate.oneSide === 'left' ? `${resolvedLeft.table.name}[${resolvedLeft.column.name}]` : `${resolvedRight.table.name}[${resolvedRight.column.name}]`
    const oneDistinct = new Set(oneValues)
    if (manyValues.length > 0) {
      const matched = manyValues.filter((value) => oneDistinct.has(value)).length
      const matchRate = matched / manyValues.length
      if (matchRate < 1) {
        diagnostics.push({
          severity: 'warning',
          code: 'UNMATCHED_FOREIGN_KEYS',
          message: `${manyValues.length - matched} of ${manyValues.length} values in "${manyLabel}" do not match "${oneLabel}" (match rate ${(matchRate * 100).toFixed(1)}%).`,
          details: { matchRate, unmatchedCount: manyValues.length - matched, totalCount: manyValues.length },
        })
      }
    }
  } else if (candidate.cardinality === 'one-to-one') {
    const leftDistinct = new Set(leftValues)
    const rightDistinct = new Set(rightValues)
    const matched = rightValues.filter((v) => leftDistinct.has(v)).length
    const total = Math.max(leftValues.length, rightValues.length)
    if (total > 0 && matched < total) {
      diagnostics.push({
        severity: 'info',
        code: 'ONE_TO_ONE_COVERAGE',
        message: `Not every row has a match on both sides — ${matched} of ${total} rows overlap between "${resolvedLeft.table.name}[${resolvedLeft.column.name}]" and "${resolvedRight.table.name}[${resolvedRight.column.name}]". A one-to-one relationship allows unmatched rows on either side.`,
        details: { matched, total, leftDistinct: leftDistinct.size, rightDistinct: rightDistinct.size },
      })
    }
  }

  if (candidate.cardinality === 'many-to-many') {
    diagnostics.push({
      severity: 'warning',
      code: 'MANY_TO_MANY_RELATIONSHIP',
      message: 'This is a many-to-many relationship — neither side is unique. Verify this is intentional; aggregated results can double-count.',
    })
  }
  if (candidate.crossFilterDirection === 'both' && candidate.cardinality !== 'one-to-one') {
    diagnostics.push({
      severity: 'warning',
      code: 'BIDIRECTIONAL_RELATIONSHIP',
      message: 'This relationship filters in both directions. Bidirectional filtering is a legitimate feature, but it can make propagation harder to predict — make sure this is intentional.',
    })
  }

  const hasError = diagnostics.some((d) => d.severity === 'error')
  if (!hasError && candidate.active) {
    const proposedRelationship: Relationship = {
      id: excludeRelationshipId ?? generateId('relationship'),
      left: candidate.left,
      right: candidate.right,
      cardinality: candidate.cardinality,
      oneSide: candidate.oneSide,
      crossFilterDirection: candidate.crossFilterDirection,
      active: true,
      createdAt: new Date().toISOString(),
    }
    const otherRelationships = model.relationships.filter((r) => r.id !== excludeRelationshipId)
    const proposedModel: SemanticModel = { ...model, relationships: [...otherRelationships, proposedRelationship] }
    if (hasAmbiguousDirectedPath(proposedModel)) {
      diagnostics.push({
        severity: 'error',
        code: 'RELATIONSHIP_CREATES_AMBIGUOUS_PATH',
        message:
          'This relationship would create more than one active filter path between two tables, making propagation ambiguous. Make it inactive, or deactivate the competing relationship first.',
      })
    }
  }

  return diagnostics
}

export interface CreateRelationshipResult {
  model: SemanticModel
  relationship?: Relationship
  diagnostics: RelationshipDiagnostic[]
}

/**
 * Validates and, if there are no blocking errors, applies the relationship.
 * Never partially applies a relationship that failed validation — the model
 * is returned unchanged (with the diagnostics) when any error is present.
 */
export function createRelationshipConfig(
  model: SemanticModel,
  input: RelationshipConfigInput,
  datasets: Record<string, Dataset>,
): CreateRelationshipResult {
  const diagnostics = validateRelationshipConfig(model, input, datasets)
  const hasError = diagnostics.some((d) => d.severity === 'error')
  if (hasError) return { model, diagnostics }

  const relationship: Relationship = {
    id: generateId('relationship'),
    left: input.left,
    right: input.right,
    cardinality: input.cardinality,
    oneSide: input.oneSide,
    crossFilterDirection: input.crossFilterDirection,
    active: input.active,
    createdAt: new Date().toISOString(),
  }

  return {
    model: { ...model, relationships: [...model.relationships, relationship], ...touch() },
    relationship,
    diagnostics,
  }
}

/**
 * Edits an existing relationship's cardinality/oneSide/crossFilterDirection/
 * active state in place (sprint brief §10) — validated against the proposed
 * full configuration exactly like creation, excluding the relationship's own
 * pre-edit state from the duplicate/ambiguity checks via
 * `excludeRelationshipId`. Never partially applies an invalid edit.
 */
export function updateRelationship(
  model: SemanticModel,
  relationshipId: string,
  changes: RelationshipConfigInput,
  datasets: Record<string, Dataset>,
): CreateRelationshipResult {
  const existing = model.relationships.find((r) => r.id === relationshipId)
  if (!existing) {
    return { model, diagnostics: [{ severity: 'error', code: 'MISSING_REFERENCE', message: 'This relationship no longer exists in the model.' }] }
  }

  const diagnostics = validateRelationshipConfig(model, changes, datasets, relationshipId)
  const hasError = diagnostics.some((d) => d.severity === 'error')
  if (hasError) return { model, diagnostics }

  const updated: Relationship = {
    ...existing,
    left: changes.left,
    right: changes.right,
    cardinality: changes.cardinality,
    oneSide: changes.oneSide,
    crossFilterDirection: changes.crossFilterDirection,
    active: changes.active,
  }

  return {
    model: { ...model, relationships: model.relationships.map((r) => (r.id === relationshipId ? updated : r)), ...touch() },
    relationship: updated,
    diagnostics,
  }
}

/**
 * Convenience constructor for the common one-to-many/single-direction case
 * (`left = one`, `oneSide = 'left'`, `crossFilterDirection = 'left-to-right'`)
 * — delegates entirely to `createRelationshipConfig`, never treats `one`/
 * `many` as an independent runtime representation. Kept for callers (test
 * fixtures, simple exercise authoring) that only ever need a classic 1:*
 * relationship and don't want to spell out the full config every time.
 */
export function createRelationship(
  model: SemanticModel,
  input: { one: ColumnRef; many: ColumnRef; active?: boolean },
  datasets: Record<string, Dataset>,
): CreateRelationshipResult {
  return createRelationshipConfig(
    model,
    {
      left: input.one,
      right: input.many,
      cardinality: 'one-to-many',
      oneSide: 'left',
      crossFilterDirection: 'left-to-right',
      active: input.active ?? true,
    },
    datasets,
  )
}

/** `validateRelationshipConfig` counterpart to `createRelationship` — see that function's doc comment. */
export function validateRelationship(
  model: SemanticModel,
  candidate: { one: ColumnRef; many: ColumnRef },
  datasets: Record<string, Dataset>,
): RelationshipDiagnostic[] {
  return validateRelationshipConfig(
    model,
    { left: candidate.one, right: candidate.many, cardinality: 'one-to-many', oneSide: 'left', crossFilterDirection: 'left-to-right', active: true },
    datasets,
  )
}
