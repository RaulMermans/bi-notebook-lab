import { describe, expect, it } from 'vitest'
import { bind } from '../../src/expression/binder'
import { parseExpression } from '../../src/expression/parser'
import { createCalculatedColumn } from '../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { buildIteratorFixture } from '../runtime/measure/iteratorFixture'

describe('Calculated columns: comparison/logical operators (sprint brief §32-§33)', () => {
  it('binds and evaluates a row-dependent comparison', () => {
    const fixture = buildIteratorFixture()
    const created = createCalculatedColumn(fixture.model, fixture.datasets, {
      modelTableId: fixture.salesTableId,
      name: 'Profitable',
      expression: 'Sales[Revenue] > Sales[Cost]',
    })
    expect(created.diagnostics).toEqual([])
    expect(created.execution!.values).toEqual([true, true, true, true, true]) // Revenue > Cost for every fixture row
  })

  it('binds && / || combinations', () => {
    const fixture = buildIteratorFixture()
    const created = createCalculatedColumn(fixture.model, fixture.datasets, {
      modelTableId: fixture.salesTableId,
      name: 'HighQuantityAndRevenue',
      expression: 'Sales[Quantity] >= 5 && Sales[Revenue] > 50',
    })
    expect(created.diagnostics).toEqual([])
    // Quantity>=5 rows: OrderID 3 (Rev 60, true), OrderID 5 (Rev 80, true); rest are false.
    expect(created.execution!.values).toEqual([false, false, true, false, true])
  })
})

describe('Calculated columns: IF (sprint brief §32)', () => {
  it('classifies rows with IF (Order Size)', () => {
    const fixture = buildIteratorFixture()
    const created = createCalculatedColumn(fixture.model, fixture.datasets, {
      modelTableId: fixture.salesTableId,
      name: 'Order Size',
      expression: 'IF(Sales[Revenue] >= 60, "Large", "Standard")',
    })
    expect(created.diagnostics).toEqual([])
    expect(created.execution!.values).toEqual(['Standard', 'Large', 'Large', 'Standard', 'Large'])
  })

  it('IF with TRUE()/FALSE() results (Profitable)', () => {
    const fixture = buildIteratorFixture()
    const created = createCalculatedColumn(fixture.model, fixture.datasets, {
      modelTableId: fixture.salesTableId,
      name: 'Profitable',
      expression: 'IF(Sales[Revenue] > Sales[Cost], TRUE(), FALSE())',
    })
    expect(created.diagnostics).toEqual([])
    expect(created.execution!.values).toEqual([true, true, true, true, true])
  })
})

describe('Calculated columns: SWITCH (sprint brief §34-§35)', () => {
  it('classifies rows with SWITCH(TRUE(), ...) — Revenue Band', () => {
    const fixture = buildIteratorFixture()
    const created = createCalculatedColumn(fixture.model, fixture.datasets, {
      modelTableId: fixture.salesTableId,
      name: 'Revenue Band',
      expression: 'SWITCH(TRUE(), Sales[Revenue] >= 70, "Large", Sales[Revenue] >= 30, "Medium", "Small")',
    })
    expect(created.diagnostics).toEqual([])
    // Revenues: 20, 60, 60, 20, 80
    expect(created.execution!.values).toEqual(['Small', 'Medium', 'Medium', 'Small', 'Large'])
  })
})

describe('Calculated columns: BLANK', () => {
  it('BLANK() produces the internal null representation', () => {
    const fixture = buildIteratorFixture()
    const created = createCalculatedColumn(fixture.model, fixture.datasets, {
      modelTableId: fixture.salesTableId,
      name: 'Always Blank',
      expression: 'BLANK()',
    })
    expect(created.diagnostics).toEqual([])
    expect(created.execution!.values).toEqual([null, null, null, null, null])
  })
})

describe('Calculated column binder-level diagnostics', () => {
  it('rejects a malformed IF arity', () => {
    const fixture = buildIteratorFixture()
    const parsed = parseExpression('IF(Sales[Revenue] > 0)')
    const result = bind(parsed.expression!, { model: fixture.model, datasets: fixture.datasets, currentModelTableId: fixture.salesTableId })
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'IF_INVALID_ARITY' })])
  })

  it('rejects a malformed SWITCH shape', () => {
    const fixture = buildIteratorFixture()
    const parsed = parseExpression('SWITCH(Sales[Revenue])')
    const result = bind(parsed.expression!, { model: fixture.model, datasets: fixture.datasets, currentModelTableId: fixture.salesTableId })
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'INVALID_SWITCH_ARGUMENT' })])
  })

  it('still rejects CALCULATE in a calculated column (context transition remains measure-only)', () => {
    const fixture = buildIteratorFixture()
    const parsed = parseExpression('CALCULATE(Sales[Revenue], Sales[Cost] > 0)')
    const result = bind(parsed.expression!, { model: fixture.model, datasets: fixture.datasets, currentModelTableId: fixture.salesTableId })
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'CALCULATE_CONTEXT_TRANSITION_NOT_SUPPORTED' })])
  })
})
