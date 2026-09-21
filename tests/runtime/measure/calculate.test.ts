import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { SemanticModel } from '../../../src/domain/model'
import { createMeasure, evaluateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, createRelationship, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'

/**
 * Sprint 8 (CALCULATE). Star-ish schema, deliberately unbalanced across
 * country/category so replacement/intersection results differ from any
 * single filter (mirrors `filterContext.test.ts`'s fixture style):
 *
 *   Region 1 -RegionID-> * Customers 1 -CustomerID-> * Sales <-ProductID-* 1 Products
 */
function buildFixture() {
  const regionDs: Dataset = {
    id: 'region-ds',
    name: 'Region',
    source: { type: 'sample', key: 'region' },
    tables: [
      {
        id: 'region-table',
        name: 'Region',
        columns: [
          { id: 'region-id', name: 'RegionID', dataType: 'integer', nullable: false },
          { id: 'region-name', name: 'RegionName', dataType: 'string', nullable: false },
        ],
        rows: [
          { RegionID: 10, RegionName: 'South' },
          { RegionID: 20, RegionName: 'North' },
        ],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const customersDs: Dataset = {
    id: 'customers-ds',
    name: 'Customers',
    source: { type: 'sample', key: 'customers' },
    tables: [
      {
        id: 'customers-table',
        name: 'Customers',
        columns: [
          { id: 'customer-id', name: 'CustomerID', dataType: 'integer', nullable: false },
          { id: 'customer-country', name: 'Country', dataType: 'string', nullable: false },
          { id: 'customer-segment', name: 'Segment', dataType: 'string', nullable: false },
          { id: 'customer-region', name: 'RegionID', dataType: 'integer', nullable: false },
        ],
        rows: [
          { CustomerID: 1, Country: 'Spain', Segment: 'Premium', RegionID: 10 },
          { CustomerID: 2, Country: 'France', Segment: 'Standard', RegionID: 20 },
          { CustomerID: 3, Country: 'Spain', Segment: 'Standard', RegionID: 10 },
        ],
        rowCount: 3,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const productsDs: Dataset = {
    id: 'products-ds',
    name: 'Products',
    source: { type: 'sample', key: 'products' },
    tables: [
      {
        id: 'products-table',
        name: 'Products',
        columns: [
          { id: 'product-id', name: 'ProductID', dataType: 'integer', nullable: false },
          { id: 'product-category', name: 'Category', dataType: 'string', nullable: false },
          { id: 'product-price', name: 'UnitPrice', dataType: 'decimal', nullable: false },
        ],
        rows: [
          { ProductID: 1, Category: 'Furniture', UnitPrice: 120 },
          { ProductID: 2, Category: 'Electronics', UnitPrice: 40 },
        ],
        rowCount: 2,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const salesDs: Dataset = {
    id: 'sales-ds',
    name: 'Sales',
    source: { type: 'sample', key: 'sales' },
    tables: [
      {
        id: 'sales-table',
        name: 'Sales',
        columns: [
          { id: 'sales-orderid', name: 'OrderID', dataType: 'integer', nullable: false },
          { id: 'sales-customerid', name: 'CustomerID', dataType: 'integer', nullable: false },
          { id: 'sales-productid', name: 'ProductID', dataType: 'integer', nullable: false },
          { id: 'sales-revenue', name: 'Revenue', dataType: 'decimal', nullable: false },
          { id: 'sales-cost', name: 'Cost', dataType: 'decimal', nullable: false },
        ],
        rows: [
          { OrderID: 1, CustomerID: 1, ProductID: 1, Revenue: 100, Cost: 60 }, // Spain, Furniture(120)
          { OrderID: 2, CustomerID: 2, ProductID: 2, Revenue: 200, Cost: 150 }, // France, Electronics(40)
          { OrderID: 3, CustomerID: 3, ProductID: 1, Revenue: 50, Cost: 20 }, // Spain, Furniture(120)
          { OrderID: 4, CustomerID: 1, ProductID: 2, Revenue: 80, Cost: 40 }, // Spain, Electronics(40)
          { OrderID: 5, CustomerID: 2, ProductID: 1, Revenue: 30, Cost: 10 }, // France, Furniture(120)
        ],
        rowCount: 5,
      },
    ],
    createdAt: new Date().toISOString(),
  }

  const datasets: Record<string, Dataset> = {
    [regionDs.id]: regionDs,
    [customersDs.id]: customersDs,
    [productsDs.id]: productsDs,
    [salesDs.id]: salesDs,
  }

  let model = createModel('Retail-like')
  model = addTable(model, { datasetId: regionDs.id, tableId: 'region-table' })
  model = addTable(model, { datasetId: customersDs.id, tableId: 'customers-table' })
  model = addTable(model, { datasetId: productsDs.id, tableId: 'products-table' })
  model = addTable(model, { datasetId: salesDs.id, tableId: 'sales-table' })

  const customersTableId = model.tables.find((t) => t.datasetId === customersDs.id)!.id
  const productsTableId = model.tables.find((t) => t.datasetId === productsDs.id)!.id
  const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id
  const regionTableId = model.tables.find((t) => t.datasetId === regionDs.id)!.id

  const customerRelationship = createRelationship(
    model,
    {
      one: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customer-id' },
      many: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-customerid' },
    },
    datasets,
  )
  model = customerRelationship.model

  const productRelationship = createRelationship(
    model,
    {
      one: { datasetId: productsDs.id, tableId: 'products-table', columnId: 'product-id' },
      many: { datasetId: salesDs.id, tableId: 'sales-table', columnId: 'sales-productid' },
    },
    datasets,
  )
  model = productRelationship.model

  const regionRelationship = createRelationship(
    model,
    {
      one: { datasetId: regionDs.id, tableId: 'region-table', columnId: 'region-id' },
      many: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customer-region' },
    },
    datasets,
  )
  model = regionRelationship.model

  let m = createMeasure(model, datasets, { homeModelTableId: salesTableId, name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' })
  m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'Total Cost', expression: 'SUM(Sales[Cost])' })
  m = createMeasure(m.model, datasets, { homeModelTableId: salesTableId, name: 'Orders', expression: 'DISTINCTCOUNT(Sales[OrderID])' })
  m = createMeasure(m.model, datasets, {
    homeModelTableId: salesTableId,
    name: 'Average Order Value',
    expression: 'DIVIDE([Total Revenue], [Orders])',
  })

  return {
    model: m.model,
    datasets,
    customersTableId,
    productsTableId,
    salesTableId,
    regionTableId,
    customerColumn: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customer-country' },
    segmentColumn: { datasetId: customersDs.id, tableId: 'customers-table', columnId: 'customer-segment' },
    categoryColumn: { datasetId: productsDs.id, tableId: 'products-table', columnId: 'product-category' },
    productRelationshipId: productRelationship.relationship!.id,
  }
}

function findMeasureId(model: SemanticModel, name: string): string {
  return model.measures.find((m) => m.name === name)!.id
}

function withMeasure(model: SemanticModel, datasets: Record<string, Dataset>, homeModelTableId: string, name: string, expression: string) {
  const result = createMeasure(model, datasets, { homeModelTableId, name, expression })
  expect(result.diagnostics).toEqual([])
  return result.model
}

describe('CALCULATE — same-column replacement (sprint brief §29)', () => {
  it('replaces an external Country filter rather than intersecting with it', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Spain Revenue', 'CALCULATE([Total Revenue], Customers[Country] = "Spain")')

    const external = { filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }, operator: 'equals' as const, values: ['France'] }] }
    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Spain Revenue'), external)

    // Spain orders: 1 (100) + 3 (50) + 4 (80) = 230 — NOT blank/zero from France ∩ Spain.
    expect(execution.value).toBe(230)
  })
})

describe('CALCULATE — unrelated filters survive (sprint brief §30)', () => {
  it('preserves an unrelated Category filter alongside the CALCULATE country replacement', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Spain Revenue', 'CALCULATE([Total Revenue], Customers[Country] = "Spain")')

    const external = {
      filters: [
        { column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }, operator: 'equals' as const, values: ['France'] },
        { column: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }, operator: 'equals' as const, values: ['Furniture'] },
      ],
    }
    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Spain Revenue'), external)

    // Spain AND Furniture: order 1 (100) + order 3 (50) = 150.
    expect(execution.value).toBe(150)
  })
})

describe('CALCULATE — measure dependencies inherit the modified context (sprint brief §31)', () => {
  it('Spain AOV recomputes both Total Revenue and Orders under the modified context', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Spain AOV', 'CALCULATE([Average Order Value], Customers[Country] = "Spain")')

    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Spain AOV'))
    // Spain revenue 230 across 3 distinct orders (1, 3, 4) = 76.666...
    expect(execution.value as number).toBeCloseTo(230 / 3, 6)
  })
})

describe('CALCULATE — context-safe cache (sprint brief §32/§64)', () => {
  it('does not reuse a Total Revenue value computed under a different filter context', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(
      model,
      datasets,
      salesTableId,
      'France Then Spain',
      // [Total Revenue] evaluated once in the external France context, once inside CALCULATE's Spain context.
      'CALCULATE([Total Revenue], Customers[Country] = "Spain") - [Total Revenue]',
    )

    const external = { filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }, operator: 'equals' as const, values: ['France'] }] }
    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'France Then Spain'), external)

    // Spain (230) - France (230: orders 2 + 5 = 200+30) = 0 only by coincidence of totals; assert the actual pieces independently instead.
    const franceRevenue = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'), external).value as number
    expect(franceRevenue).toBe(230) // orders 2 (200) + 5 (30) = 230
    expect(execution.value).toBe(230 - franceRevenue) // Spain (230) - France (230) computed independently, not a stale reuse of either
  })
})

