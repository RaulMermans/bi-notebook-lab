import { describe, expect, it } from 'vitest'
import { createCalculatedColumn } from '../../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { buildIteratorFixture } from './iteratorFixture'

function evalExpr(fixture: ReturnType<typeof buildIteratorFixture>, expression: string) {
  const created = createMeasure(fixture.model, fixture.datasets, { homeModelTableId: fixture.salesTableId, name: 'Test Measure', expression })
  expect(created.diagnostics).toEqual([])
  return { execution: created.execution!, model: created.model }
}

describe('COUNTROWS generalization (sprint brief §14)', () => {
  it('COUNTROWS(Sales) still returns the plain row count (regression)', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'COUNTROWS(Sales)')
    expect(execution.value).toBe(5)
  })

  it('COUNTROWS(FILTER(Sales, Sales[Quantity] >= 5)) counts the filtered subset', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'COUNTROWS(FILTER(Sales, Sales[Quantity] >= 5))')
    expect(execution.value).toBe(2)
  })

  it('COUNTROWS(VALUES(Customers[Country])) counts distinct visible countries', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'COUNTROWS(VALUES(Customers[Country]))')
    expect(execution.value).toBe(2)
  })
})

describe('SUMX', () => {
  it('sums a simple column expression', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'SUMX(Sales, Sales[Revenue])')
    expect(execution.value).toBe(240) // 20+60+60+20+80
  })

  it('sums an arithmetic expression (Gross Margin X)', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'SUMX(Sales, Sales[Revenue] - Sales[Cost])')
    // (20-12)+(60-30)+(60-36)+(20-14)+(80-48) = 8+30+24+6+32 = 100
    expect(execution.value).toBe(100)
  })

  it('matches Total Revenue - Total Cost computed independently', () => {
    const fixture = buildIteratorFixture()
    const grossMargin = evaluateMeasure(fixture.model, fixture.datasets, fixture.totalRevenueId).value as number
    const grossCost = evaluateMeasure(fixture.model, fixture.datasets, fixture.totalCostId).value as number
    const { execution } = evalExpr(fixture, 'SUMX(Sales, Sales[Revenue] - Sales[Cost])')
    expect(execution.value).toBeCloseTo(grossMargin - grossCost, 6)
  })

  it('SUMX + RELATED matches SUM(Sales[Revenue])', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'SUMX(Sales, Sales[Quantity] * RELATED(Products[UnitPrice]))')
    const totalRevenue = evaluateMeasure(fixture.model, fixture.datasets, fixture.totalRevenueId).value
    expect(execution.value).toBeCloseTo(totalRevenue as number, 6)
  })

  it('FILTER + SUMX (High Quantity Revenue) matches an independently-derived value', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'SUMX(FILTER(Sales, Sales[Quantity] >= 5), Sales[Revenue])')
    expect(execution.value).toBe(140) // OrderID 3 (60) + OrderID 5 (80)
  })

  it('SUMX can read a calculated column on the iterated table', () => {
    const fixture = buildIteratorFixture()
    // Add a calculated column "Margin" = Revenue - Cost, then SUMX it directly.
    const withColumn = createCalculatedColumn(fixture.model, fixture.datasets, {
      modelTableId: fixture.salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })
    expect(withColumn.diagnostics).toEqual([])
    const created = createMeasure(withColumn.model, fixture.datasets, {
      homeModelTableId: fixture.salesTableId,
      name: 'Margin Sum',
      expression: 'SUMX(Sales, Sales[Margin])',
    })
    expect(created.diagnostics).toEqual([])
    expect(created.execution!.value).toBe(100)
  })

  it('respects the external FilterContext (Spain only)', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, { homeModelTableId: fixture.salesTableId, name: 'M', expression: 'SUMX(Sales, Sales[Revenue])' })
    const countryColumn = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }
    const result = evaluateMeasure(created.model, fixture.datasets, created.measure!.id, { filters: [{ column: countryColumn, operator: 'equals', values: ['Spain'] }] })
    expect(result.value).toBe(100) // OrderID 1 (20) + 3 (60) + 4 (20)
  })

  it('an empty visible table yields BLANK', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, { homeModelTableId: fixture.salesTableId, name: 'M', expression: 'SUMX(Sales, Sales[Revenue])' })
    const countryColumn = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }
    const result = evaluateMeasure(created.model, fixture.datasets, created.measure!.id, { filters: [{ column: countryColumn, operator: 'equals', values: ['Nowhere'] }] })
    expect(result.value).toBeNull()
  })

  it('ignores blank row-expression results', () => {
    const fixture = buildIteratorFixture()
    fixture.datasets['sales-ds'].tables[0].rows[0].Revenue = null
    const { execution } = evalExpr(fixture, 'SUMX(Sales, Sales[Revenue])')
    expect(execution.value).toBe(220) // 240 - 20 (blank row excluded, not treated as zero)
  })

  it('rejects a row expression outside the iterator table at bind time', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, { homeModelTableId: fixture.salesTableId, name: 'M', expression: 'SUMX(Sales, Customers[Country])' })
    // Country isn't a Sales column -> row-scope violation at bind time (no implicit relationship traversal).
    expect(created.diagnostics.some((d) => d.code === 'ITERATOR_ROW_SCOPE_VIOLATION')).toBe(true)
  })

  it('reports a structured diagnostic instead of coercing a non-numeric result', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, { homeModelTableId: fixture.salesTableId, name: 'M', expression: 'SUMX(Sales, Sales[Revenue] > 0)' })
    const result = evaluateMeasure(created.model, fixture.datasets, created.measure!.id)
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'ITERATOR_EXPRESSION_TYPE_ERROR' })])
  })
})

