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

  it('recognizes CALCULATE, FILTER, REMOVEFILTERS and ALL for uses-function (sprint brief §54)', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const revenue = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    const spainRevenue = createMeasure(revenue.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Spain Revenue',
      expression: 'CALCULATE([Total Revenue], Customers[Country] = "Spain")',
    })
    expect(spainRevenue.diagnostics).toEqual([])

    for (const functionName of ['CALCULATE']) {
      const result = evaluateExpressionSemanticRule(
        {
          id: 's', type: 'expression-semantics', title: `Uses ${functionName}`, points: 5,
          target: { kind: 'measure', measure: { name: 'Spain Revenue' } },
          assertions: [{ kind: 'uses-function', functionName }],
        },
        spainRevenue.model,
        datasets,
      )
      expect(result.status).toBe('passed')
    }

    const filterMeasure = createMeasure(spainRevenue.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Premium Product Revenue',
      expression: 'CALCULATE([Total Revenue], FILTER(Products, Products[UnitPrice] > 100))',
    })
    expect(filterMeasure.diagnostics).toEqual([])
    const filterResult = evaluateExpressionSemanticRule(
      {
        id: 's', type: 'expression-semantics', title: 'Uses FILTER', points: 5,
        target: { kind: 'measure', measure: { name: 'Premium Product Revenue' } },
        assertions: [{ kind: 'uses-function', functionName: 'FILTER' }],
      },
      filterMeasure.model,
      datasets,
    )
    expect(filterResult.status).toBe('passed')

    const removeFiltersMeasure = createMeasure(filterMeasure.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Revenue All Countries',
      expression: 'CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country]))',
    })
    expect(removeFiltersMeasure.diagnostics).toEqual([])
    const removeFiltersResult = evaluateExpressionSemanticRule(
      {
        id: 's', type: 'expression-semantics', title: 'Uses REMOVEFILTERS', points: 5,
        target: { kind: 'measure', measure: { name: 'Revenue All Countries' } },
        assertions: [{ kind: 'uses-function', functionName: 'REMOVEFILTERS' }],
      },
      removeFiltersMeasure.model,
      datasets,
    )
    expect(removeFiltersResult.status).toBe('passed')

    const allMeasure = createMeasure(removeFiltersMeasure.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'All Product Revenue',
      expression: 'CALCULATE([Total Revenue], ALL(Products))',
    })
    expect(allMeasure.diagnostics).toEqual([])
    const allResult = evaluateExpressionSemanticRule(
      {
        id: 's', type: 'expression-semantics', title: 'Uses ALL', points: 5,
        target: { kind: 'measure', measure: { name: 'All Product Revenue' } },
        assertions: [{ kind: 'uses-function', functionName: 'ALL' }],
      },
      allMeasure.model,
      datasets,
    )
    expect(allResult.status).toBe('passed')
  })

  it('recognizes SUMX, SELECTEDVALUE and IF for uses-function — new Sprint 9 functions need no validation-engine changes (sprint brief §54)', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const grossMargin = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Gross Margin X',
      expression: 'SUMX(Sales, Sales[Revenue] - Sales[Cost])',
    })
    expect(grossMargin.diagnostics).toEqual([])
    const sumxResult = evaluateExpressionSemanticRule(
      {
        id: 's', type: 'expression-semantics', title: 'Uses SUMX', points: 5,
        target: { kind: 'measure', measure: { name: 'Gross Margin X' } },
        assertions: [{ kind: 'uses-function', functionName: 'SUMX' }],
      },
      grossMargin.model,
      datasets,
    )
    expect(sumxResult.status).toBe('passed')

    const revenueStatus = createMeasure(grossMargin.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Revenue Status',
      expression: 'IF([Gross Margin X] >= 0, "Profitable", "Loss")',
    })
    expect(revenueStatus.diagnostics).toEqual([])
    const ifResult = evaluateExpressionSemanticRule(
      {
        id: 's', type: 'expression-semantics', title: 'Uses IF', points: 5,
        target: { kind: 'measure', measure: { name: 'Revenue Status' } },
        assertions: [{ kind: 'uses-function', functionName: 'IF' }],
      },
      revenueStatus.model,
      datasets,
    )
    expect(ifResult.status).toBe('passed')
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
