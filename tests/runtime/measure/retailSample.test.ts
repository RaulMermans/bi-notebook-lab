import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import { generateRetailDataset } from '../../../src/lib/sample/generateRetailDataset'
import { createCalculatedColumn } from '../../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'

/** End-to-end coverage against the real bundled Retail sample (mirrors calculatedColumn/retailSample.test.ts). */
describe('Retail sample measures', () => {
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
    model = addTable(model, { datasetId: customersDs.id, tableId: customersDs.tables[0].id })
    model = addTable(model, { datasetId: productsDs.id, tableId: productsDs.tables[0].id })
    model = addTable(model, { datasetId: salesDs.id, tableId: salesDs.tables[0].id })
    model = addTable(model, { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id })

    const customersTableId = model.tables.find((t) => t.datasetId === customersDs.id)!.id
    const productsTableId = model.tables.find((t) => t.datasetId === productsDs.id)!.id
    const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id
    const calendarTableId = model.tables.find((t) => t.datasetId === calendarDs.id)!.id

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
      customersTableId,
      productsTableId,
      salesTableId,
      calendarTableId,
      customersDs,
      productsDs,
      salesDs,
      calendarDs,
      productRelationshipId: productRel.relationship!.id,
    }
  }

  function findMeasureId(model: SemanticModel, name: string): string {
    return model.measures.find((m) => m.name === name)!.id
  }

  function createCoreMeasures(model: SemanticModel, datasets: Record<string, Dataset>, salesTableId: string) {
    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    expect(m.diagnostics).toEqual([])
    m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'Total Cost', expression: 'SUM(Sales[Cost])' })
    expect(m.diagnostics).toEqual([])
    m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'Gross Margin', expression: '[Total Revenue] - [Total Cost]' })
    expect(m.diagnostics).toEqual([])
    m = createMeasure(m.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Gross Margin %',
      expression: 'DIVIDE([Gross Margin], [Total Revenue])',
    })
    expect(m.diagnostics).toEqual([])
    m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'Orders', expression: 'DISTINCTCOUNT(Sales[OrderID])' })
    expect(m.diagnostics).toEqual([])
    m = createMeasure(m.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Average Order Value',
      expression: 'DIVIDE([Total Revenue], [Orders])',
    })
    expect(m.diagnostics).toEqual([])
    return m.model
  }

  it('computes Total Revenue, Total Cost, Gross Margin, Gross Margin %, Orders and AOV against real data', () => {
    const { model, datasets, salesTableId, salesDs } = buildStarSchemaModel()
    const withMeasures = createCoreMeasures(model, datasets, salesTableId)

    const salesRows = salesDs.tables[0].rows
    const expectedRevenue = salesRows.reduce((sum, row) => sum + (row.Revenue as number), 0)
    const expectedCost = salesRows.reduce((sum, row) => sum + (row.Cost as number), 0)
    const expectedOrders = new Set(salesRows.map((row) => row.OrderID)).size

    expect(evaluateMeasure(withMeasures, datasets, findMeasureId(withMeasures, 'Total Revenue')).value).toBeCloseTo(expectedRevenue, 6)
    expect(evaluateMeasure(withMeasures, datasets, findMeasureId(withMeasures, 'Total Cost')).value).toBeCloseTo(expectedCost, 6)
    expect(evaluateMeasure(withMeasures, datasets, findMeasureId(withMeasures, 'Gross Margin')).value).toBeCloseTo(
      expectedRevenue - expectedCost,
      6,
    )
    expect(evaluateMeasure(withMeasures, datasets, findMeasureId(withMeasures, 'Gross Margin %')).value).toBeCloseTo(
      (expectedRevenue - expectedCost) / expectedRevenue,
      6,
    )
    expect(evaluateMeasure(withMeasures, datasets, findMeasureId(withMeasures, 'Orders')).value).toBe(expectedOrders)
    expect(evaluateMeasure(withMeasures, datasets, findMeasureId(withMeasures, 'Average Order Value')).value).toBeCloseTo(
      expectedRevenue / expectedOrders,
      6,
    )
  })

  it('Total Calculated Margin (SUM of a Sprint 3 calculated column) matches Gross Margin', () => {
    const { model, datasets, salesTableId, salesDs } = buildStarSchemaModel()
    const marginColumn = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })
    expect(marginColumn.diagnostics).toEqual([])

    const withMeasures = createCoreMeasures(marginColumn.model, datasets, salesTableId)
    const totalMargin = createMeasure(withMeasures, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Calculated Margin',
      expression: 'SUM(Sales[Margin])',
    })
    expect(totalMargin.diagnostics).toEqual([])

    const salesRows = salesDs.tables[0].rows
    const expectedMargin = salesRows.reduce((sum, row) => sum + ((row.Revenue as number) - (row.Cost as number)), 0)

    expect(totalMargin.execution?.value).toBeCloseTo(expectedMargin, 6)
    const grossMargin = evaluateMeasure(totalMargin.model, datasets, findMeasureId(totalMargin.model, 'Gross Margin'))
    expect(totalMargin.execution?.value as number).toBeCloseTo(grossMargin.value as number, 6)
  })

  it('recomputes Total Revenue under Customers[Country] = Spain', () => {
    const { model, datasets, salesTableId, customersDs, salesDs } = buildStarSchemaModel()
    const withMeasures = createCoreMeasures(model, datasets, salesTableId)

    const countryColumn = customersDs.tables[0].columns.find((c) => c.name === 'Country')!
    const spainCustomerIds = new Set(
      customersDs.tables[0].rows.filter((row) => row.Country === 'Spain').map((row) => row.CustomerID),
    )
    const expectedRevenue = salesDs.tables[0].rows
      .filter((row) => spainCustomerIds.has(row.CustomerID))
      .reduce((sum, row) => sum + (row.Revenue as number), 0)

    const filterContext = {
      filters: [
        {
          column: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: countryColumn.id },
          operator: 'equals' as const,
          values: ['Spain'],
        },
      ],
    }
    const execution = evaluateMeasure(withMeasures, datasets, findMeasureId(withMeasures, 'Total Revenue'), filterContext)

    expect(execution.value).toBeCloseTo(expectedRevenue, 6)
    expect(expectedRevenue).toBeGreaterThan(0)
  })

  it('intersects Customers[Country] = Spain AND Products[Category] = Furniture', () => {
    const { model, datasets, salesTableId, customersDs, productsDs, salesDs } = buildStarSchemaModel()
    const withMeasures = createCoreMeasures(model, datasets, salesTableId)

    const countryColumn = customersDs.tables[0].columns.find((c) => c.name === 'Country')!
    const categoryColumn = productsDs.tables[0].columns.find((c) => c.name === 'Category')!
    const spainCustomerIds = new Set(
      customersDs.tables[0].rows.filter((row) => row.Country === 'Spain').map((row) => row.CustomerID),
    )
    const furnitureProductIds = new Set(
      productsDs.tables[0].rows.filter((row) => row.Category === 'Furniture').map((row) => row.ProductID),
    )
    const expectedRevenue = salesDs.tables[0].rows
      .filter((row) => spainCustomerIds.has(row.CustomerID) && furnitureProductIds.has(row.ProductID))
      .reduce((sum, row) => sum + (row.Revenue as number), 0)

    const filterContext = {
      filters: [
        {
          column: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: countryColumn.id },
          operator: 'equals' as const,
          values: ['Spain'],
        },
        {
          column: { datasetId: productsDs.id, tableId: productsDs.tables[0].id, columnId: categoryColumn.id },
          operator: 'equals' as const,
          values: ['Furniture'],
        },
      ],
    }
    const execution = evaluateMeasure(withMeasures, datasets, findMeasureId(withMeasures, 'Total Revenue'), filterContext)

    expect(execution.value).toBeCloseTo(expectedRevenue, 6)
  })

  it('recomputes Total Revenue under Calendar[Year] filter, propagated through Sales[Date]', () => {
    const { model, datasets, salesTableId, calendarDs, salesDs } = buildStarSchemaModel()
    const withMeasures = createCoreMeasures(model, datasets, salesTableId)

    const yearColumn = calendarDs.tables[0].columns.find((c) => c.name === 'Year')!
    const targetYear = calendarDs.tables[0].rows[0].Year as number
    const datesInYear = new Set(
      calendarDs.tables[0].rows.filter((row) => row.Year === targetYear).map((row) => row.Date),
    )
    const expectedRevenue = salesDs.tables[0].rows
      .filter((row) => datesInYear.has(row.Date))
      .reduce((sum, row) => sum + (row.Revenue as number), 0)

    const filterContext = {
      filters: [
        {
          column: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: yearColumn.id },
          operator: 'equals' as const,
          values: [targetYear],
        },
      ],
    }
    const execution = evaluateMeasure(withMeasures, datasets, findMeasureId(withMeasures, 'Total Revenue'), filterContext)

    expect(execution.value).toBeCloseTo(expectedRevenue, 6)
  })

  it('ignores a Products[Category] filter once the Products relationship is disabled, and recovers once re-enabled', () => {
    const { model, datasets, salesTableId, productsDs, productRelationshipId } = buildStarSchemaModel()
    const withMeasures = createCoreMeasures(model, datasets, salesTableId)
    const categoryColumn = productsDs.tables[0].columns.find((c) => c.name === 'Category')!
    const filterContext = {
      filters: [
        {
          column: { datasetId: productsDs.id, tableId: productsDs.tables[0].id, columnId: categoryColumn.id },
          operator: 'equals' as const,
          values: [productsDs.tables[0].rows[0].Category],
        },
      ],
    }

    const unfiltered = evaluateMeasure(withMeasures, datasets, findMeasureId(withMeasures, 'Total Revenue'))

    const disabledModel = setRelationshipActive(withMeasures, productRelationshipId, false)
    const disabledExecution = evaluateMeasure(disabledModel, datasets, findMeasureId(disabledModel, 'Total Revenue'), filterContext)
    expect(disabledExecution.value).toBeCloseTo(unfiltered.value as number, 6)

    const reEnabledModel = setRelationshipActive(disabledModel, productRelationshipId, true)
    const reEnabledExecution = evaluateMeasure(reEnabledModel, datasets, findMeasureId(reEnabledModel, 'Total Revenue'), filterContext)
    expect(reEnabledExecution.value as number).toBeLessThan(unfiltered.value as number)
  })
})
