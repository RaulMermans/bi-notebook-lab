import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'
import { EMPTY_FILTER_CONTEXT } from '../../../src/runtime/measure/filterContext'
import { evaluateGroupedRows, getDistinctVisualMembers } from '../../../src/runtime/visual/grouping'
import { runBarVisual } from '../../../src/runtime/visual/visualQuery'
import { buildStarSchemaFixture } from '../context/starSchemaFixture'

const productCategory = { datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }

describe('getDistinctVisualMembers', () => {
  it('resolves distinct, deduplicated, deterministically-ordered members', () => {
    const { datasets } = buildStarSchemaFixture()
    const members = getDistinctVisualMembers(datasets, productCategory)
    expect(members?.values).toEqual(['Furniture', 'Electronics'])
    expect(members?.hasBlank).toBe(false)
  })

  it('tracks blank values separately rather than folding them into `values`', () => {
    const dataset: Dataset = {
      id: 'blanks-ds',
      name: 'Blanks',
      source: { type: 'sample', key: 'blanks' },
      tables: [
        {
          id: 'blanks-table',
          name: 'Blanks',
          columns: [{ id: 'tag', name: 'Tag', dataType: 'string', nullable: true }],
          rows: [{ Tag: 'A' }, { Tag: null }, { Tag: 'A' }, { Tag: undefined }],
          rowCount: 4,
        },
      ],
      createdAt: new Date().toISOString(),
    }
    const members = getDistinctVisualMembers({ [dataset.id]: dataset }, { datasetId: 'blanks-ds', tableId: 'blanks-table', columnId: 'tag' })
    expect(members?.values).toEqual(['A'])
    expect(members?.hasBlank).toBe(true)
  })

  it('returns undefined for a column that no longer exists', () => {
    const { datasets } = buildStarSchemaFixture()
    const members = getDistinctVisualMembers(datasets, { datasetId: 'products-ds', tableId: 'products-table', columnId: 'does-not-exist' })
    expect(members).toBeUndefined()
  })
})

describe('evaluateGroupedRows', () => {
  it('evaluates one measure per distinct member, respecting the shared notebook filter intersection', () => {
    const { model, datasets, measureId, countryColumn } = buildStarSchemaFixture()
    const members = getDistinctVisualMembers(datasets, productCategory)!
    const country = { datasetId: 'customers-ds', tableId: 'customers-table', columnId: countryColumn.id }
    const notebookContext = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }

    const rows = evaluateGroupedRows(model, datasets, productCategory, [measureId], notebookContext, members)

    const byLabel = Object.fromEntries(rows.map((r) => [r.dimensionLabel, r.measureValues[measureId]]))
    // Spain orders: 1 (Furniture,100), 3 (Furniture,50), 4 (Electronics,80)
    expect(byLabel.Furniture).toBe(150)
    expect(byLabel.Electronics).toBe(80)
  })

  it('includes an explicit (Blank) group when the dimension has blank members', () => {
    const dataset: Dataset = {
      id: 'blanks-ds',
      name: 'Blanks',
      source: { type: 'sample', key: 'blanks' },
      tables: [
        {
          id: 'blanks-table',
          name: 'Blanks',
          columns: [
            { id: 'tag', name: 'Tag', dataType: 'string', nullable: true },
            { id: 'amount', name: 'Amount', dataType: 'decimal', nullable: false },
          ],
          rows: [
            { Tag: 'A', Amount: 10 },
            { Tag: null, Amount: 5 },
          ],
          rowCount: 2,
        },
      ],
      createdAt: new Date().toISOString(),
    }
    const datasets = { [dataset.id]: dataset }
    let model = createModel('Blanks model')
    model = addTable(model, { datasetId: 'blanks-ds', tableId: 'blanks-table' })
    const tableId = model.tables[0].id
    const created = createMeasure(model, datasets, { homeModelTableId: tableId, name: 'Total', expression: 'SUM(Blanks[Amount])' })
    model = created.model

    const tagColumn = { datasetId: 'blanks-ds', tableId: 'blanks-table', columnId: 'tag' }
    const members = getDistinctVisualMembers(datasets, tagColumn)!
    const rows = evaluateGroupedRows(model, datasets, tagColumn, [created.measure!.id], EMPTY_FILTER_CONTEXT, members)

    expect(rows.map((r) => r.dimensionLabel)).toEqual(['A', '(Blank)'])
    expect(rows.find((r) => r.dimensionLabel === '(Blank)')?.measureValues[created.measure!.id]).toBe(5)
  })

  it('stops propagating through a relationship that has been made inactive', () => {
    const { model, datasets, measureId, productRelationshipId } = buildStarSchemaFixture()
    const members = getDistinctVisualMembers(datasets, productCategory)!

    const active = evaluateGroupedRows(model, datasets, productCategory, [measureId], EMPTY_FILTER_CONTEXT, members)
    const activeByLabel = Object.fromEntries(active.map((r) => [r.dimensionLabel, r.measureValues[measureId]]))
    expect(activeByLabel.Furniture).toBe(180) // orders 1,3,5

    const inactiveModel = setRelationshipActive(model, productRelationshipId, false)
    const inactive = evaluateGroupedRows(inactiveModel, datasets, productCategory, [measureId], EMPTY_FILTER_CONTEXT, members)
    const inactiveByLabel = Object.fromEntries(inactive.map((r) => [r.dimensionLabel, r.measureValues[measureId]]))
    // With the Products relationship inactive, filtering by category no longer narrows Sales at all.
    expect(inactiveByLabel.Furniture).toBe(460)
    expect(inactiveByLabel.Electronics).toBe(460)
  })
})

describe('bar chart category limit (grouped query cardinality)', () => {
  it('truncates to the configured limit and reports the total', () => {
    const dataset: Dataset = {
      id: 'many-ds',
      name: 'Many',
      source: { type: 'sample', key: 'many' },
      tables: [
        {
          id: 'many-table',
          name: 'Many',
          columns: [
            { id: 'cat', name: 'Category', dataType: 'string', nullable: false },
            { id: 'amount', name: 'Amount', dataType: 'decimal', nullable: false },
          ],
          rows: Array.from({ length: 50 }, (_, i) => ({ Category: `Cat${i}`, Amount: i + 1 })),
          rowCount: 50,
        },
      ],
      createdAt: new Date().toISOString(),
    }
    const datasets = { [dataset.id]: dataset }
    let model = createModel('Many model')
    model = addTable(model, { datasetId: 'many-ds', tableId: 'many-table' })
    const tableId = model.tables[0].id
    const created = createMeasure(model, datasets, { homeModelTableId: tableId, name: 'Total', expression: 'SUM(Many[Amount])' })
    model = created.model

    const result = runBarVisual(
      model,
      datasets,
      { id: 'v1', type: 'bar', category: { datasetId: 'many-ds', tableId: 'many-table', columnId: 'cat' }, measureId: created.measure!.id, limit: 30 },
      EMPTY_FILTER_CONTEXT,
    )

    expect(result.rows).toHaveLength(30)
    expect(result.truncated).toEqual({ shown: 30, total: 50 })
    expect(result.diagnostics[0]).toMatchObject({ code: 'VISUAL_HIGH_CARDINALITY', severity: 'info' })
    expect(result.diagnostics[0]?.message).toContain('Showing top 30 of 50')
  })
})
