import { describe, expect, it } from 'vitest'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { setRelationshipActive } from '../../../src/runtime/model/modelRuntime'
import { evaluateMeasureResultRule } from '../../../src/runtime/validation/measureValidation'
import { addRetailFoundationsSolution, buildRetailModel } from './helpers'

function sumRevenue(rows: Record<string, unknown>[], predicate: (row: Record<string, unknown>) => boolean = () => true) {
  return rows.filter(predicate).reduce((total, r) => total + (predicate(r) ? (r.Revenue as number) : 0), 0)
}

describe('measureValidation', () => {
  it('passes the unfiltered expected result', () => {
    const { model, datasets, salesTableId, salesDs } = buildRetailModel()
    const withMeasures = addRetailFoundationsSolution(model, datasets, salesTableId)
    const expected = sumRevenue(salesDs.tables[0].rows)

    const result = evaluateMeasureResultRule(
      { id: 'r', type: 'measure-result', title: 'Total Revenue', points: 10, measure: { name: 'Total Revenue' }, cases: [{ id: 'all', title: 'All data', filters: [], expected }] },
      withMeasures,
      datasets,
    )
    expect(result.status).toBe('passed')
    expect(result.pointsEarned).toBe(10)
  })

  it('checks a dimension-filtered case (Country = Spain)', () => {
    const { model, datasets, salesTableId, salesDs, customersDs } = buildRetailModel()
    const withMeasures = addRetailFoundationsSolution(model, datasets, salesTableId)
    const spainIds = new Set(customersDs.tables[0].rows.filter((r) => r.Country === 'Spain').map((r) => r.CustomerID))
    const expected = sumRevenue(salesDs.tables[0].rows, (r) => spainIds.has(r.CustomerID))

    const result = evaluateMeasureResultRule(
      {
        id: 'r', type: 'measure-result', title: 'Total Revenue', points: 10, measure: { name: 'Total Revenue' },
        cases: [{ id: 'spain', title: 'Spain', filters: [{ column: { table: { tableName: 'Customers' }, columnName: 'Country' }, values: ['Spain'] }], expected }],
      },
      withMeasures,
      datasets,
    )
    expect(result.status).toBe('passed')
  })

  it('checks multiple simultaneous filters (Spain AND Furniture)', () => {
    const { model, datasets, salesTableId, salesDs, customersDs, productsDs } = buildRetailModel()
    const withMeasures = addRetailFoundationsSolution(model, datasets, salesTableId)
    const spainIds = new Set(customersDs.tables[0].rows.filter((r) => r.Country === 'Spain').map((r) => r.CustomerID))
    const furnitureIds = new Set(productsDs.tables[0].rows.filter((r) => r.Category === 'Furniture').map((r) => r.ProductID))
    const expected = sumRevenue(salesDs.tables[0].rows, (r) => spainIds.has(r.CustomerID) && furnitureIds.has(r.ProductID))

    const result = evaluateMeasureResultRule(
      {
        id: 'r', type: 'measure-result', title: 'Total Revenue', points: 10, measure: { name: 'Total Revenue' },
        cases: [{
          id: 'both', title: 'Spain + Furniture', expected,
          filters: [
            { column: { table: { tableName: 'Customers' }, columnName: 'Country' }, values: ['Spain'] },
            { column: { table: { tableName: 'Products' }, columnName: 'Category' }, values: ['Furniture'] },
          ],
        }],
      },
      withMeasures,
      datasets,
    )
    expect(result.status).toBe('passed')
  })

  it('checks a Calendar[Year] filter propagated through Sales[Date]', () => {
    const { model, datasets, salesTableId, salesDs, calendarDs } = buildRetailModel()
    const withMeasures = addRetailFoundationsSolution(model, datasets, salesTableId)
    const targetYear = calendarDs.tables[0].rows[0].Year as number
    const datesInYear = new Set(calendarDs.tables[0].rows.filter((r) => r.Year === targetYear).map((r) => r.Date))
    const expected = sumRevenue(salesDs.tables[0].rows, (r) => datesInYear.has(r.Date))

    const result = evaluateMeasureResultRule(
      {
        id: 'r', type: 'measure-result', title: 'Total Revenue', points: 10, measure: { name: 'Total Revenue' },
        cases: [{ id: 'year', title: 'Year', filters: [{ column: { table: { tableName: 'Calendar' }, columnName: 'Year' }, values: [targetYear] }], expected }],
      },
      withMeasures,
      datasets,
    )
    expect(result.status).toBe('passed')
  })

  it('fails a case once the required relationship is disabled', () => {
    const { model, datasets, salesTableId, productRelationshipId, productsDs, salesDs } = buildRetailModel()
    const withMeasures = addRetailFoundationsSolution(model, datasets, salesTableId)
    const disabled = setRelationshipActive(withMeasures, productRelationshipId, false)
    const category = productsDs.tables[0].rows[0].Category as string
    const furnitureIds = new Set(productsDs.tables[0].rows.filter((r) => r.Category === category).map((r) => r.ProductID))
    const expectedIfActive = sumRevenue(salesDs.tables[0].rows, (r) => furnitureIds.has(r.ProductID))

    const result = evaluateMeasureResultRule(
      {
        id: 'r', type: 'measure-result', title: 'Total Revenue', points: 10, measure: { name: 'Total Revenue' },
        cases: [{ id: 'furniture', title: 'Furniture', filters: [{ column: { table: { tableName: 'Products' }, columnName: 'Category' }, values: [category] }], expected: expectedIfActive }],
      },
      disabled,
      datasets,
    )
    // With the relationship disabled the filter never reaches Sales, so the actual result is the
    // unfiltered total, not the (smaller) filtered total the case expects.
    expect(result.status).toBe('failed')
  })

  it('reports MEASURE_MISSING (not an error) when the measure has not been created yet', () => {
    const { model, datasets } = buildRetailModel()
    const result = evaluateMeasureResultRule(
      { id: 'r', type: 'measure-result', title: 'Total Revenue', points: 10, measure: { name: 'Total Revenue' }, cases: [{ id: 'all', title: 'All', filters: [], expected: 1 }] },
      model,
      datasets,
    )
    expect(result.status).toBe('failed')
    expect(result.feedback[0].code).toBe('MEASURE_MISSING')
  })

  it('surfaces a measure execution error distinctly from a wrong-value case', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const base = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    const dependent = createMeasure(base.model, datasets, { homeModelTableId: salesTableId, name: 'Doubled', expression: '[Total Revenue] * 2' })
    expect(dependent.diagnostics).toEqual([])

    // A measure the model no longer contains (e.g. deleted without its dependents being
    // updated) fails at evaluation time — a runtime concern, not a "wrong value" concern.
    const broken = { ...dependent.model, measures: dependent.model.measures.filter((m) => m.name !== 'Total Revenue') }

    const result = evaluateMeasureResultRule(
      { id: 'r', type: 'measure-result', title: 'Doubled', points: 10, measure: { name: 'Doubled' }, cases: [{ id: 'all', title: 'All', filters: [], expected: 1 }] },
      broken,
      datasets,
    )
    expect(result.status).toBe('failed')
    expect(result.feedback.some((f) => f.code === 'MEASURE_EXECUTION_ERROR')).toBe(true)
  })

  it('MANDATORY REGRESSION: a hardcoded grand-total measure passes the unfiltered case but fails filtered fixtures, earning only partial credit', () => {
    const { model, datasets, salesTableId, salesDs, customersDs } = buildRetailModel()
    const totalRevenue = sumRevenue(salesDs.tables[0].rows)
    const spainIds = new Set(customersDs.tables[0].rows.filter((r) => r.Country === 'Spain').map((r) => r.CustomerID))
    const spainRevenue = sumRevenue(salesDs.tables[0].rows, (r) => spainIds.has(r.CustomerID))
    expect(spainRevenue).toBeLessThan(totalRevenue) // sanity: Spain is a strict subset

    const hardcoded = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: String(totalRevenue),
    })
    expect(hardcoded.diagnostics).toEqual([])

    const result = evaluateMeasureResultRule(
      {
        id: 'r', type: 'measure-result', title: 'Total Revenue', points: 20, measure: { name: 'Total Revenue' },
        cases: [
          { id: 'all', title: 'All data', filters: [], expected: totalRevenue },
          { id: 'spain', title: 'Spain', filters: [{ column: { table: { tableName: 'Customers' }, columnName: 'Country' }, values: ['Spain'] }], expected: spainRevenue },
        ],
      },
      hardcoded.model,
      datasets,
    )

    expect(result.status).toBe('partial')
    expect(result.pointsEarned).toBe(10) // exactly one of two equally-weighted cases
    expect(result.pointsEarned).toBeLessThan(20)
    expect(result.feedback.some((f) => f.code === 'HINT_FILTER_CONTEXT')).toBe(true)
  })

  it('validates a CALCULATE-based measure normally, with no changes required to the numeric-result rule (sprint brief §53)', () => {
    const { model, datasets, salesTableId, salesDs, customersDs } = buildRetailModel()
    const totalRevenue = sumRevenue(salesDs.tables[0].rows)
    const spainIds = new Set(customersDs.tables[0].rows.filter((r) => r.Country === 'Spain').map((r) => r.CustomerID))
    const spainRevenue = sumRevenue(salesDs.tables[0].rows, (r) => spainIds.has(r.CustomerID))

    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    expect(m.diagnostics).toEqual([])
    m = createMeasure(m.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Spain Revenue',
      expression: 'CALCULATE([Total Revenue], Customers[Country] = "Spain")',
    })
    expect(m.diagnostics).toEqual([])

    // Correctly context-aware: the CALCULATE'd Spain figure must hold regardless of any external filter case.
    const result = evaluateMeasureResultRule(
      {
        id: 'r', type: 'measure-result', title: 'Spain Revenue', points: 20, measure: { name: 'Spain Revenue' },
        cases: [
          { id: 'unfiltered', title: 'No external filter', filters: [], expected: spainRevenue },
          {
            id: 'france-slicer',
            title: 'Under an external France slicer (must still show Spain)',
            filters: [{ column: { table: { tableName: 'Customers' }, columnName: 'Country' }, values: ['France'] }],
            expected: spainRevenue,
          },
        ],
      },
      m.model,
      datasets,
    )

    expect(result.status).toBe('passed')
    expect(result.pointsEarned).toBe(20)
    expect(spainRevenue).toBeLessThan(totalRevenue) // sanity: Spain is a strict, non-trivial subset
  })

  it('MANDATORY REGRESSION: SUM(Sales[Revenue]) and CALCULATE(SUM(Sales[Revenue])) agree on an unfiltered result (sprint brief §53)', () => {
    const { model, datasets, salesTableId, salesDs } = buildRetailModel()
    const totalRevenue = sumRevenue(salesDs.tables[0].rows)

    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Plain Sum', expression: 'SUM(Sales[Revenue])' })
    expect(m.diagnostics).toEqual([])
    // CALCULATE with no filter arguments at all — valid per sprint brief §53's literal example.
    m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'Calculated Sum', expression: 'CALCULATE(SUM(Sales[Revenue]))' })
    expect(m.diagnostics).toEqual([])

    for (const measureName of ['Plain Sum', 'Calculated Sum']) {
      const result = evaluateMeasureResultRule(
        { id: 'r', type: 'measure-result', title: measureName, points: 10, measure: { name: measureName }, cases: [{ id: 'all', title: 'All data', filters: [], expected: totalRevenue }] },
        m.model,
        datasets,
      )
      expect(result.status).toBe('passed')
    }
  })
})
