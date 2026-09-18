import { describe, expect, it } from 'vitest'
import { mergeFilterContexts } from '../../../src/runtime/measure/filterContext'

const country = { datasetId: 'ds', tableId: 'customers', columnId: 'country' }
const category = { datasetId: 'ds', tableId: 'products', columnId: 'category' }

describe('mergeFilterContexts', () => {
  it('empty + empty stays empty', () => {
    const result = mergeFilterContexts({ filters: [] }, { filters: [] })
    expect(result.filters).toEqual([])
  })

  it('base + a new dimension filter appends it (different columns AND together)', () => {
    const base = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }
    const result = mergeFilterContexts(base, { filters: [{ column: category, operator: 'equals' as const, values: ['Furniture'] }] })
    expect(result.filters).toHaveLength(2)
    expect(result.filters).toContainEqual({ column: country, operator: 'equals', values: ['Spain'] })
    expect(result.filters).toContainEqual({ column: category, operator: 'equals', values: ['Furniture'] })
  })

  it('different columns always combine with AND (no interaction between them)', () => {
    const base = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }
    const additional = { filters: [{ column: category, operator: 'in' as const, values: ['Furniture', 'Beauty'] }] }
    const result = mergeFilterContexts(base, additional)
    expect(result.filters).toEqual(expect.arrayContaining([...base.filters, ...additional.filters]))
  })

  it('same-column compatible intersection collapses IN + equals to the narrower equals', () => {
    const base = { filters: [{ column: country, operator: 'in' as const, values: ['Spain', 'France'] }] }
    const additional = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }
    const result = mergeFilterContexts(base, additional)
    expect(result.filters).toEqual([{ column: country, operator: 'equals', values: ['Spain'] }])
  })

  it('same-column conflicting filters intersect to an empty (impossible) value set, not a silently-picked side', () => {
    const base = { filters: [{ column: country, operator: 'equals' as const, values: ['Spain'] }] }
    const additional = { filters: [{ column: country, operator: 'equals' as const, values: ['France'] }] }
    const result = mergeFilterContexts(base, additional)
    expect(result.filters).toEqual([{ column: country, operator: 'equals', values: [] }])
  })

  it('multi-value IN + equals narrows to the single matching value', () => {
    const base = { filters: [{ column: country, operator: 'in' as const, values: ['Spain', 'France', 'Germany'] }] }
    const additional = { filters: [{ column: country, operator: 'equals' as const, values: ['France'] }] }
    const result = mergeFilterContexts(base, additional)
    expect(result.filters).toEqual([{ column: country, operator: 'equals', values: ['France'] }])
  })

  it('blank values participate in the merge like any other value', () => {
    const base = { filters: [{ column: country, operator: 'in' as const, values: [null, 'Spain'] }] }
    const additional = { filters: [{ column: country, operator: 'equals' as const, values: [null] }] }
    const result = mergeFilterContexts(base, additional)
    expect(result.filters).toEqual([{ column: country, operator: 'equals', values: [null] }])
  })
})