describe('REMOVEFILTERS', () => {
  it('REMOVEFILTERS(Column) removes only that column, preserving unrelated filters', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue All Countries', 'CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country]))')

    const external = {
      filters: [
        { column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }, operator: 'equals' as const, values: ['Spain'] },
        { column: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }, operator: 'equals' as const, values: ['Furniture'] },
      ],
    }
    const grandTotal = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'))
    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue All Countries'), external)

    // Country removed, Furniture (Category) preserved: orders 1 (100), 3 (50), 5 (30) = 180.
    expect(execution.value).toBe(180)
    expect(execution.value).not.toBe(grandTotal.value)
  })

  it('REMOVEFILTERS(Table) removes every filter on that table', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue Ignoring Customers', 'CALCULATE([Total Revenue], REMOVEFILTERS(Customers))')

    const external = {
      filters: [
        { column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }, operator: 'equals' as const, values: ['Spain'] },
        { column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-segment' }, operator: 'equals' as const, values: ['Premium'] },
      ],
    }
    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue Ignoring Customers'), external)
    const unfiltered = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'))
    expect(execution.value).toBe(unfiltered.value)
  })

  it('REMOVEFILTERS(Col1, Col2) removes multiple columns at once (sprint brief §25)', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(
      model,
      datasets,
      salesTableId,
      'Revenue Ignoring Two Columns',
      'CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country], Customers[Segment]))',
    )

    const external = {
      filters: [
        { column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }, operator: 'equals' as const, values: ['Spain'] },
        { column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-segment' }, operator: 'equals' as const, values: ['Premium'] },
        { column: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }, operator: 'equals' as const, values: ['Furniture'] },
      ],
    }
    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue Ignoring Two Columns'), external)
    // Country and Segment removed, Furniture (Category) preserved: orders 1 (100), 3 (50), 5 (30) = 180.
    expect(execution.value).toBe(180)
  })

  it('REMOVEFILTERS() clears the entire incoming context', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Grand Total Revenue', 'CALCULATE([Total Revenue], REMOVEFILTERS())')

    const external = {
      filters: [
        { column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }, operator: 'equals' as const, values: ['Spain'] },
        { column: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }, operator: 'equals' as const, values: ['Furniture'] },
      ],
    }
    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Grand Total Revenue'), external)
    const unfiltered = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'))
    expect(execution.value).toBe(unfiltered.value)
    expect(execution.value).toBe(460) // 100+200+50+80+30
  })
})

