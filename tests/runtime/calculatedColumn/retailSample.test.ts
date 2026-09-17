import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import { generateRetailDataset } from '../../../src/lib/sample/generateRetailDataset'
import { createCalculatedColumn } from '../../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'

/** End-to-end coverage against the real bundled Retail sample (roadmap "Retail sample verification"). */
describe('Retail sample calculated columns', () => {
  function buildStarSchemaModel() {
    const [customersDs, productsDs, salesDs, calendarDs] = generateRetailDataset()
    const datasets: Record<string, Dataset> = {
      [customersDs.id]: customersDs,
      [productsDs.id]: productsDs,
      [salesDs.id]: salesDs,
      [calendarDs.id]: calendarDs,
    }
    const findColumn = (dataset: Dataset, name: string) => dataset.tables[0].columns.find((c) => c.name === name)!

    let model = createModel('Retail')
    model = addTable(model, { datasetId: productsDs.id, tableId: productsDs.tables[0].id })
    model = addTable(model, { datasetId: salesDs.id, tableId: salesDs.tables[0].id })
    const productsTableId = model.tables.find((t) => t.datasetId === productsDs.id)!.id
    const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

    const relationshipResult = createRelationship(
      model,
      {
        one: { datasetId: productsDs.id, tableId: productsDs.tables[0].id, columnId: findColumn(productsDs, 'ProductID').id },
        many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'ProductID').id },
      },
      datasets,
    )
    expect(relationshipResult.diagnostics.some((d) => d.severity === 'error')).toBe(false)
    model = relationshipResult.model

    return { model, datasets, salesTableId, productsTableId, salesDs, productsDs }
  }

  it('computes Margin = Sales[Revenue] - Sales[Cost] for every Sales row', () => {
    const { model, datasets, salesTableId, salesDs } = buildStarSchemaModel()

    const result = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })

    expect(result.diagnostics).toEqual([])
    expect(result.execution?.values).toHaveLength(salesDs.tables[0].rowCount)
    expect(result.execution?.errors).toEqual([])
    expect(['integer', 'decimal']).toContain(result.execution?.dataType)

    const salesRows = salesDs.tables[0].rows
    result.execution?.values.forEach((value, index) => {
      const expected = (salesRows[index].Revenue as number) - (salesRows[index].Cost as number)
      expect(value as number).toBeCloseTo(expected, 6)
    })
  })

  it('computes Margin % = (Revenue - Cost) / Revenue', () => {
    const { model, datasets, salesTableId, salesDs } = buildStarSchemaModel()

    const result = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Margin %',
      expression: '(Sales[Revenue] - Sales[Cost]) / Sales[Revenue]',
    })

    expect(result.diagnostics).toEqual([])
    const salesRows = salesDs.tables[0].rows
    result.execution?.values.forEach((value, index) => {
      const revenue = salesRows[index].Revenue as number
      const cost = salesRows[index].Cost as number
      expect(value as number).toBeCloseTo((revenue - cost) / revenue, 6)
    })
  })

  it('computes RELATED(Products[UnitCost]) sourced from Products', () => {
    const { model, datasets, salesTableId, salesDs, productsDs } = buildStarSchemaModel()

    const result = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Related Unit Cost',
      expression: 'RELATED(Products[UnitCost])',
    })

    expect(result.diagnostics).toEqual([])
    const salesRows = salesDs.tables[0].rows
    const productsById = new Map(productsDs.tables[0].rows.map((row) => [row.ProductID, row]))
    result.execution?.values.forEach((value, index) => {
      const expected = productsById.get(salesRows[index].ProductID)!.UnitCost
      expect(value).toBe(expected)
    })
  })

  it('computes RELATED(Products[Category])', () => {
    const { model, datasets, salesTableId, salesDs, productsDs } = buildStarSchemaModel()

    const result = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Related Category',
      expression: 'RELATED(Products[Category])',
    })

    expect(result.diagnostics).toEqual([])
    expect(result.execution?.dataType).toBe('string')
    const salesRows = salesDs.tables[0].rows
    const productsById = new Map(productsDs.tables[0].rows.map((row) => [row.ProductID, row]))
    result.execution?.values.forEach((value, index) => {
      expect(value).toBe(productsById.get(salesRows[index].ProductID)!.Category)
    })
  })

  it('rejects a direct Products[Category] reference from Sales without RELATED', () => {
    const { model, datasets, salesTableId } = buildStarSchemaModel()

    const result = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Bad Category',
      expression: 'Products[Category]',
    })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'COLUMN_OUTSIDE_ROW_CONTEXT' })])
    expect(result.model.calculatedColumns).toHaveLength(0)
  })

  it('fails RELATED once the relationship is disabled, and recovers once re-enabled', async () => {
    const { model, datasets, salesTableId } = buildStarSchemaModel()
    const created = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Related Category',
      expression: 'RELATED(Products[Category])',
    })
    expect(created.diagnostics).toEqual([])

    const { setRelationshipActive } = await import('../../../src/runtime/model/modelRuntime')
    const relationshipId = created.model.relationships[0].id
    const disabledModel: SemanticModel = setRelationshipActive(created.model, relationshipId, false)

    const { evaluateCalculatedColumn } = await import('../../../src/runtime/calculatedColumn/calculatedColumnRuntime')
    const failedExecution = evaluateCalculatedColumn(disabledModel, datasets, created.calculatedColumn!.id)
    expect(failedExecution?.columnDiagnostics).toEqual([expect.objectContaining({ code: 'RELATED_INACTIVE_RELATIONSHIP' })])

    const reEnabledModel = setRelationshipActive(disabledModel, relationshipId, true)
    const recoveredExecution = evaluateCalculatedColumn(reEnabledModel, datasets, created.calculatedColumn!.id)
    expect(recoveredExecution?.columnDiagnostics).toEqual([])
    expect(recoveredExecution?.values.length).toBeGreaterThan(0)
  })
})
