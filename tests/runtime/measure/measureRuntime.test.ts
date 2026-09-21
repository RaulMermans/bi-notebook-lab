import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { Relationship } from '../../../src/domain/model'
import {
  createMeasure,
  evaluateMeasure,
  removeMeasure,
  updateMeasure,
} from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel } from '../../../src/runtime/model/modelRuntime'

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
          { id: 'sales-orderid', name: 'OrderID', dataType: 'integer', nullable: false },
          { id: 'sales-productid', name: 'ProductID', dataType: 'integer', nullable: false },
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
          { id: 'sales-cost', name: 'Cost', dataType: 'decimal', nullable: false },
        ],
        rows: [
          { OrderID: 1, ProductID: 1, Revenue: 120, Cost: 80 },
          { OrderID: 2, ProductID: 1, Revenue: 50, Cost: 30 },
        ],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function productsDataset(): Dataset {
  return {
    id: 'products-ds',
    name: 'Products',
    source: { type: 'sample', key: 'products' },
    tables: [
      {
        id: 'products-table',
        name: 'Products',
        columns: [{ id: 'products-id', name: 'ProductID', dataType: 'integer', nullable: false }],
        rows: [{ ProductID: 1 }],
        rowCount: 1,
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

function relationship(): Relationship {
  return {
    id: 'rel-1',
    left: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'products-id' },
    right: { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'sales-productid' },
    cardinality: 'one-to-many',
    oneSide: 'left',
    crossFilterDirection: 'left-to-right',
    active: true,
    createdAt: new Date().toISOString(),
  }
}

function setUp() {
  const sales = salesDataset()
  const products = productsDataset()
  let model = createModel()
  model = addTable(model, { datasetId: sales.id, tableId: 'sales-table' })
  model = addTable(model, { datasetId: products.id, tableId: 'products-table' })
  const salesTableId = model.tables.find((t) => t.datasetId === sales.id)!.id
  const productsTableId = model.tables.find((t) => t.datasetId === products.id)!.id
  const datasets = { [sales.id]: sales, [products.id]: products }
  return { model, datasets, salesTableId, productsTableId }
}

describe('createMeasure', () => {
  it('creates Total Revenue = SUM(Sales[Revenue]) and evaluates it unfiltered', () => {
    const { model, datasets, salesTableId } = setUp()

    const result = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue])',
    })

    expect(result.diagnostics).toEqual([])
    expect(result.measure).toMatchObject({ name: 'Total Revenue', dataType: 'integer' })
    expect(result.execution?.value).toBe(170)
    expect(result.model.measures).toHaveLength(1)
  })

  it('rejects a duplicate measure name case-insensitively', () => {
    const { model, datasets, salesTableId } = setUp()
    const first = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue])',
    })

    const second = createMeasure(first.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'total revenue',
      expression: 'SUM(Sales[Cost])',
    })

    expect(second.diagnostics).toEqual([expect.objectContaining({ code: 'DUPLICATE_MEASURE' })])
    expect(second.model.measures).toHaveLength(1)
  })

  it('rejects a measure name that collides with a physical column on its home table', () => {
    const { model, datasets, salesTableId } = setUp()

    const result = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Revenue',
      expression: 'SUM(Sales[Revenue])',
    })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'DUPLICATE_MEASURE' })])
    expect(result.model.measures).toHaveLength(0)
  })

  it('never stores a definition for a syntax-invalid expression', () => {
    const { model, datasets, salesTableId } = setUp()

    const result = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue]',
    })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'SYNTAX_ERROR' })])
    expect(result.model).toBe(model)
  })

  it('rejects a direct self-reference as a dependency cycle', () => {
    const { model, datasets, salesTableId } = setUp()

    const result = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Revenue Plus One',
      expression: '[Revenue Plus One] + 1',
    })

    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'MEASURE_DEPENDENCY_CYCLE' })])
    expect(result.model.measures).toHaveLength(0)
  })
})