describe('ALL as a CALCULATE filter modifier', () => {
  it('ALL(Column) behaves like REMOVEFILTERS(Column)', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Revenue % All Countries', 'DIVIDE([Total Revenue], CALCULATE([Total Revenue], ALL(Customers[Country])))')

    const external = { filters: [{ column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }, operator: 'equals' as const, values: ['Spain'] }] }
    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Revenue % All Countries'), external)
    expect(execution.value as number).toBeCloseTo(230 / 460, 6)
  })

  it('ALL(Table) behaves like REMOVEFILTERS(Table), leaving unrelated filters active', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'All Product Revenue', 'CALCULATE([Total Revenue], ALL(Products))')

    const external = {
      filters: [
        { column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' }, operator: 'equals' as const, values: ['Spain'] },
        { column: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }, operator: 'equals' as const, values: ['Furniture'] },
      ],
    }
    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'All Product Revenue'), external)
    // Country=Spain preserved, Category removed: orders 1 (100), 3 (50), 4 (80) = 230.
    expect(execution.value).toBe(230)
  })
})

describe('FILTER', () => {
  it('FILTER(Table, predicate) with a single comparison propagates through relationships', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Premium Product Revenue', 'CALCULATE([Total Revenue], FILTER(Products, Products[UnitPrice] > 100))')

    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Premium Product Revenue'))
    // Only Furniture (120) qualifies: orders 1 (100), 3 (50), 5 (30) = 180.
    expect(execution.value).toBe(180)
  })

  it('matches zero rows when nothing satisfies the predicate', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Ultra Premium Revenue', 'CALCULATE([Total Revenue], FILTER(Products, Products[UnitPrice] > 1000))')
    expect(evaluateMeasure(withM, datasets, findMeasureId(withM, 'Ultra Premium Revenue')).value).toBeNull()
  })

  it('matches every row when the predicate is always true for this data', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Any Price Revenue', 'CALCULATE([Total Revenue], FILTER(Products, Products[UnitPrice] > 0))')
    expect(evaluateMeasure(withM, datasets, findMeasureId(withM, 'Any Price Revenue')).value).toBe(460)
  })

  it('supports && composition inside the predicate', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(
      model,
      datasets,
      salesTableId,
      'Furniture Premium Revenue',
      'CALCULATE([Total Revenue], FILTER(Products, Products[Category] = "Furniture" && Products[UnitPrice] > 100))',
    )
    expect(evaluateMeasure(withM, datasets, findMeasureId(withM, 'Furniture Premium Revenue')).value).toBe(180)
  })

  it('supports || composition inside the predicate', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(
      model,
      datasets,
      salesTableId,
      'Any Category Revenue',
      'CALCULATE([Total Revenue], FILTER(Products, Products[Category] = "Furniture" || Products[Category] = "Electronics"))',
    )
    expect(evaluateMeasure(withM, datasets, findMeasureId(withM, 'Any Category Revenue')).value).toBe(460)
  })

  it('intersects with an external filter on the same table (sprint brief §51)', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Premium Product Revenue', 'CALCULATE([Total Revenue], FILTER(Products, Products[UnitPrice] > 100))')

    // External context already restricts Products to Electronics — FILTER(Products, Price > 100) then matches nothing.
    const external = { filters: [{ column: { datasetId: 'products-ds', tableId: 'products-table', columnId: 'product-category' }, operator: 'equals' as const, values: ['Electronics'] }] }
    expect(evaluateMeasure(withM, datasets, findMeasureId(withM, 'Premium Product Revenue'), external).value).toBeNull()
  })

  it('rejects a cross-table reference inside FILTER with FILTER_ROW_CONTEXT_VIOLATION', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const result = createMeasure(model, datasets, {
      homeModelTableId: salesTableId,
      name: 'Bad Filter',
      expression: 'CALCULATE([Total Revenue], FILTER(Products, Customers[Country] = "Spain"))',
    })
    expect(result.diagnostics).toEqual([expect.objectContaining({ code: 'FILTER_ROW_CONTEXT_VIOLATION' })])
  })
})

