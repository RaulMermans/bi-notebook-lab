import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../src/domain/data'
import type { SemanticModel } from '../../src/domain/model'
import { bind } from '../../src/expression/binder'
import { bindMeasureExpression } from '../../src/expression/measureBinder'
import { evaluateBoundExpressionOverTable } from '../../src/expression/evaluator'
import { evaluateMeasure } from '../../src/runtime/measure/measureRuntime'
import { createMeasure } from '../../src/runtime/measure/measureRuntime'
import { parseExpression } from '../../src/expression/parser'
import { addTable, createModel } from '../../src/runtime/model/modelRuntime'

function salesDataset(): Dataset {
  return {
    id: 'sales-ds',
    name: 'Sales',
    source: { type: 'sample', key: 'sales' },
    tables: [
      {
        id: 'sales-table',
        name: 'Sales',
        columns: [
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: true },
          { id: 'sales-cost', name: 'Cost', dataType: 'decimal', nullable: true },
          { id: 'sales-country', name: 'Country', dataType: 'string', nullable: true },
        ],
        rows: [
          { Revenue: 120, Cost: 80, Country: 'Spain' },
          { Revenue: 200, Cost: 150, Country: 'France' },
        ],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function baseModel(): { model: SemanticModel; datasets: Record<string, Dataset>; salesTableId: string } {
  const sales = salesDataset()
  let model = createModel()
  model = addTable(model, { datasetId: sales.id, tableId: 'sales-table' })
  const salesTableId = model.tables[0].id
  return { model, datasets: { [sales.id]: sales }, salesTableId }
}

describe('VAR/RETURN — parser', () => {
  it('parses a single VAR declaration', () => {
    const result = parseExpression('VAR x = 1 RETURN x')
    expect(result.diagnostics).toEqual([])
    expect(result.expression).toMatchObject({ kind: 'VarReturn', variables: [{ name: 'x' }] })
  })

  it('parses multiple VAR declarations and multiline syntax', () => {
    const result = parseExpression('VAR x = 1\nVAR y = 2\nRETURN x + y')
    expect(result.diagnostics).toEqual([])
    expect(result.expression).toMatchObject({ kind: 'VarReturn', variables: [{ name: 'x' }, { name: 'y' }] })
  })

  it('nests inside a function argument', () => {
    const result = parseExpression('DIVIDE(VAR x = 10 RETURN x, 2)')
    expect(result.diagnostics).toEqual([])
  })

  it('fails clearly when RETURN is missing', () => {
    const result = parseExpression('VAR x = 1\nx')
    expect(result.diagnostics[0]).toMatchObject({ code: 'SYNTAX_ERROR' })
    expect(result.diagnostics[0].message).toContain('Expected RETURN')
  })
})

describe('VAR/RETURN — calculated columns', () => {
  it('binds and evaluates a single variable', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('VAR Margin = Sales[Revenue] - Sales[Cost] RETURN Margin')
    const bound = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })
    expect(bound.diagnostics).toEqual([])

    const result = evaluateBoundExpressionOverTable(bound.bound!, model, datasets, salesTableId)
    expect(result.values).toEqual([40, 50])
  })

  it('a later variable may reference an earlier one', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('VAR Revenue = Sales[Revenue] VAR Cost = Sales[Cost] VAR Margin = Revenue - Cost RETURN Margin')
    const bound = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })
    expect(bound.diagnostics).toEqual([])
    const result = evaluateBoundExpressionOverTable(bound.bound!, model, datasets, salesTableId)
    expect(result.values).toEqual([40, 50])
  })

  it('variable names are case-insensitive on reference', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('VAR Revenue = Sales[Revenue] RETURN revenue')
    const bound = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })
    expect(bound.diagnostics).toEqual([])
    const result = evaluateBoundExpressionOverTable(bound.bound!, model, datasets, salesTableId)
    expect(result.values).toEqual([120, 200])
  })

  it('rejects a duplicate variable name', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('VAR x = 1 VAR x = 2 RETURN x')
    const bound = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })
    expect(bound.diagnostics).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_VARIABLE' }))
  })

  it('rejects an unknown variable reference', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('VAR x = 1 RETURN y')
    const bound = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })
    expect(bound.diagnostics).toContainEqual(expect.objectContaining({ code: 'UNKNOWN_VARIABLE' }))
  })

  it('rejects a forward reference to a later variable', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('VAR A = B + 1 VAR B = 10 RETURN A')
    const bound = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })
    expect(bound.diagnostics).toContainEqual(expect.objectContaining({ code: 'FORWARD_VARIABLE_REFERENCE' }))
  })

  it('rejects a self-reference', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('VAR x = x + 1 RETURN x')
    const bound = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })
    expect(bound.diagnostics).toContainEqual(expect.objectContaining({ code: 'FORWARD_VARIABLE_REFERENCE' }))
  })

  it('rejects a table-valued variable', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('VAR t = Sales RETURN t')
    const bound = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })
    expect(bound.diagnostics.some((d) => d.code === 'TABLE_VARIABLE_NOT_SUPPORTED' || d.code === 'UNKNOWN_VARIABLE')).toBe(true)
  })

  it('a variable holding BLANK stays BLANK through the RETURN', () => {
    const dataset: Dataset = {
      id: 'sales-ds',
      name: 'Sales',
      source: { type: 'sample', key: 'sales' },
      tables: [
        {
          id: 'sales-table',
          name: 'Sales',
          columns: [{ id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: true }],
          rows: [{ Revenue: null }],
          rowCount: 1,
        },
      ],
      createdAt: new Date().toISOString(),
    }
    let model = createModel()
    model = addTable(model, { datasetId: dataset.id, tableId: 'sales-table' })
    const salesTableId = model.tables[0].id
    const datasets = { [dataset.id]: dataset }

    const parsed = parseExpression('VAR x = Sales[Revenue] RETURN x')
    const bound = bind(parsed.expression!, { model, datasets, currentModelTableId: salesTableId })
    expect(bound.diagnostics).toEqual([])
    const result = evaluateBoundExpressionOverTable(bound.bound!, model, datasets, salesTableId)
    expect(result.values).toEqual([null])
  })
})

