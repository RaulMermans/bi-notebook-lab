import { describe, expect, it } from 'vitest'
import { createCalculatedColumn } from '../../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { evaluateExpressionSemanticRule } from '../../../src/runtime/validation/semanticValidation'
import { buildRetailModel } from './helpers'

describe('semanticValidation', () => {
  it('passes uses-function when the measure uses the requested function', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const revenue = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    const orders = createMeasure(revenue.model, datasets, { homeModelTableId: salesTableId, name: 'Orders', expression: 'DISTINCTCOUNT(Sales[OrderID])' })
    const aov = createMeasure(orders.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Average Order Value',
      expression: 'DIVIDE([Total Revenue], [Orders])',
    })
    expect(aov.diagnostics).toEqual([])

    const result = evaluateExpressionSemanticRule(
      {
        id: 's', type: 'expression-semantics', title: 'Uses DIVIDE', points: 5,
        target: { kind: 'measure', measure: { name: 'Average Order Value' } },
        assertions: [{ kind: 'uses-function', functionName: 'DIVIDE' }],
      },
      aov.model,
      datasets,
    )
    expect(result.status).toBe('passed')
  })

  it('fails uses-function when the requested function is missing', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const revenue = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })

    const result = evaluateExpressionSemanticRule(
      {
        id: 's', type: 'expression-semantics', title: 'Uses DIVIDE', points: 5,
        target: { kind: 'measure', measure: { name: 'Total Revenue' } },
        assertions: [{ kind: 'uses-function', functionName: 'DIVIDE' }],
      },
      revenue.model,
      datasets,
    )
    expect(result.status).toBe('failed')
  })

  it('passes references-measure when the expression references the named measure', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const revenue = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    const doubled = createMeasure(revenue.model, datasets, { homeModelTableId: salesTableId, name: 'Doubled Revenue', expression: '[Total Revenue] * 2' })
    expect(doubled.diagnostics).toEqual([])

    const result = evaluateExpressionSemanticRule(
      {
        id: 's', type: 'expression-semantics', title: 'References Total Revenue', points: 5,
        target: { kind: 'measure', measure: { name: 'Doubled Revenue' } },
        assertions: [{ kind: 'references-measure', measureName: 'Total Revenue' }],
      },
      doubled.model,
      datasets,
    )
    expect(result.status).toBe('passed')
  })

  it('passes references-column for a calculated column that reads the expected physical column', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const margin = createCalculatedColumn(model, datasets, { modelTableId: salesTableId, name: 'Margin', expression: 'Sales[Revenue] - Sales[Cost]' })
    expect(margin.diagnostics).toEqual([])

    const result = evaluateExpressionSemanticRule(
      {
        id: 's', type: 'expression-semantics', title: 'Reads Cost', points: 5,
        target: { kind: 'calculated-column', column: { table: { tableName: 'Sales' }, name: 'Margin' } },
        assertions: [{ kind: 'references-column', column: { table: { tableName: 'Sales' }, columnName: 'Cost' } }],
      },
      margin.model,
      datasets,
    )
    expect(result.status).toBe('passed')
  })

  it('rejects a constant-only expression when not-constant-only is requested', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const hardcoded = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: '5264832.18' })
    expect(hardcoded.diagnostics).toEqual([])

    const result = evaluateExpressionSemanticRule(
      {
        id: 's', type: 'expression-semantics', title: 'Not hardcoded', points: 5,
        target: { kind: 'measure', measure: { name: 'Total Revenue' } },
        assertions: [{ kind: 'not-constant-only' }],
      },
      hardcoded.model,
      datasets,
    )
    expect(result.status).toBe('failed')
  })

  it('passes not-constant-only for a real aggregation', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const revenue = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })

    const result = evaluateExpressionSemanticRule(
      {
        id: 's', type: 'expression-semantics', title: 'Not hardcoded', points: 5,
        target: { kind: 'measure', measure: { name: 'Total Revenue' } },
        assertions: [{ kind: 'not-constant-only' }],
      },
      revenue.model,
      datasets,
    )
    expect(result.status).toBe('passed')
  })
})