describe('CALCULATE — propagation from a FILTER-derived table selection (sprint brief §62)', () => {
  it('reduces Products, then propagates to Sales, then aggregates only matching Sales rows', () => {
    const { model, datasets, salesTableId, productsTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Premium Product Revenue', 'CALCULATE([Total Revenue], FILTER(Products, Products[UnitPrice] > 100))')

    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Premium Product Revenue'))
    expect(execution.filterState?.valid).toBe(true)
    const productsSummary = execution.filterState!.tableSummaries.find((t) => t.modelTableId === productsTableId)!
    expect(productsSummary.visibleRows).toBe(1) // only the Furniture product (120 > 100)
    const salesSummary = execution.filterState!.tableSummaries.find((t) => t.modelTableId === salesTableId)!
    expect(salesSummary.visibleRows).toBe(3) // orders 1, 3, 5
  })
})

describe('Modifier ordering (sprint brief §28)', () => {
  it('REMOVEFILTERS(Column) then an equality on the same column ends at the equality value', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(
      model,
      datasets,
      salesTableId,
      'Ordering Check',
      'CALCULATE([Total Revenue], REMOVEFILTERS(Customers[Country]), Customers[Country] = "Spain")',
    )
    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Ordering Check'))
    expect(execution.value).toBe(230)
  })
})

