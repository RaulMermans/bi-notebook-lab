import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { ColumnRef } from '../../../src/domain/model'
import { generateRetailDataset } from '../../../src/lib/sample/generateRetailDataset'
import { markDateTable } from '../../../src/runtime/dateTable/dateTableRuntime'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'

/**
 * End-to-end Sprint 10 coverage against the real bundled Retail sample
 * (mirrors `calculateRetailSample.test.ts`/`iteratorRetailSample.test.ts`)
 * — the sprint's required acceptance fixture (sprint brief §12, §55).
 */
describe('Retail sample — Classic Time Intelligence', () => {
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
    const calendarTableId = model.tables.find((t) => t.datasetId === calendarDs.id)!.id

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
    const dateRelResult = createRelationship(
      model,
      {
        one: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: findColumn(calendarDs, 'Date').id },
        many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'Date').id },
      },
      datasets,
    )
    expect(dateRelResult.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    model = dateRelResult.model

    const dateColumn: ColumnRef = { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: findColumn(calendarDs, 'Date').id }
    const marked = markDateTable(model, datasets, calendarTableId, dateColumn)
    expect(marked.diagnostics).toEqual([])
    model = marked.model

    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    expect(m.diagnostics).toEqual([])
    model = m.model

    return { model, datasets, salesTableId, calendarTableId, customersDs, productsDs, salesDs, calendarDs }
  }

  function withMeasure(model: ReturnType<typeof buildStarSchemaModel>['model'], datasets: Record<string, Dataset>, homeModelTableId: string, name: string, expression: string) {
    const result = createMeasure(model, datasets, { homeModelTableId, name, expression })
    expect(result.diagnostics).toEqual([])
    return result.model
  }

  function findMeasureId(model: ReturnType<typeof buildStarSchemaModel>['model'], name: string): string {
    return model.measures.find((measure) => measure.name === name)!.id
  }

  it('Calendar validates as a Date Table using Calendar[Date] (sprint brief §12)', () => {
    const { model, calendarTableId } = buildStarSchemaModel()
    const definition = model.dateTables.find((dt) => dt.modelTableId === calendarTableId)
    expect(definition).toBeDefined()
  })

  it('Revenue LY (SAMEPERIODLASTYEAR) under Year=2025 matches an independently computed 2024 total', () => {
    const { model, datasets, salesTableId, calendarDs, salesDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue LY', 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))')

    const yearColumn = calendarDs.tables[0].columns.find((c) => c.name === 'Year')!
    const dateColumn = calendarDs.tables[0].columns.find((c) => c.name === 'Date')!
    const dates2024 = new Set(calendarDs.tables[0].rows.filter((r) => r.Year === 2024).map((r) => r[dateColumn.name]))
    const expected2024Revenue = salesDs.tables[0].rows
      .filter((row) => dates2024.has(row.Date))
      .reduce((sum, row) => sum + (row.Revenue as number), 0)

    const context = { filters: [{ column: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: yearColumn.id }, operator: 'equals' as const, values: [2025] }] }
    const result = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue LY'), context)

    expect(result.value).toBeCloseTo(expected2024Revenue, 2)
    expect(expected2024Revenue).toBeGreaterThan(0)
  })

  it('Revenue LY for a single selected month equals that same month one year earlier (critical filter-replacement regression, sprint brief §20/§63)', () => {
    const { model, datasets, salesTableId, calendarDs, salesDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue LY', 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))')

    const yearColumn = calendarDs.tables[0].columns.find((c) => c.name === 'Year')!
    const monthNumberColumn = calendarDs.tables[0].columns.find((c) => c.name === 'MonthNumber')!
    const dateColumn = calendarDs.tables[0].columns.find((c) => c.name === 'Date')!

    const march2024Dates = new Set(
      calendarDs.tables[0].rows.filter((r) => r.Year === 2024 && r.MonthNumber === 3).map((r) => r[dateColumn.name]),
    )
    const expectedMarch2024 = salesDs.tables[0].rows
      .filter((row) => march2024Dates.has(row.Date))
      .reduce((sum, row) => sum + (row.Revenue as number), 0)

    const context = {
      filters: [
        { column: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: yearColumn.id }, operator: 'equals' as const, values: [2025] },
        { column: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: monthNumberColumn.id }, operator: 'equals' as const, values: [3] },
      ],
    }
    const result = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue LY'), context)

    expect(result.value).toBeCloseTo(expectedMarch2024, 2)
  })

  it('Revenue PM (PREVIOUSMONTH) matches an independently computed February 2025 total when March 2025 is selected', () => {
    const { model, datasets, salesTableId, calendarDs, salesDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue PM', 'CALCULATE([Total Revenue], PREVIOUSMONTH(Calendar[Date]))')

    const yearColumn = calendarDs.tables[0].columns.find((c) => c.name === 'Year')!
    const monthNumberColumn = calendarDs.tables[0].columns.find((c) => c.name === 'MonthNumber')!
    const dateColumn = calendarDs.tables[0].columns.find((c) => c.name === 'Date')!

    const feb2025Dates = new Set(
      calendarDs.tables[0].rows.filter((r) => r.Year === 2025 && r.MonthNumber === 2).map((r) => r[dateColumn.name]),
    )
    const expectedFeb2025 = salesDs.tables[0].rows
      .filter((row) => feb2025Dates.has(row.Date))
      .reduce((sum, row) => sum + (row.Revenue as number), 0)

    const context = {
      filters: [
        { column: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: yearColumn.id }, operator: 'equals' as const, values: [2025] },
        { column: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: monthNumberColumn.id }, operator: 'equals' as const, values: [3] },
      ],
    }
    const result = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue PM'), context)

    expect(result.value).toBeCloseTo(expectedFeb2025, 2)
  })

  it('Revenue YTD (TOTALYTD) equals CALCULATE + DATESYTD and an independently computed cumulative total', () => {
    const { model, datasets, salesTableId, calendarDs, salesDs } = buildStarSchemaModel()
    let m = withMeasure(model, datasets, salesTableId, 'Revenue YTD', 'TOTALYTD([Total Revenue], Calendar[Date])')
    m = withMeasure(m, datasets, salesTableId, 'Revenue YTD Explicit', 'CALCULATE([Total Revenue], DATESYTD(Calendar[Date]))')

    const dateColumn = calendarDs.tables[0].columns.find((c) => c.name === 'Date')!
    const anchor = '2025-04-17'
    const ytdDates = new Set(
      calendarDs.tables[0].rows.filter((r) => (r[dateColumn.name] as string) >= '2025-01-01' && (r[dateColumn.name] as string) <= anchor).map((r) => r[dateColumn.name]),
    )
    const expectedYtd = salesDs.tables[0].rows.filter((row) => ytdDates.has(row.Date)).reduce((sum, row) => sum + (row.Revenue as number), 0)

    const context = { filters: [{ column: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: dateColumn.id }, operator: 'equals' as const, values: [anchor] }] }
    const ytd = evaluateMeasure(m, datasets, findMeasureId(m, 'Revenue YTD'), context)
    const ytdExplicit = evaluateMeasure(m, datasets, findMeasureId(m, 'Revenue YTD Explicit'), context)

    expect(ytd.value).toBeCloseTo(expectedYtd, 2)
    expect(ytd.value as number).toBeCloseTo(ytdExplicit.value as number, 6)
    expect(expectedYtd).toBeGreaterThan(0)
  })

  it('Revenue YoY % is a genuine ratio derived from Total Revenue and Revenue LY', () => {
    const { model, datasets, salesTableId, calendarDs } = buildStarSchemaModel()
    let m = withMeasure(model, datasets, salesTableId, 'Revenue LY', 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))')
    m = withMeasure(m, datasets, salesTableId, 'Revenue YoY', '[Total Revenue] - [Revenue LY]')
    m = withMeasure(m, datasets, salesTableId, 'Revenue YoY %', 'DIVIDE([Revenue YoY], [Revenue LY])')

    const yearColumn = calendarDs.tables[0].columns.find((c) => c.name === 'Year')!
    const context = { filters: [{ column: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: yearColumn.id }, operator: 'equals' as const, values: [2025] }] }

    const totalRevenue = evaluateMeasure(m, datasets, findMeasureId(m, 'Total Revenue'), context).value as number
    const revenueLY = evaluateMeasure(m, datasets, findMeasureId(m, 'Revenue LY'), context).value as number
    const yoy = evaluateMeasure(m, datasets, findMeasureId(m, 'Revenue YoY'), context).value as number
    const yoyPct = evaluateMeasure(m, datasets, findMeasureId(m, 'Revenue YoY %'), context).value as number

    expect(yoy).toBeCloseTo(totalRevenue - revenueLY, 6)
    expect(yoyPct).toBeCloseTo(yoy / revenueLY, 6)
  })

  it('PREVIOUSYEAR is BLANK for 2024 (2023 does not exist in the Retail Calendar, sprint brief §51)', () => {
    const { model, datasets, salesTableId, calendarDs } = buildStarSchemaModel()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue PY', 'CALCULATE([Total Revenue], PREVIOUSYEAR(Calendar[Date]))')

    const yearColumn = calendarDs.tables[0].columns.find((c) => c.name === 'Year')!
    const context = { filters: [{ column: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: yearColumn.id }, operator: 'equals' as const, values: [2024] }] }
    const result = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue PY'), context)

    expect(result.value).toBeNull()
  })
})
