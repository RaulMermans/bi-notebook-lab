import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { generateRetailDataset } from '../../../src/lib/sample/generateRetailDataset'
import { createCalculatedColumn } from '../../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'

/**
 * Sprint 9 Retail acceptance measures (sprint brief §55-§56) — each checked
 * against an independently-derived expected value straight from the raw
 * generated rows, on the real bundled 1,500-row Retail sample.
 */
describe('Retail sample Sprint 9 measures', () => {
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

    const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id
    const customersTableId = model.tables.find((t) => t.datasetId === customersDs.id)!.id

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

    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    expect(m.diagnostics).toEqual([])
    m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'Total Cost', expression: 'SUM(Sales[Cost])' })
    expect(m.diagnostics).toEqual([])

    return { model: m.model, datasets, salesTableId, customersTableId, customersDs, productsDs, salesDs }
  }

  function withMeasure(model: ReturnType<typeof buildStarSchemaModel>['model'], datasets: Record<string, Dataset>, homeModelTableId: string, name: string, expression: string) {
    const result = createMeasure(model, datasets, { homeModelTableId, name, expression })
    expect(result.diagnostics).toEqual([])
    return result.model
  }

  function findMeasureId(model: ReturnType<typeof buildStarSchemaModel>['model'], name: string): string {
    return model.measures.find((measure) => measure.name === name)!.id
  }

  it('Gross Margin X (SUMX) equals Total Revenue - Total Cost', () => {
    const { model, datasets, salesTableId } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'Gross Margin X', 'SUMX(Sales, Sales[Revenue] - Sales[Cost])')

    const grossMarginX = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Gross Margin X'))
    const totalRevenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'))
    const totalCost = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Cost'))

    expect(grossMarginX.value as number).toBeCloseTo((totalRevenue.value as number) - (totalCost.value as number), 4)
  })

  it('Calculated Revenue (SUMX + RELATED) matches SUM(Sales[Revenue])', () => {
    const { model, datasets, salesTableId } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'Calculated Revenue', 'SUMX(Sales, Sales[Quantity] * RELATED(Products[UnitPrice]))')

    const calculatedRevenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Calculated Revenue'))
    const totalRevenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'))

    expect(calculatedRevenue.value as number).toBeCloseTo(totalRevenue.value as number, 2)
  })

  it('High Quantity Revenue (FILTER + SUMX) matches an independently-derived value from raw rows', () => {
    const { model, datasets, salesTableId, salesDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'High Quantity Revenue', 'SUMX(FILTER(Sales, Sales[Quantity] >= 5), Sales[Revenue])')

    const expected = salesDs.tables[0].rows.filter((r) => (r.Quantity as number) >= 5).reduce((sum, r) => sum + (r.Revenue as number), 0)
    const result = evaluateMeasure(withM, datasets, findMeasureId(withM, 'High Quantity Revenue'))

    expect(result.value as number).toBeCloseTo(expected, 4)
    expect(expected).toBeGreaterThan(0)
  })

  it('High Quantity Revenue recalculates under a Country slicer', () => {
    const { model, datasets, salesTableId, customersDs, salesDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'High Quantity Revenue', 'SUMX(FILTER(Sales, Sales[Quantity] >= 5), Sales[Revenue])')
    const countryColumn = customersDs.tables[0].columns.find((c) => c.name === 'Country')!
    const spainCustomerIds = new Set(customersDs.tables[0].rows.filter((r) => r.Country === 'Spain').map((r) => r.CustomerID))
    const expected = salesDs.tables[0].rows
      .filter((r) => (r.Quantity as number) >= 5 && spainCustomerIds.has(r.CustomerID))
      .reduce((sum, r) => sum + (r.Revenue as number), 0)

    const result = evaluateMeasure(withM, datasets, findMeasureId(withM, 'High Quantity Revenue'), {
      filters: [{ column: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: countryColumn.id }, operator: 'equals', values: ['Spain'] }],
    })
    expect(result.value as number).toBeCloseTo(expected, 4)
  })

  it('Average Margin per Sale (AVERAGEX)', () => {
    const { model, datasets, salesTableId, salesDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'Average Margin per Sale', 'AVERAGEX(Sales, Sales[Revenue] - Sales[Cost])')

    const expected = salesDs.tables[0].rows.reduce((sum, r) => sum + ((r.Revenue as number) - (r.Cost as number)), 0) / salesDs.tables[0].rowCount
    const result = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Average Margin per Sale'))
    expect(result.value as number).toBeCloseTo(expected, 4)
  })

  it('Visible Countries (COUNTROWS(VALUES(...))) reacts to a Country slicer', () => {
    const { model, datasets, customersTableId, customersDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, customersTableId, 'Visible Countries', 'COUNTROWS(VALUES(Customers[Country]))')
    const distinctCountries = new Set(customersDs.tables[0].rows.map((r) => r.Country)).size

    const unfiltered = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Visible Countries'))
    expect(unfiltered.value).toBe(distinctCountries)

    const countryColumn = customersDs.tables[0].columns.find((c) => c.name === 'Country')!
    const spainOnly = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Visible Countries'), {
      filters: [{ column: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: countryColumn.id }, operator: 'equals', values: ['Spain'] }],
    })
    expect(spainOnly.value).toBe(1)
  })

  it('Selected Country (SELECTEDVALUE) — all / one / two', () => {
    const { model, datasets, customersTableId, customersDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, customersTableId, 'Selected Country', 'SELECTEDVALUE(Customers[Country], "Multiple Countries")')
    const countryColumn = customersDs.tables[0].columns.find((c) => c.name === 'Country')!
    const columnRef = { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: countryColumn.id }

    expect(evaluateMeasure(withM, datasets, findMeasureId(withM, 'Selected Country')).value).toBe('Multiple Countries')
    expect(evaluateMeasure(withM, datasets, findMeasureId(withM, 'Selected Country'), { filters: [{ column: columnRef, operator: 'equals', values: ['Spain'] }] }).value).toBe('Spain')
    expect(
      evaluateMeasure(withM, datasets, findMeasureId(withM, 'Selected Country'), { filters: [{ column: columnRef, operator: 'in', values: ['Spain', 'France'] }] }).value,
    ).toBe('Multiple Countries')
  })

  it('Revenue by Category Iterator (SUMX(VALUES(...), [Measure])) matches Total Revenue, and Spain slicer narrows it', () => {
    const { model, datasets, salesTableId, customersDs } = buildStarSchemaModel()
    const productsTableId = model.tables.find((t) => t.datasetId !== customersDs.id && t.id !== salesTableId)!.id
    const withM = withMeasure(model, datasets, productsTableId, 'Revenue by Category Iterator', 'SUMX(VALUES(Products[Category]), [Total Revenue])')

    const totalRevenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'))
    const iteratorResult = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue by Category Iterator'))
    expect(iteratorResult.value as number).toBeCloseTo(totalRevenue.value as number, 2)

    const countryColumn = customersDs.tables[0].columns.find((c) => c.name === 'Country')!
    const spainFilter = { filters: [{ column: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: countryColumn.id }, operator: 'equals' as const, values: ['Spain'] }] }
    const spainTotalRevenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), spainFilter)
    const spainIteratorResult = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue by Category Iterator'), spainFilter)
    expect(spainIteratorResult.value as number).toBeCloseTo(spainTotalRevenue.value as number, 2)
  })
})

