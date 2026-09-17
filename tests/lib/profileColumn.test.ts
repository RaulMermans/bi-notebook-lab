import { describe, expect, it } from 'vitest'
import type { DataColumn, DataType } from '../../src/domain/data'
import { profileColumn } from '../../src/lib/profiling/profileColumn'

function column(name: string, dataType: DataType): DataColumn {
  return { id: name, name, dataType, nullable: true }
}

describe('profileColumn', () => {
  it('counts nulls and distinct values', () => {
    const rows = [{ Country: 'US' }, { Country: 'US' }, { Country: null }, { Country: 'CA' }]
    const profile = profileColumn(column('Country', 'string'), rows)

    expect(profile.rowCount).toBe(4)
    expect(profile.nullCount).toBe(1)
    expect(profile.nullPercentage).toBe(25)
    expect(profile.distinctCount).toBe(2)
    expect(profile.distinctPercentage).toBe(50)
  })

  it('computes min, max and mean for numeric columns', () => {
    const rows = [{ Revenue: 10 }, { Revenue: 20 }, { Revenue: 30 }]
    const profile = profileColumn(column('Revenue', 'decimal'), rows)

    expect(profile.min).toBe(10)
    expect(profile.max).toBe(30)
    expect(profile.mean).toBe(20)
  })

  it('computes shortest and longest length for string columns', () => {
    const rows = [{ Name: 'Al' }, { Name: 'Alexandra' }]
    const profile = profileColumn(column('Name', 'string'), rows)

    expect(profile.minLength).toBe(2)
    expect(profile.maxLength).toBe(9)
  })

  it('marks a fully unique, non-null column as a potential key', () => {
    const rows = [{ OrderID: 1 }, { OrderID: 2 }, { OrderID: 3 }]
    const profile = profileColumn(column('OrderID', 'integer'), rows)

    expect(profile.isPotentialKey).toBe(true)
  })

  it('does not mark a column with duplicates as a potential key', () => {
    const rows = [{ CustomerID: 1 }, { CustomerID: 1 }]
    const profile = profileColumn(column('CustomerID', 'integer'), rows)

    expect(profile.isPotentialKey).toBe(false)
  })

  it('does not mark a column with nulls as a potential key even if otherwise unique', () => {
    const rows = [{ CustomerID: 1 }, { CustomerID: null }]
    const profile = profileColumn(column('CustomerID', 'integer'), rows)

    expect(profile.isPotentialKey).toBe(false)
  })
})