describe('AVERAGEX', () => {
  it('averages a row expression (Average Margin per Sale)', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'AVERAGEX(Sales, Sales[Revenue] - Sales[Cost])')
    expect(execution.value).toBe(20) // 100 / 5
  })

  it('counts zero as a real value but excludes blank', () => {
    const fixture = buildIteratorFixture()
    fixture.datasets['sales-ds'].tables[0].rows[0].Revenue = 0
    fixture.datasets['sales-ds'].tables[0].rows[0].Cost = 0
    fixture.datasets['sales-ds'].tables[0].rows[1].Revenue = null
    fixture.datasets['sales-ds'].tables[0].rows[1].Cost = null
    const { execution } = evalExpr(fixture, 'AVERAGEX(Sales, Sales[Revenue] - Sales[Cost])')
    // Row1 -> 0 (real value, contributes); Row2 -> BLANK - BLANK -> BLANK (excluded)
    // remaining contributing rows: row1(0), row3(24), row4(6), row5(32) => avg = 62/4 = 15.5
    expect(execution.value).toBe(15.5)
  })

  it('zero visible rows yields BLANK', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'AVERAGEX(FILTER(Sales, Sales[Quantity] >= 100), Sales[Revenue])')
    expect(execution.value).toBeNull()
  })
})

describe('MINX / MAXX', () => {
  it('MINX finds the minimum row expression result', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'MINX(Sales, Sales[Revenue])')
    expect(execution.value).toBe(20)
  })

  it('MAXX finds the maximum row expression result', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'MAXX(Sales, Sales[Revenue])')
    expect(execution.value).toBe(80)
  })

  it('skips blank values', () => {
    const fixture = buildIteratorFixture()
    fixture.datasets['sales-ds'].tables[0].rows[3].Revenue = null // the row with Revenue 20 (a min candidate)
    const { execution } = evalExpr(fixture, 'MINX(Sales, Sales[Revenue])')
    expect(execution.value).toBe(20) // OrderID 1 still has Revenue 20
  })

  it('rejects the unsupported 3-argument (variant) form', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, { homeModelTableId: fixture.salesTableId, name: 'M', expression: 'MAXX(Sales, Sales[Revenue], TRUE())' })
    expect(created.diagnostics.some((d) => d.code === 'INVALID_ITERATOR_ARGUMENT')).toBe(true)
  })
})

describe('COUNTX', () => {
  it('counts nonblank row expression results', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'COUNTX(Sales, Sales[Revenue])')
    expect(execution.value).toBe(5)
  })

  it('does not count BLANK', () => {
    const fixture = buildIteratorFixture()
    fixture.datasets['sales-ds'].tables[0].rows[0].Revenue = null
    const { execution } = evalExpr(fixture, 'COUNTX(Sales, Sales[Revenue])')
    expect(execution.value).toBe(4)
  })

  it('COUNTX(VALUES(Customers[Country]), Customers[Country]) counts distinct visible countries via the virtual row value', () => {
    const fixture = buildIteratorFixture()
    const { execution } = evalExpr(fixture, 'COUNTX(VALUES(Customers[Country]), Customers[Country])')
    expect(execution.value).toBe(2)
  })
})

describe('Iterator diagnostics', () => {
  it('rejects a non-table first argument', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, { homeModelTableId: fixture.salesTableId, name: 'M', expression: 'SUMX(1, Sales[Revenue])' })
    expect(created.diagnostics.some((d) => d.code === 'ITERATOR_TABLE_REQUIRED')).toBe(true)
  })

  it('rejects the wrong arity', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, { homeModelTableId: fixture.salesTableId, name: 'M', expression: 'SUMX(Sales)' })
    expect(created.diagnostics.some((d) => d.code === 'INVALID_ITERATOR_ARGUMENT')).toBe(true)
  })
})