describe('measure dependencies', () => {
  it('resolves a measure that references another measure', () => {
    const { model, datasets, salesTableId } = setUp()
    const revenue = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue])',
    })
    const cost = createMeasure(revenue.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Cost',
      expression: 'SUM(Sales[Cost])',
    })
    const margin = createMeasure(cost.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Gross Margin',
      expression: '[Total Revenue] - [Total Cost]',
    })

    expect(margin.diagnostics).toEqual([])
    expect(margin.execution?.value).toBe(60) // 170 - 110
  })

  it('resolves nested dependencies through DIVIDE', () => {
    const { model, datasets, salesTableId } = setUp()
    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
    m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'Total Cost', expression: 'SUM(Sales[Cost])' })
    m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'Gross Margin', expression: '[Total Revenue] - [Total Cost]' })
    m = createMeasure(m.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Gross Margin %',
      expression: 'DIVIDE([Gross Margin], [Total Revenue])',
    })

    expect(m.diagnostics).toEqual([])
    expect(m.execution?.value).toBeCloseTo(60 / 170, 6)
  })

  it('evaluates a shared dependency once and reuses it for a diamond-shaped graph', () => {
    const { model, datasets, salesTableId } = setUp()
    let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Base', expression: 'SUM(Sales[Revenue])' })
    m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'DoubleBase', expression: '[Base] * 2' })
    m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'TripleBase', expression: '[Base] * 3' })
    const diamond = createMeasure(m.model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Diamond',
      expression: '[DoubleBase] + [TripleBase]',
    })

    expect(diamond.diagnostics).toEqual([])
    expect(diamond.execution?.value).toBe(170 * 2 + 170 * 3)
  })

  it('rejects an indirect dependency cycle introduced by an update', () => {
    const { model, datasets, salesTableId } = setUp()
    const a = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'A', expression: 'SUM(Sales[Revenue])' })
    const b = createMeasure(a.model, datasets, { homeModelTableId: salesTableId, name: 'B', expression: '[A] + 1' })

    // Introduce A -> B -> A.
    const cyclic = updateMeasure(b.model, datasets, a.measure!.id, { expression: '[B] + 1' })

    expect(cyclic.diagnostics).toEqual([expect.objectContaining({ code: 'MEASURE_DEPENDENCY_CYCLE' })])
    expect(cyclic.model.measures.find((measure) => measure.id === a.measure!.id)?.expression).toBe('SUM(Sales[Revenue])')
  })
})

describe('measures aggregate calculated columns', () => {
  it('SUM(Sales[Margin]) uses the Sprint 3 calculated-column values', () => {
    const { model, datasets, salesTableId } = setUp()
    const withCalcColumn = {
      ...model,
      calculatedColumns: [
        {
          id: 'calc-margin',
          modelTableId: salesTableId,
          name: 'Margin',
          expression: 'Sales[Revenue] - Sales[Cost]',
          dataType: 'decimal' as const,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    }

    const result = createMeasure(withCalcColumn, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Margin',
      expression: 'SUM(Sales[Margin])',
    })

    expect(result.diagnostics).toEqual([])
    expect(result.execution?.value).toBe(60) // (120-80) + (50-30)
  })
})

describe('updateMeasure', () => {
  it('renames a measure and updates its cell-facing name', () => {
    const { model, datasets, salesTableId } = setUp()
    const created = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue])',
    })

    const updated = updateMeasure(created.model, datasets, created.measure!.id, { name: 'Revenue Total' })

    expect(updated.diagnostics).toEqual([])
    expect(updated.model.measures[0].name).toBe('Revenue Total')
  })

  it('allows renaming to the same name without flagging a self-conflict', () => {
    const { model, datasets, salesTableId } = setUp()
    const created = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue])',
    })

    const updated = updateMeasure(created.model, datasets, created.measure!.id, { name: 'Total Revenue' })

    expect(updated.diagnostics).toEqual([])
  })
})

describe('removeMeasure', () => {
  it('removes the definition from the model', () => {
    const { model, datasets, salesTableId } = setUp()
    const created = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue])',
    })

    const result = removeMeasure(created.model, created.measure!.id)

    expect(result.measures).toHaveLength(0)
  })
})

describe('evaluateMeasure', () => {
  it('recomputes a persisted definition from scratch', () => {
    const { model, datasets, salesTableId } = setUp()
    const created = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Total Revenue',
      expression: 'SUM(Sales[Revenue])',
    })

    const execution = evaluateMeasure(created.model, datasets, created.measure!.id)

    expect(execution.value).toBe(170)
    expect(execution.diagnostics).toEqual([])
  })
})
