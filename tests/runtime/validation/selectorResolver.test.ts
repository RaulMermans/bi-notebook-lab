import { describe, expect, it } from 'vitest'
import { addTable, createModel } from '../../../src/runtime/model/modelRuntime'
import {
  resolveCalculatedColumnSelector,
  resolveColumnSelector,
  resolveMeasureSelector,
  resolveTableSelector,
} from '../../../src/runtime/validation/selectorResolver'
import { createCalculatedColumn } from '../../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { buildRetailModel } from './helpers'

describe('selectorResolver', () => {
  it('resolves a table by name', () => {
    const { model, datasets } = buildRetailModel()
    const result = resolveTableSelector(model, datasets, { tableName: 'Sales' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.tableName).toBe('Sales')
  })

  it('resolves a table by name + sourceKey', () => {
    const { model, datasets } = buildRetailModel()
    const result = resolveTableSelector(model, datasets, { tableName: 'Sales', sourceKey: 'sales' })
    expect(result.ok).toBe(true)
  })

  it('resolves a column', () => {
    const { model, datasets } = buildRetailModel()
    const result = resolveColumnSelector(model, datasets, { table: { tableName: 'Sales' }, columnName: 'Revenue' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.columnName).toBe('Revenue')
  })

  it('resolves a measure', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const created = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    const result = resolveMeasureSelector(created.model, { name: 'Total Revenue' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.name).toBe('Total Revenue')
  })

  it('resolves a calculated column', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const created = createCalculatedColumn(model, datasets, { modelTableId: salesTableId, name: 'Margin', expression: 'Sales[Revenue] - Sales[Cost]' })
    const result = resolveCalculatedColumnSelector(created.model, datasets, { table: { tableName: 'Sales' }, name: 'Margin' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.name).toBe('Margin')
  })

  it('returns VALIDATION_TARGET_NOT_FOUND for a missing table', () => {
    const { model, datasets } = buildRetailModel()
    const result = resolveTableSelector(model, datasets, { tableName: 'Warehouse' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_TARGET_NOT_FOUND')
  })

  it('returns VALIDATION_TARGET_NOT_FOUND for a missing measure', () => {
    const { model } = buildRetailModel()
    const result = resolveMeasureSelector(model, { name: 'Nonexistent Measure' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_TARGET_NOT_FOUND')
  })

  it('returns VALIDATION_TARGET_NOT_FOUND for a missing column', () => {
    const { model, datasets } = buildRetailModel()
    const result = resolveColumnSelector(model, datasets, { table: { tableName: 'Sales' }, columnName: 'Salse' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_TARGET_NOT_FOUND')
  })

  it('returns VALIDATION_TARGET_AMBIGUOUS for a duplicate table name with no disambiguating sourceKey', () => {
    // Import the same sample dataset's Sales table under a second Dataset id — same table name,
    // different dataset — to trigger a genuine ambiguity without a sourceKey to disambiguate.
    let { model, datasets, salesDs } = buildRetailModel()
    const duplicateSalesDs = { ...salesDs, id: `${salesDs.id}-dup` }
    datasets = { ...datasets, [duplicateSalesDs.id]: duplicateSalesDs }
    model = addTable(model, { datasetId: duplicateSalesDs.id, tableId: duplicateSalesDs.tables[0].id })

    const result = resolveTableSelector(model, datasets, { tableName: 'Sales' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('VALIDATION_TARGET_AMBIGUOUS')
  })

  it('disambiguates a duplicate table name using sourceKey', () => {
    let { model, datasets, salesDs } = buildRetailModel()
    const duplicateSalesDs = { ...salesDs, id: `${salesDs.id}-dup`, source: { type: 'sample' as const, key: 'sales-dup' } }
    datasets = { ...datasets, [duplicateSalesDs.id]: duplicateSalesDs }
    model = addTable(model, { datasetId: duplicateSalesDs.id, tableId: duplicateSalesDs.tables[0].id })

    const result = resolveTableSelector(model, datasets, { tableName: 'Sales', sourceKey: 'sales' })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.dataset.id).toBe(salesDs.id)
  })

  it('never returns a match when the table has not been added to the model at all', () => {
    const { datasets } = buildRetailModel()
    const emptyModel = createModel('Empty')
    const result = resolveTableSelector(emptyModel, datasets, { tableName: 'Sales' })
    expect(result.ok).toBe(false)
  })
})