describe('Retail sample Sprint 9 calculated columns (sprint brief §56)', () => {
  function buildModel() {
    const [customersDs, productsDs, salesDs] = generateRetailDataset()
    const datasets: Record<string, Dataset> = { [customersDs.id]: customersDs, [productsDs.id]: productsDs, [salesDs.id]: salesDs }
    let model = createModel('Retail')
    model = addTable(model, { datasetId: salesDs.id, tableId: salesDs.tables[0].id })
    const salesTableId = model.tables[0].id
    return { model, datasets, salesTableId, salesDs }
  }

  it('Revenue Band (SWITCH(TRUE(), ...)) classifies every row', () => {
    const { model, datasets, salesTableId, salesDs } = buildModel()
    const created = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Revenue Band',
      expression: 'SWITCH(TRUE(), Sales[Revenue] >= 2000, "Large", Sales[Revenue] >= 500, "Medium", "Small")',
    })
    expect(created.diagnostics).toEqual([])
    const expected = salesDs.tables[0].rows.map((r) => {
      const revenue = r.Revenue as number
      return revenue >= 2000 ? 'Large' : revenue >= 500 ? 'Medium' : 'Small'
    })
    expect(created.execution!.values).toEqual(expected)
  })

  it('Profitable (IF) classifies every row', () => {
    const { model, datasets, salesTableId, salesDs } = buildModel()
    const created = createCalculatedColumn(model, datasets, {
      modelTableId: salesTableId,
      name: 'Profitable',
      expression: 'IF(Sales[Revenue] > Sales[Cost], TRUE(), FALSE())',
    })
    expect(created.diagnostics).toEqual([])
    const expected = salesDs.tables[0].rows.map((r) => (r.Revenue as number) > (r.Cost as number))
    expect(created.execution!.values).toEqual(expected)
  })
})
