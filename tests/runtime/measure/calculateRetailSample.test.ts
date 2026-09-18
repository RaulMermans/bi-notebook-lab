import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import { generateRetailDataset } from '../../../src/lib/sample/generateRetailDataset'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'

/**
 * End-to-end CALCULATE coverage against the real bundled Retail sample
 * (mirrors `measure/retailSample.test.ts`) — sprint brief §55's required
 * Retail training measures, each checked against an independently computed
 * expected value straight from the raw generated rows.
 */
describe('Retail sample CALCULATE measures', () => {
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

    const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

    model = createRelationship(
      model,
      {
        one: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: findColumn(customersDs, 'CustomerID').id },
        many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'CustomerID').id },
      },
      datasets,
    ).model
    model = createRelationship(
      model,
      {
        one: { datasetId: productsDs.id, tableId: productsDs.tables[0].id, columnId: findColumn(productsDs, 'ProductID').id },
        many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'ProductID').id },
      },
      datasets,
    ).model
    model = createRelationship(
      model,
      {
        one: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: findColumn(calendarDs, 'Date').id },
        many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'Date').id },
      },
      datasets,
    ).model

    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    expect(m.diagnostics).toEqual([])

    return { model: m.model, datasets, salesTableId, customersDs, productsDs, salesDs }
  }

  function findMeasureId(model: SemanticModel, name: string): string {
    return model.measures.find((measure) => measure.name === name)!.id
  }

  function withMeasure(model: SemanticModel, datasets: Record<string, Dataset>, homeModelTableId: string, name: string, expression: string) {
    const result = createMeasure(model, datasets, { homeModelTableId, name, expression })
    expect(result.diagnostics).toEqual([])
    return result.model
  }

  it('Spain Revenue matches Total Revenue evaluated under an external Spain filter', () => {
    const { model, datasets, salesTableId, customersDs, salesDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'Spain Revenue', 'CALCULATE([Total Revenue], Customers[Country] = "Spain")')

    const countryColumn = customersDs.tables[0].columns.find((c) => c.name === 'Country')!
    const spainCustomerIds = new Set(customersDs.tables[0].rows.filter((r) => r.Country === 'Spain').map((r) => r.CustomerID))
    const expectedRevenue = salesDs.tables[0].rows
      .filter((row) => spainCustomerIds.has(row.CustomerID))
      .reduce((sum, row) => sum + (row.Revenue as number), 0)

    const calculateResult = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Spain Revenue'))
    const externalResult = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), {
      filters: [{ column: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: countryColumn.id }, operator: 'equals', values: ['Spain'] }],
    })

    expect(calculateResult.value).toBeCloseTo(expectedRevenue, 6)
    expect(calculateResult.value as number).toBeCloseTo(externalResult.value as number, 6)
    expect(expectedRevenue).toBeGreaterThan(0)
  })

  it('Spain Revenue survives an external France slicer (replacement, not intersection)', () => {
    const { model, datasets, salesTableId, customersDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'Spain Revenue', 'CALCULATE([Total Revenue], Customers[Country] = "Spain")')
    const countryColumn = customersDs.tables[0].columns.find((c) => c.name === 'Country')!

    const franceFilter = {
      filters: [{ column: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: countryColumn.id }, operator: 'equals' as const, values: ['France'] }],
    }
    const totalUnderFrance = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), franceFilter)
    const spainUnderFranceSlicer = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Spain Revenue'), franceFilter)
    const spainStandalone = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Spain Revenue'))

    expect(spainUnderFranceSlicer.value).toBe(spainStandalone.value)
    expect(spainUnderFranceSlicer.value).not.toBe(totalUnderFrance.value)
    expect(spainUnderFranceSlicer.value as number).toBeGreaterThan(0)
  })

  it('Revenue All Countries ignores an external Country slicer', () => {
    const { model, datasets, salesTableId, customersDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue All Countries', 'CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country]))')
    const countryColumn = customersDs.tables[0].columns.find((c) => c.name === 'Country')!

    const spainFilter = {
      filters: [{ column: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: countryColumn.id }, operator: 'equals' as const, values: ['Spain'] }],
    }
    const grandTotal = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'))
    const spainTotal = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), spainFilter)
    const revenueAllCountries = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue All Countries'), spainFilter)

    expect(revenueAllCountries.value).toBe(grandTotal.value)
    expect(revenueAllCountries.value).not.toBe(spainTotal.value)
  })

  it('Revenue % All Countries computes a genuine ratio under a Country slicer', () => {
    const { model, datasets, salesTableId, customersDs } = buildStarSchemaModel()
    const withM = withMeasure(
      model,
      datasets,
      salesTableId,
      'Revenue % All Countries',
      'DIVIDE([Total Revenue], CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country])))',
    )
    const countryColumn = customersDs.tables[0].columns.find((c) => c.name === 'Country')!
    const spainFilter = {
      filters: [{ column: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: countryColumn.id }, operator: 'equals' as const, values: ['Spain'] }],
    }

    const spainTotal = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), spainFilter).value as number
    const grandTotal = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue')).value as number
    const percentage = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue % All Countries'), spainFilter).value as number

    expect(percentage).toBeCloseTo(spainTotal / grandTotal, 6)
    expect(percentage).toBeGreaterThan(0)
    expect(percentage).toBeLessThan(1)
  })

  it('All Product Revenue ignores a Category slicer but keeps an unrelated Country slicer active', () => {
    const { model, datasets, salesTableId, customersDs, productsDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'All Product Revenue', 'CALCULATE([Total Revenue], ALL(Products))')
    const countryColumn = customersDs.tables[0].columns.find((c) => c.name === 'Country')!
    const categoryColumn = productsDs.tables[0].columns.find((c) => c.name === 'Category')!
    const targetCountry = customersDs.tables[0].rows[0].Country as string
    const targetCategory = productsDs.tables[0].rows[0].Category as string

    const combinedFilter = {
      filters: [
        { column: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: countryColumn.id }, operator: 'equals' as const, values: [targetCountry] },
        { column: { datasetId: productsDs.id, tableId: productsDs.tables[0].id, columnId: categoryColumn.id }, operator: 'equals' as const, values: [targetCategory] },
      ],
    }
    const countryOnlyFilter = { filters: [combinedFilter.filters[0]] }

    const withBoth = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), combinedFilter).value as number
    const countryOnly = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), countryOnlyFilter).value as number
    const allProductRevenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'All Product Revenue'), combinedFilter).value as number

    expect(allProductRevenue).toBeCloseTo(countryOnly, 6) // Category ignored, Country preserved
    expect(allProductRevenue).not.toBeCloseTo(withBoth, 6)
  })

  it('FILTER on a real UnitPrice column matches an independently computed subset', () => {
    const { model, datasets, salesTableId, productsDs, salesDs } = buildStarSchemaModel()
    const priceColumn = productsDs.tables[0].columns.find((c) => c.name === 'UnitPrice')!
    expect(priceColumn).toBeDefined()

    const threshold = 100
    const withM = withMeasure(
      model,
      datasets,
      salesTableId,
      'Premium Product Revenue',
      `CALCULATE([Total Revenue], FILTER(Products, Products[UnitPrice] > ${threshold}))`,
    )

    const premiumProductIds = new Set(
      productsDs.tables[0].rows.filter((r) => (r.UnitPrice as number) > threshold).map((r) => r.ProductID),
    )
    const expectedRevenue = salesDs.tables[0].rows
      .filter((row) => premiumProductIds.has(row.ProductID))
      .reduce((sum, row) => sum + (row.Revenue as number), 0)

    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Premium Product Revenue'))
    expect(execution.value).toBeCloseTo(expectedRevenue, 6)
    // Sanity: the threshold actually partitions the catalog (otherwise the test would pass vacuously).
    expect(premiumProductIds.size).toBeGreaterThan(0)
    expect(premiumProductIds.size).toBeLessThan(productsDs.tables[0].rows.length)
  })
})
