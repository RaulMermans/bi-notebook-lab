import { describe, expect, it } from 'vitest'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { buildIteratorFixture } from './iteratorFixture'

describe('IF in measures', () => {
  it('returns the true branch', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.salesTableId,
      name: 'Revenue Status',
      expression: 'IF([Total Revenue] >= 100, "High", "Low")',
    })
    expect(created.diagnostics).toEqual([])
    expect(created.execution!.value).toBe('High') // Total Revenue = 240
  })

  it('returns the false branch', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.salesTableId,
      name: 'Revenue Status',
      expression: 'IF([Total Revenue] >= 10000, "High", "Low")',
    })
    expect(created.execution!.value).toBe('Low')
  })

  it('returns BLANK when the false branch is omitted', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.salesTableId,
      name: 'High Revenue Flag',
      expression: 'IF([Total Revenue] >= 10000, "High")',
    })
    expect(created.execution!.value).toBeNull()
  })

  it('is filter-context dependent (reacts to a slicer)', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.salesTableId,
      name: 'Revenue Status',
      expression: 'IF([Total Revenue] >= 200, "High", "Low")',
    })
    const countryColumn = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }
    const spain = evaluateMeasure(created.model, fixture.datasets, created.measure!.id, {
      filters: [{ column: countryColumn, operator: 'equals', values: ['Spain'] }],
    })
    // Spain revenue = 20+60+20 = 100 -> Low; grand total 240 -> High.
    expect(spain.value).toBe('Low')
    expect(created.execution!.value).toBe('High')
  })
})

describe('SWITCH in measures', () => {
  it('matches the first true case with SWITCH(TRUE(), ...)', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.salesTableId,
      name: 'Revenue Band',
      expression: 'SWITCH(TRUE(), [Total Revenue] >= 2000, "Large", [Total Revenue] >= 200, "Medium", "Small")',
    })
    expect(created.diagnostics).toEqual([])
    expect(created.execution!.value).toBe('Medium') // 240 >= 200 but < 2000
  })

  it('falls through to the else branch when nothing matches', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.salesTableId,
      name: 'Revenue Band',
      expression: 'SWITCH(TRUE(), [Total Revenue] >= 2000, "Large", "Small")',
    })
    expect(created.execution!.value).toBe('Small')
  })

  it('returns BLANK with no match and no default', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.salesTableId,
      name: 'Revenue Band',
      expression: 'SWITCH(TRUE(), [Total Revenue] >= 2000, "Large")',
    })
    expect(created.execution!.value).toBeNull()
  })

  it('matches canonical expression/value form and stops at the first match', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.salesTableId,
      name: 'Country Label',
      expression: 'SWITCH(1, 1, "one", 1, "also one", "other")',
    })
    expect(created.execution!.value).toBe('one')
  })
})

describe('SELECTEDVALUE', () => {
  it('returns the alternate when multiple values are visible', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.customersTableId,
      name: 'Selected Country',
      expression: 'SELECTEDVALUE(Customers[Country], "Multiple Countries")',
    })
    expect(created.diagnostics).toEqual([])
    expect(created.execution!.value).toBe('Multiple Countries')
  })

  it('returns the single visible value under a slicer', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.customersTableId,
      name: 'Selected Country',
      expression: 'SELECTEDVALUE(Customers[Country], "Multiple Countries")',
    })
    const countryColumn = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }
    const result = evaluateMeasure(created.model, fixture.datasets, created.measure!.id, {
      filters: [{ column: countryColumn, operator: 'equals', values: ['Spain'] }],
    })
    expect(result.value).toBe('Spain')
  })

  it('returns "Multiple Countries" for Spain + France (an in-filter of two values)', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.customersTableId,
      name: 'Selected Country',
      expression: 'SELECTEDVALUE(Customers[Country], "Multiple Countries")',
    })
    const countryColumn = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }
    const result = evaluateMeasure(created.model, fixture.datasets, created.measure!.id, {
      filters: [{ column: countryColumn, operator: 'in', values: ['Spain', 'France'] }],
    })
    expect(result.value).toBe('Multiple Countries')
  })

  it('defaults to BLANK with no alternate and zero visible values', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, {
      homeModelTableId: fixture.customersTableId,
      name: 'Selected Country No Alt',
      expression: 'SELECTEDVALUE(Customers[Country])',
    })
    const countryColumn = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }
    const result = evaluateMeasure(created.model, fixture.datasets, created.measure!.id, {
      filters: [{ column: countryColumn, operator: 'equals', values: ['Nowhere'] }],
    })
    expect(result.value).toBeNull()
  })
})

describe('BLANK/TRUE/FALSE', () => {
  it('BLANK() evaluates to the internal null representation', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, { homeModelTableId: fixture.salesTableId, name: 'Always Blank', expression: 'BLANK()' })
    expect(created.diagnostics).toEqual([])
    expect(created.execution!.value).toBeNull()
  })

  it('TRUE()/FALSE() work as literal calls', () => {
    const fixture = buildIteratorFixture()
    const created = createMeasure(fixture.model, fixture.datasets, { homeModelTableId: fixture.salesTableId, name: 'Always True', expression: 'IF(TRUE(), "yes", "no")' })
    expect(created.execution!.value).toBe('yes')
  })
})
