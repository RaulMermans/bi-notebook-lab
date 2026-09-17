import { describe, expect, it } from 'vitest'
import { createCalculatedColumn } from '../../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { setRelationshipActive } from '../../../src/runtime/model/modelRuntime'
import { evaluateCalculatedColumnResultRule } from '../../../src/runtime/validation/calculatedColumnValidation'
import { buildRetailModel } from './helpers'

describe('calculatedColumnValidation', () => {
  function withMargin() {
    const built = buildRetailModel()
    const created = createCalculatedColumn(built.model, built.datasets, {
      modelTableId: built.salesTableId,
      name: 'Margin',
      expression: 'Sales[Revenue] - Sales[Cost]',
    })
    expect(created.diagnostics).toEqual([])
    return { ...built, model: created.model }
  }

  it('passes when every row case matches the frozen expected value', () => {
    const { model, datasets, salesDs } = withMargin()
    const orderIds = [1, 2, 3]
    const cases = orderIds.map((orderId) => {
      const row = salesDs.tables[0].rows[orderId - 1]
      return {
        id: `case-${orderId}`,
        row: { column: { table: { tableName: 'Sales' }, columnName: 'OrderID' }, equals: orderId },
        expected: (row.Revenue as number) - (row.Cost as number),
      }
    })

    const result = evaluateCalculatedColumnResultRule(
      { id: 'margin', type: 'calculated-column-result', title: 'Margin', points: 10, column: { table: { tableName: 'Sales' }, name: 'Margin' }, cases },
      model,
      datasets,
    )
    expect(result.status).toBe('passed')
    expect(result.pointsEarned).toBe(10)
  })

  it('awards partial credit when one of several cases is wrong', () => {
    const { model, datasets, salesDs } = withMargin()
    const row1 = salesDs.tables[0].rows[0]
    const cases = [
      { id: 'ok', row: { column: { table: { tableName: 'Sales' }, columnName: 'OrderID' }, equals: 1 }, expected: (row1.Revenue as number) - (row1.Cost as number) },
      { id: 'wrong', row: { column: { table: { tableName: 'Sales' }, columnName: 'OrderID' }, equals: 2 }, expected: 999999 },
    ]

    const result = evaluateCalculatedColumnResultRule(
      { id: 'margin', type: 'calculated-column-result', title: 'Margin', points: 10, column: { table: { tableName: 'Sales' }, name: 'Margin' }, cases },
      model,
      datasets,
    )
    expect(result.status).toBe('partial')
    expect(result.pointsEarned).toBe(5)
  })

  it('reports CALCULATED_COLUMN_MISSING (a learner failure, not a config error) when the column has not been created yet', () => {
    const { model, datasets } = buildRetailModel()
    const result = evaluateCalculatedColumnResultRule(
      { id: 'margin', type: 'calculated-column-result', title: 'Margin', points: 10, column: { table: { tableName: 'Sales' }, name: 'Margin' }, cases: [] },
      model,
      datasets,
    )
    expect(result.status).toBe('failed')
    expect(result.feedback[0].code).toBe('CALCULATED_COLUMN_MISSING')
  })

  it('surfaces a column diagnostic (e.g. a disabled RELATED relationship) instead of pretending the column is simply wrong', () => {
    const built = buildRetailModel()
    const marginByCategory = createCalculatedColumn(built.model, built.datasets, {
      modelTableId: built.salesTableId,
      name: 'CategoryLabel',
      expression: 'RELATED(Products[Category])',
    })
    expect(marginByCategory.diagnostics).toEqual([])
    const disabled = setRelationshipActive(marginByCategory.model, built.productRelationshipId, false)

    const result = evaluateCalculatedColumnResultRule(
      {
        id: 'cat', type: 'calculated-column-result', title: 'CategoryLabel', points: 10,
        column: { table: { tableName: 'Sales' }, name: 'CategoryLabel' },
        cases: [{ id: 'c1', row: { column: { table: { tableName: 'Sales' }, columnName: 'OrderID' }, equals: 1 }, expected: 'Electronics' }],
      },
      disabled,
      built.datasets,
    )
    expect(result.status).toBe('failed')
    expect(result.feedback[0].code).toBe('RELATED_INACTIVE_RELATIONSHIP')
  })

  it('reports a configuration error when the row selector matches no row', () => {
    const { model, datasets } = withMargin()
    const result = evaluateCalculatedColumnResultRule(
      {
        id: 'margin', type: 'calculated-column-result', title: 'Margin', points: 10,
        column: { table: { tableName: 'Sales' }, name: 'Margin' },
        cases: [{ id: 'missing-row', row: { column: { table: { tableName: 'Sales' }, columnName: 'OrderID' }, equals: 999999 }, expected: 1 }],
      },
      model,
      datasets,
    )
    expect(result.status).toBe('error')
  })
})
