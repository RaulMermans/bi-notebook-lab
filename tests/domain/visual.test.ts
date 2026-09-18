import { describe, expect, it } from 'vitest'
import type {
  BarVisualSpec,
  KpiVisualSpec,
  LineVisualSpec,
  SlicerVisualSpec,
  TableVisualSpec,
  VisualSpec,
} from '../../src/domain/visual'
import type { NotebookCell, VisualCell } from '../../src/domain/notebook'

const column = { datasetId: 'ds', tableId: 'table', columnId: 'col' }

describe('VisualSpec contracts', () => {
  it('accepts a valid KpiVisualSpec', () => {
    const spec: KpiVisualSpec = { id: 'v1', type: 'kpi', measureId: 'measure-1', title: 'Total Revenue' }
    expect(spec.type).toBe('kpi')
  })

  it('accepts a valid BarVisualSpec', () => {
    const spec: BarVisualSpec = { id: 'v2', type: 'bar', category: column, measureId: 'measure-1', sort: 'value-desc', limit: 30 }
    expect(spec.category).toEqual(column)
  })

  it('accepts a valid LineVisualSpec', () => {
    const spec: LineVisualSpec = { id: 'v3', type: 'line', axis: column, measureId: 'measure-1', sort: 'axis-asc' }
    expect(spec.axis).toEqual(column)
  })

  it('accepts a valid TableVisualSpec with and without a dimension', () => {
    const withDimension: TableVisualSpec = { id: 'v4', type: 'table', dimension: column, measureIds: ['m1', 'm2'] }
    const withoutDimension: TableVisualSpec = { id: 'v5', type: 'table', measureIds: ['m1'] }
    expect(withDimension.dimension).toEqual(column)
    expect(withoutDimension.dimension).toBeUndefined()
  })

  it('accepts a valid SlicerVisualSpec', () => {
    const spec: SlicerVisualSpec = { id: 'v6', type: 'slicer', column, mode: 'multi' }
    expect(spec.mode).toBe('multi')
  })

  it('discriminates every VisualSpec member by `type`', () => {
    const specs: VisualSpec[] = [
      { id: '1', type: 'kpi', measureId: 'm' },
      { id: '2', type: 'bar', category: column, measureId: 'm' },
      { id: '3', type: 'line', axis: column, measureId: 'm' },
      { id: '4', type: 'table', measureIds: ['m'] },
      { id: '5', type: 'slicer', column },
    ]
    for (const spec of specs) {
      if (spec.type === 'kpi') expect(spec.measureId).toBeDefined()
      if (spec.type === 'bar') expect(spec.category).toBeDefined()
      if (spec.type === 'line') expect(spec.axis).toBeDefined()
      if (spec.type === 'table') expect(spec.measureIds).toBeDefined()
      if (spec.type === 'slicer') expect(spec.column).toBeDefined()
    }
  })
})

describe('VisualCell discrimination', () => {
  it('is a distinct NotebookCell kind carrying modelId + visual', () => {
    const cell: VisualCell = {
      id: 'cell-1',
      kind: 'visual',
      title: 'Total Revenue',
      modelId: 'model-1',
      visual: { id: 'v1', type: 'kpi', measureId: 'measure-1' },
    }
    const cells: NotebookCell[] = [cell]
    const found = cells.find((c) => c.kind === 'visual')
    expect(found).toBeDefined()
    if (found?.kind === 'visual') {
      expect(found.visual.type).toBe('kpi')
      expect(found.modelId).toBe('model-1')
    }
  })
})
