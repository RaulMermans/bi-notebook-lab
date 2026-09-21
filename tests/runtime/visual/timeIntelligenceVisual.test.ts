import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { ColumnRef } from '../../../src/domain/model'
import { generateRetailDataset } from '../../../src/lib/sample/generateRetailDataset'
import { markDateTable } from '../../../src/runtime/dateTable/dateTableRuntime'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship } from '../../../src/runtime/model/modelRuntime'
import { runTableVisual } from '../../../src/runtime/visual/visualRuntime'

/**
 * Sprint 10 Visual Cells integration (sprint brief §50): a time-intelligence
 * measure must automatically work in an existing Visual with **no
 * visual-specific implementation** — every number still comes from the
 * unmodified `evaluateMeasure` (docs/TIME_INTELLIGENCE.md "Trace / Context
 * Explorer / Visual Cells"). Mirrors `calculateVisual.test.ts`/
 * `iteratorVisual.test.ts`'s exact pattern for Sprint 8/9.
 */
describe('Visual Cells — Sprint 10 time-intelligence integration', () => {
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
      { one: { datasetId: customersDs.id, tableId: customersDs.tables[0].id, columnId: findColumn(customersDs, 'CustomerID').id }, many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'CustomerID').id } },
      datasets,
    ).model
    model = createRelationship(
      model,
      { one: { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: findColumn(calendarDs, 'Date').id }, many: { datasetId: salesDs.id, tableId: salesDs.tables[0].id, columnId: findColumn(salesDs, 'Date').id } },
      datasets,
    ).model

    const dateColumn: ColumnRef = { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: findColumn(calendarDs, 'Date').id }
    model = markDateTable(model, datasets, calendarTableId, dateColumn).model

    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    model = m.model
    m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Revenue LY', expression: 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))' })
    expect(m.diagnostics).toEqual([])
    model = m.model

    return { model, datasets, calendarDs }
  }

  it('a grouped Table visual computes Total Revenue and Revenue LY per Year, with no visual-specific time-intelligence code', () => {
    const { model, datasets, calendarDs } = buildStarSchemaModel()
    const yearColumn: ColumnRef = { datasetId: calendarDs.id, tableId: calendarDs.tables[0].id, columnId: calendarDs.tables[0].columns.find((c) => c.name === 'Year')!.id }
    const totalRevenueId = model.measures.find((m) => m.name === 'Total Revenue')!.id
    const revenueLYId = model.measures.find((m) => m.name === 'Revenue LY')!.id

    const result = runTableVisual(
      model,
      datasets,
      { id: 'v1', type: 'table', dimension: yearColumn, measureIds: [totalRevenueId, revenueLYId] },
      { filters: [] },
    )

    expect(result.status).toBe('success')
    const row2025 = result.rows.find((r) => r.dimensionLabel === '2025')!
    const row2024 = result.rows.find((r) => r.dimensionLabel === '2024')!

    // Cross-check against the same measures evaluated directly (not through a Visual).
    const yearFilter = (year: number) => ({ filters: [{ column: yearColumn, operator: 'equals' as const, values: [year] }] })
    const directTotal2025 = evaluateMeasure(model, datasets, totalRevenueId, yearFilter(2025)).value
    const directLY2025 = evaluateMeasure(model, datasets, revenueLYId, yearFilter(2025)).value

    expect(row2025.measureValues[totalRevenueId]).toBe(directTotal2025)
    expect(row2025.measureValues[revenueLYId]).toBe(directLY2025)
    expect(row2025.measureValues[revenueLYId]).toBeGreaterThan(0) // 2024 exists — never blank for 2025
    expect(row2024.measureValues[revenueLYId]).toBeNull() // 2023 doesn't exist — BLANK is correct here
  })
})
