import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { EMPTY_FILTER_CONTEXT } from '../../../src/runtime/measure/filterContext'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel } from '../../../src/runtime/model/modelRuntime'
import { runLineVisual } from '../../../src/runtime/visual/visualQuery'

function buildDailySalesFixture() {
  const dataset: Dataset = {
    id: 'sales-ds',
    name: 'Sales',
    source: { type: 'sample', key: 'sales' },
    tables: [
      {
        id: 'sales-table',
        name: 'Sales',
        columns: [
          { id: 'order-date', name: 'OrderDate', dataType: 'date', nullable: false },
          { id: 'revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
          { id: 'country', name: 'Country', dataType: 'string', nullable: false },
        ],
        // Deliberately out of chronological (and insertion) order.
        rows: [
          { OrderDate: '2024-01-03', Revenue: 30, Country: 'Spain' },
          { OrderDate: '2024-01-01', Revenue: 100, Country: 'Spain' },
          { OrderDate: '2024-01-02', Revenue: 50, Country: 'France' },
        ],
        rowCount: 3,
      },
    ],
    createdAt: new Date().toISOString(),
  }
  const datasets = { [dataset.id]: dataset }
  let model = createModel('Daily sales')
  model = addTable(model, { datasetId: 'sales-ds', tableId: 'sales-table' })
  const tableId = model.tables[0].id
  const created = createMeasure(model, datasets, { homeModelTableId: tableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
  model = created.model

  return { model, datasets, measureId: created.measure!.id }
}

const axis = { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'order-date' }

describe('runLineVisual', () => {
  it('sorts date members chronologically, not by insertion order', () => {
    const { model, datasets, measureId } = buildDailySalesFixture()
    const result = runLineVisual(model, datasets, { id: 'v1', type: 'line', axis, measureId }, EMPTY_FILTER_CONTEXT)
    expect(result.status).toBe('success')
    expect(result.rows.map((r) => r.dimensionLabel)).toEqual(['2024-01-01', '2024-01-02', '2024-01-03'])
  })

  it('computes the correct measure value per date', () => {
    const { model, datasets, measureId } = buildDailySalesFixture()
    const result = runLineVisual(model, datasets, { id: 'v1', type: 'line', axis, measureId }, EMPTY_FILTER_CONTEXT)
    const byDate = Object.fromEntries(result.rows.map((r) => [r.dimensionLabel, r.measureValues[measureId]]))
    expect(byDate['2024-01-01']).toBe(100)
    expect(byDate['2024-01-02']).toBe(50)
    expect(byDate['2024-01-03']).toBe(30)
  })

  it('respects the shared notebook filter context', () => {
    // Every distinct date still appears as an axis point (a real axis, like Power BI's) — but
    // 2024-01-02 (a France-only order) evaluates to blank once Country = Spain is applied.
    const { model, datasets, measureId } = buildDailySalesFixture()
    const country = { datasetId: 'sales-ds', tableId: 'sales-table', columnId: 'country' }
    const context = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }
    const result = runLineVisual(model, datasets, { id: 'v1', type: 'line', axis, measureId }, context)
    const byDate = Object.fromEntries(result.rows.map((r) => [r.dimensionLabel, r.measureValues[measureId]]))
    expect(byDate['2024-01-01']).toBe(100)
    expect(byDate['2024-01-02']).toBeNull()
    expect(byDate['2024-01-03']).toBe(30)
  })

  it('handles the axis point limit', () => {
    const dataset: Dataset = {
      id: 'many-days-ds',
      name: 'ManyDays',
      source: { type: 'sample', key: 'many-days' },
      tables: [
        {
          id: 'many-days-table',
          name: 'ManyDays',
          columns: [
            { id: 'd', name: 'Day', dataType: 'date', nullable: false },
            { id: 'amount', name: 'Amount', dataType: 'decimal', nullable: false },
          ],
          rows: Array.from({ length: 150 }, (_, i) => ({ Day: `2024-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`, Amount: 1 })),
          rowCount: 150,
        },
      ],
      createdAt: new Date().toISOString(),
    }
    const datasets = { [dataset.id]: dataset }
    let model = createModel('Many days')
    model = addTable(model, { datasetId: 'many-days-ds', tableId: 'many-days-table' })
    const tableId = model.tables[0].id
    const created = createMeasure(model, datasets, { homeModelTableId: tableId, name: 'Total', expression: 'SUM(ManyDays[Amount])' })
    model = created.model

    const result = runLineVisual(
      model,
      datasets,
      { id: 'v1', type: 'line', axis: { datasetId: 'many-days-ds', tableId: 'many-days-table', columnId: 'd' }, measureId: created.measure!.id },
      EMPTY_FILTER_CONTEXT,
    )
    expect(result.rows).toHaveLength(100)
    expect(result.truncated).toEqual({ shown: 100, total: 150 })
  })

  it('shows an empty state when there are no points', () => {
    const dataset: Dataset = {
      id: 'empty-ds',
      name: 'Empty',
      source: { type: 'sample', key: 'empty' },
      tables: [
        {
          id: 'empty-table',
          name: 'Empty',
          columns: [
            { id: 'd', name: 'Day', dataType: 'date', nullable: false },
            { id: 'amount', name: 'Amount', dataType: 'decimal', nullable: false },
          ],
          rows: [],
          rowCount: 0,
        },
      ],
      createdAt: new Date().toISOString(),
    }
    const datasets = { [dataset.id]: dataset }
    let model = createModel('Empty')
    model = addTable(model, { datasetId: 'empty-ds', tableId: 'empty-table' })
    const tableId = model.tables[0].id
    const created = createMeasure(model, datasets, { homeModelTableId: tableId, name: 'Total', expression: 'SUM(Empty[Amount])' })
    model = created.model

    const result = runLineVisual(
      model,
      datasets,
      { id: 'v1', type: 'line', axis: { datasetId: 'empty-ds', tableId: 'empty-table', columnId: 'd' }, measureId: created.measure!.id },
      EMPTY_FILTER_CONTEXT,
    )
    expect(result.status).toBe('success')
    expect(result.rows).toEqual([])
  })
})