describe('VAR/RETURN — measures', () => {
  it('binds and evaluates a single variable referencing a column via aggregation', () => {
    const { model, datasets, salesTableId } = baseModel()
    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    const withMeasure = m.model
    const parsed = parseExpression('VAR Revenue = [Total Revenue] RETURN Revenue')
    const bound = bindMeasureExpression(parsed.expression!, { model: withMeasure, datasets })
    expect(bound.diagnostics).toEqual([])
  })

  it('evaluates a Gross Margin %-style measure end to end', () => {
    const { model, datasets, salesTableId } = baseModel()
    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    let current = m.model
    m = createMeasure(current, datasets, { homeModelTableId: salesTableId, name: 'Total Cost', expression: 'SUM(Sales[Cost])' })
    current = m.model
    m = createMeasure(current, datasets, {
      homeModelTableId: salesTableId,
      name: 'Gross Margin %',
      expression: 'VAR Revenue = [Total Revenue]\nVAR Cost = [Total Cost]\nVAR Margin = Revenue - Cost\nRETURN DIVIDE(Margin, Revenue)',
    })
    expect(m.diagnostics).toEqual([])
    current = m.model

    const execution = evaluateMeasure(current, datasets, m.measure!.id)
    expect(execution.diagnostics).toEqual([])
    // Revenue 320, Cost 230, Margin 90, 90/320 = 0.28125
    expect(execution.value).toBeCloseTo(0.28125)
  })

  it('a variable is evaluated once even when referenced twice', () => {
    const { model, datasets, salesTableId } = baseModel()
    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    let current = m.model
    m = createMeasure(current, datasets, {
      homeModelTableId: salesTableId,
      name: 'Double Revenue',
      expression: 'VAR Revenue = [Total Revenue] RETURN Revenue + Revenue',
    })
    expect(m.diagnostics).toEqual([])
    current = m.model
    const execution = evaluateMeasure(current, datasets, m.measure!.id)
    expect(execution.value).toBe(640)
    // Trace should show exactly one 'variable-declaration' node computing [Total Revenue] once.
    const declarationNodes = JSON.stringify(execution.trace).match(/"variable-declaration"/g) ?? []
    expect(declarationNodes).toHaveLength(1)
  })

  it('rejects a duplicate variable name in a measure', () => {
    const { model, datasets, salesTableId } = baseModel()
    const parsed = parseExpression('VAR x = 1 VAR x = 2 RETURN x')
    const bound = bindMeasureExpression(parsed.expression!, { model, datasets })
    void salesTableId
    expect(bound.diagnostics).toContainEqual(expect.objectContaining({ code: 'DUPLICATE_VARIABLE' }))
  })

  it('a VAR declared outside a nested CALCULATE is immune to the inner filter context', () => {
    const { model, datasets, salesTableId } = baseModel()
    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    let current = m.model
    m = createMeasure(current, datasets, {
      homeModelTableId: salesTableId,
      name: 'Outer Vs Spain',
      expression: 'VAR Outer = [Total Revenue] RETURN CALCULATE(Outer, Sales[Country] = "Spain")',
    })
    expect(m.diagnostics).toEqual([])
    current = m.model

    const execution = evaluateMeasure(current, datasets, m.measure!.id)
    expect(execution.diagnostics).toEqual([])
    // Outer captured [Total Revenue] under the unfiltered context (320), not
    // re-evaluated under the inner Spain-only CALCULATE context (120).
    expect(execution.value).toBe(320)
  })
})
