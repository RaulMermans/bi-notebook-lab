import { describe, expect, it } from 'vitest'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { buildIteratorFixture } from './iteratorFixture'

/**
 * Sprint 9's implicit context-transition mechanism (sprint brief §40-§43) —
 * a measure referenced inside an iterator's row expression must evaluate
 * under a filter context derived from the current row's own lineage, must
 * compose with the enclosing external FilterContext, and must never leak
 * one row's result into another's.
 */
describe('Iterator implicit context transition', () => {
  it('a measure reference inside a model-table iterator sees each row as its own filter context', () => {
    const fixture = buildIteratorFixture()
    // Revenue Across Products: SUMX(Products, [Total Revenue]) should equal grand Total Revenue,
    // since Products fully partitions Sales (every Sales row has exactly one Product).
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.productsTableId,
      name: 'Revenue Across Products',
      expression: 'SUMX(Products, [Total Revenue])',
    })
    expect(created.diagnostics).toEqual([])
    const totalRevenue = evaluateMeasure(created.model, fixture.datasets, fixture.totalRevenueId).value
    expect(created.execution!.value).toBeCloseTo(totalRevenue as number, 6)
  })

  it('a measure reference inside a VALUES iterator receives the source column as a filter (virtual row lineage)', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.productsTableId,
      name: 'Revenue Across Categories',
      expression: 'SUMX(VALUES(Products[Category]), [Total Revenue])',
    })
    expect(created.diagnostics).toEqual([])
    const totalRevenue = evaluateMeasure(created.model, fixture.datasets, fixture.totalRevenueId).value
    expect(created.execution!.value).toBeCloseTo(totalRevenue as number, 6)
  })

  it('cache leakage regression: two different rows never share a cached measure result', () => {
    const fixture = buildIteratorFixture()
    // Per-category revenue differs: Furniture rows (1,3,5) = 20+60+80=160; Electronics (2,4) = 60+20=80.
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.productsTableId,
      name: 'Revenue By Category Concat',
      expression: 'SUMX(VALUES(Products[Category]), [Total Revenue])',
    })
    expect(created.diagnostics).toEqual([])
    // If caching leaked, this would incorrectly equal 160*2 or 80*2 instead of 160+80=240.
    expect(created.execution!.value).toBe(240)
  })

  it('external FilterContext survives the iterator context transition (Spain only)', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.productsTableId,
      name: 'Revenue Across Categories',
      expression: 'SUMX(VALUES(Products[Category]), [Total Revenue])',
    })
    expect(created.diagnostics).toEqual([])

    const countryColumn = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }
    const spainResult = evaluateMeasure(created.model, fixture.datasets, created.measure!.id, {
      filters: [{ column: countryColumn, operator: 'equals', values: ['Spain'] }],
    })
    const spainTotalRevenue = evaluateMeasure(created.model, fixture.datasets, fixture.totalRevenueId, {
      filters: [{ column: countryColumn, operator: 'equals', values: ['Spain'] }],
    }).value
    expect(spainResult.value).toBeCloseTo(spainTotalRevenue as number, 6)
    expect(spainResult.value).not.toBe(created.execution!.value) // must differ from the unfiltered grand total
  })

  it('composes correctly with a CALCULATE-defined measure referenced from an iterator row', () => {
    const fixture = buildIteratorFixture()
    const countryColumn = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }
    const spainRevenue = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.salesTableId,
      name: 'Spain Revenue',
      expression: `CALCULATE([Total Revenue], Customers[Country] = "Spain")`,
    })
    expect(spainRevenue.diagnostics).toEqual([])

    const created = createMeasure(spainRevenue.model, fixture.datasets, {
      homeModelTableId: fixture.productsTableId,
      name: 'Spain Revenue Across Categories',
      expression: 'SUMX(VALUES(Products[Category]), [Spain Revenue])',
    })
    expect(created.diagnostics).toEqual([])

    const directSpainRevenue = evaluateMeasure(created.model, fixture.datasets, spainRevenue.measure!.id).value
    // Category fully partitions Products, and every Spain sale has a category, so this should match
    // the plain Spain Revenue measure (Category's context-transition filter narrows Products, but every
    // category still reaches some Spain sales in this fixture).
    expect(created.execution!.value).toBeCloseTo(directSpainRevenue as number, 6)
  })
})