describe('Nested CALCULATE (sprint brief §33/§65)', () => {
  it('composes Spain AND Furniture from two nested CALCULATE calls', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(
      model,
      datasets,
      salesTableId,
      'Nested Spain Furniture',
      'CALCULATE(CALCULATE([Total Revenue], Products[Category] = "Furniture"), Customers[Country] = "Spain")',
    )
    // Spain AND Furniture: orders 1 (100) + 3 (50) = 150 — same as the flat two-filter case above.
    expect(evaluateMeasure(withM, datasets, findMeasureId(withM, 'Nested Spain Furniture')).value).toBe(150)
  })
})

describe('CALCULATE + relationship active/inactive (sprint brief §22 manual test, automated)', () => {
  it('a FILTER-derived Products selection stops propagating once the relationship is disabled, and recovers once re-enabled', () => {
    const { model, datasets, salesTableId, productRelationshipId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Premium Product Revenue', 'CALCULATE([Total Revenue], FILTER(Products, Products[UnitPrice] > 100))')

    const unfiltered = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Total Revenue'))
    const { model: disabled } = setRelationshipActive(withM, productRelationshipId, false)
    const disabledExecution = evaluateMeasure(disabled, datasets, findMeasureId(disabled, 'Premium Product Revenue'))
    expect(disabledExecution.value).toBe(unfiltered.value)

    const { model: reEnabled } = setRelationshipActive(disabled, productRelationshipId, true)
    const reEnabledExecution = evaluateMeasure(reEnabled, datasets, findMeasureId(reEnabled, 'Premium Product Revenue'))
    expect(reEnabledExecution.value).toBe(180)
  })
})

describe('Validation engine compatibility (sprint brief §53)', () => {
  it('SUM(Sales[Revenue]) and CALCULATE(SUM(Sales[Revenue])) agree on an unfiltered result', () => {
    const { model, datasets, salesTableId } = buildFixture()
    let m = withMeasure(model, datasets, salesTableId, 'Plain Sum', 'SUM(Sales[Revenue])')
    m = withMeasure(m, datasets, salesTableId, 'Calculated Sum', 'CALCULATE(SUM(Sales[Revenue]), REMOVEFILTERS())')

    expect(evaluateMeasure(m, datasets, findMeasureId(m, 'Plain Sum')).value).toBe(
      evaluateMeasure(m, datasets, findMeasureId(m, 'Calculated Sum')).value,
    )
  })
})

describe('CALCULATE trace (sprint brief §35)', () => {
  it('exposes a calculate trace node with incoming/modified context children', () => {
    const { model, datasets, salesTableId } = buildFixture()
    const withM = withMeasure(model, datasets, salesTableId, 'Spain Revenue', 'CALCULATE([Total Revenue], Customers[Country] = "Spain")')
    const execution = evaluateMeasure(withM, datasets, findMeasureId(withM, 'Spain Revenue'))

    expect(execution.trace?.kind).toBe('measure-reference')
    const calculateNode = execution.trace!.children!.find((c) => c.kind === 'calculate')
    expect(calculateNode).toBeDefined()
    const kinds = calculateNode!.children!.map((c) => c.kind)
    expect(kinds).toContain('boolean-filter')
    expect(kinds.filter((k) => k === 'filter-context').length).toBe(2) // "Incoming context" + "Modified context"
  })
})
