import { expect } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import { generateRetailDataset } from '../../../src/lib/sample/generateRetailDataset'
import { createCalculatedColumn } from '../../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'

/** Shared Retail star-schema builder for Sprint 5 validation tests — mirrors `tests/runtime/measure/retailSample.test.ts#buildStarSchemaModel`. */
export function buildRetailModel() {
  const [customersDs, productsDs, salesDs, calendarDs] = generateRetailDataset()
  const datasets: Record<string, Dataset> = {
    [customersDs.id]: customersDs,
    [productsDs.id]: productsDs,
    [salesDs.id]: salesDs,
    [calendarDs.id]: calendarDs,
  }
  const findColumn = (dataset: Dataset, name: string) => dataset.tables[0].columns.find((c) => c.name === name)!

  let model = createModel('Retail')
  model = addTable(model, { datasetId: customersDs.id, tableId: customersDs.tables[0].id })
  model = addTable(model, { datasetId: productsDs.id, tableId: productsDs.tables[0].id })
  model = addTable(model, { datasetId: salesDs.id, tableId: salesDs.tables[0].id })
  model = addTable(model, { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id })

  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

  const customerRel = createRelationship(
    model,
    {
      one: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: findColumn(customersDs, 'CustomerID').id },
      many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'CustomerID').id },
    },
    datasets,
  )
  expect(customerRel.diagnostics.some((d) => d.severity === 'error')).toBe(false)
  model = customerRel.model

  const productRel = createRelationship(
    model,
    {
      one: { datasetId: productsDs.id, tableId: productsDs.tables[0].id, columnId: findColumn(productsDs, 'ProductID').id },
      many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'ProductID').id },
    },
    datasets,
  )
  expect(productRel.diagnostics.some((d) => d.severity === 'error')).toBe(false)
  model = productRel.model

  const calendarRel = createRelationship(
    model,
    {
      one: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: findColumn(calendarDs, 'Date').id },
      many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'Date').id },
    },
    datasets,
  )
  expect(calendarRel.diagnostics.some((d) => d.severity === 'error')).toBe(false)
  model = calendarRel.model

  return {
    model,
    datasets,
    customersDs,
    productsDs,
    salesDs,
    calendarDs,
    salesTableId,
    customerRelationshipId: customerRel.relationship!.id,
    productRelationshipId: productRel.relationship!.id,
    calendarRelationshipId: calendarRel.relationship!.id,
  }
}

/** Adds the complete intended Retail Foundations solution: Margin + Total Revenue/Orders/Average Order Value/Gross Margin. */
export function addRetailFoundationsSolution(model: SemanticModel, datasets: Record<string, Dataset>, salesTableId: string): SemanticModel {
  const margin = createCalculatedColumn(model, datasets, {
    modelTableId: salesTableId,
    name: 'Margin',
    expression: 'Sales[Revenue] - Sales[Cost]',
  })
  expect(margin.diagnostics).toEqual([])
  let current = margin.model

  const steps: { name: string; expression: string }[] = [
    { name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' },
    { name: 'Total Cost', expression: 'SUM(Sales[Cost])' },
    { name: 'Gross Margin', expression: '[Total Revenue] - [Total Cost]' },
    { name: 'Orders', expression: 'DISTINCTCOUNT(Sales[OrderID])' },
    { name: 'Average Order Value', expression: 'DIVIDE([Total Revenue], [Orders])' },
  ]
  for (const step of steps) {
    const result = createMeasure(current, datasets, { homeModelTableId: salesTableId, name: step.name, expression: step.expression })
    expect(result.diagnostics).toEqual([])
    current = result.model
  }

  return current
}
