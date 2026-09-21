import type { Dataset, DataColumn, DataTable } from '../../domain/data'
import type {
  ColumnRef,
  ModelTable,
  Relationship,
  RelationshipDiagnostic,
  SemanticModel,
  TableRef,
} from '../../domain/model'
import { generateId } from '../../lib/ids'
import { typesCompatible } from './columnCompatibility'

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

/**
 * Normalizes a `SemanticModel` loaded from persistence: models saved before
 * Sprint 4 have no `measures` field on disk at all, and models saved before
 * Sprint 10 have no `dateTables` field. Always route a persisted model
 * through this before treating it as a real `SemanticModel` — see
 * docs/MEASURES.md "Persistence" and docs/DATE_TABLES.md "Persistence".
 */
export function hydrateSemanticModel(model: SemanticModel): SemanticModel {
  return { ...model, measures: model.measures ?? [], dateTables: model.dateTables ?? [] }
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

/** Removes a table and any relationships (in either role), calculated columns or Date Table marking that reference it (docs/DATE_TABLES.md "Table removal cleanup" — no dangling `DateTableDefinition` may survive its `ModelTable`). */
export function removeTable(model: SemanticModel, modelTableId: string): SemanticModel {
  const table = model.tables.find((t) => t.id === modelTableId)
  if (!table) return model

  const tables = model.tables.filter((t) => t.id !== modelTableId)
  const relationships = model.relationships.filter(
    (r) =>
      !(r.one.datasetId === table.datasetId && r.one.tableId === table.tableId) &&
      !(r.many.datasetId === table.datasetId && r.many.tableId === table.tableId),
  )
  const calculatedColumns = model.calculatedColumns.filter((c) => c.modelTableId !== modelTableId)
  const dateTables = model.dateTables.filter((dt) => dt.modelTableId !== modelTableId)
  return { ...model, tables, relationships, calculatedColumns, dateTables, ...touch() }
}

export function moveTable(model: SemanticModel, modelTableId: string, position: { x: number; y: number }): SemanticModel {
  const tables = model.tables.map((t) => (t.id === modelTableId ? { ...t, position } : t))
  return { ...model, tables, ...touch() }
}

export function removeRelationship(model: SemanticModel, relationshipId: string): SemanticModel {
  const relationships = model.relationships.filter((r) => r.id !== relationshipId)
  return { ...model, relationships, ...touch() }
}

export function setRelationshipActive(model: SemanticModel, relationshipId: string, active: boolean): SemanticModel {
  const relationships = model.relationships.map((r) => (r.id === relationshipId ? { ...r, active } : r))
  return { ...model, relationships, ...touch() }
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

function sameColumn(a: ColumnRef, b: ColumnRef): boolean {
  return a.datasetId === b.datasetId && a.tableId === b.tableId && a.columnId === b.columnId
}

/** Two relationships are duplicates if they connect the same two physical columns, regardless of which one is "one" vs "many". */
function isDuplicateRelationshipPair(
  candidate: { one: ColumnRef; many: ColumnRef },
  existing: Relationship,
): boolean {
  const sameDirection = sameColumn(candidate.one, existing.one) && sameColumn(candidate.many, existing.many)
  const swappedDirection = sameColumn(candidate.one, existing.many) && sameColumn(candidate.many, existing.one)
  return sameDirection || swappedDirection
}

function columnValues(table: DataTable, column: DataColumn): unknown[] {
  return table.rows.map((row) => row[column.name]).filter((value) => value !== null && value !== undefined)
}

export function validateRelationship(
  model: SemanticModel,
  candidate: { one: ColumnRef; many: ColumnRef },
  datasets: Record<string, Dataset>,
): RelationshipDiagnostic[] {
  const diagnostics: RelationshipDiagnostic[] = []

  const resolvedOne = resolveColumnRef(datasets, candidate.one)
  const resolvedMany = resolveColumnRef(datasets, candidate.many)

  if (!resolvedOne || !resolvedMany) {
    diagnostics.push({
      severity: 'error',
      code: 'MISSING_REFERENCE',
      message: 'One or both of the selected columns could not be found in the loaded datasets.',
      details: { oneResolved: Boolean(resolvedOne), manyResolved: Boolean(resolvedMany) },
    })
    return diagnostics
  }

  if (sameTable(candidate.one, candidate.many)) {
    diagnostics.push({
      severity: 'error',
      code: 'SELF_RELATIONSHIP',
      message: 'A relationship cannot connect a table to itself.',
    })
    return diagnostics
  }

  if (!typesCompatible(resolvedOne.column.dataType, resolvedMany.column.dataType)) {
    diagnostics.push({
      severity: 'error',
      code: 'COLUMN_TYPE_MISMATCH',
      message: `"${resolvedOne.table.name}[${resolvedOne.column.name}]" is ${resolvedOne.column.dataType} but "${resolvedMany.table.name}[${resolvedMany.column.name}]" is ${resolvedMany.column.dataType}. Relationship columns must use compatible types.`,
      details: { oneType: resolvedOne.column.dataType, manyType: resolvedMany.column.dataType },
    })
  }

  const oneValues = columnValues(resolvedOne.table, resolvedOne.column)
  const oneDistinct = new Set(oneValues)
  if (oneDistinct.size !== oneValues.length) {
    diagnostics.push({
      severity: 'error',
      code: 'ONE_SIDE_NOT_UNIQUE',
      message: `"${resolvedOne.table.name}[${resolvedOne.column.name}]" contains duplicate values, so it cannot be used on the "1" side of a relationship.`,
      details: { rowCount: oneValues.length, distinctCount: oneDistinct.size },
    })
  }

  const duplicate = model.relationships.some((r) => isDuplicateRelationshipPair(candidate, r))
  if (duplicate) {
    diagnostics.push({
      severity: 'error',
      code: 'DUPLICATE_RELATIONSHIP',
      message: 'A relationship between these two columns already exists in this model.',
    })
  }

  const manyValues = columnValues(resolvedMany.table, resolvedMany.column)
  if (manyValues.length > 0) {
    const matched = manyValues.filter((value) => oneDistinct.has(value)).length
    const matchRate = matched / manyValues.length
    if (matchRate < 1) {
      diagnostics.push({
        severity: 'warning',
        code: 'UNMATCHED_FOREIGN_KEYS',
        message: `${manyValues.length - matched} of ${manyValues.length} values in "${resolvedMany.table.name}[${resolvedMany.column.name}]" do not match "${resolvedOne.table.name}[${resolvedOne.column.name}]" (match rate ${(matchRate * 100).toFixed(1)}%).`,
        details: { matchRate, unmatchedCount: manyValues.length - matched, totalCount: manyValues.length },
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
export function createRelationship(
  model: SemanticModel,
  input: { one: ColumnRef; many: ColumnRef; active?: boolean },
  datasets: Record<string, Dataset>,
): CreateRelationshipResult {
  const diagnostics = validateRelationship(model, input, datasets)
  const hasError = diagnostics.some((d) => d.severity === 'error')
  if (hasError) {
    return { model, diagnostics }
  }

  const relationship: Relationship = {
    id: generateId('relationship'),
    one: input.one,
    many: input.many,
    cardinality: 'one-to-many',
    crossFilterDirection: 'single',
    active: input.active ?? true,
    createdAt: new Date().toISOString(),
  }

  return {
    model: { ...model, relationships: [...model.relationships, relationship], ...touch() },
    relationship,
    diagnostics,
  }
}
