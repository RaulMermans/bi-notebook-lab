import type { DataColumn } from '../../domain/data'
import type { ColumnProfile } from './types'

function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export function profileColumn(column: DataColumn, rows: Record<string, unknown>[]): ColumnProfile {
  const rowCount = rows.length
  const values = rows.map((row) => row[column.name])
  const nonNull = values.filter((value) => value !== null && value !== undefined)
  const nullCount = rowCount - nonNull.length
  const distinctCount = new Set(nonNull).size

  const profile: ColumnProfile = {
    columnId: column.id,
    columnName: column.name,
    dataType: column.dataType,
    rowCount,
    nullCount,
    nullPercentage: rowCount === 0 ? 0 : round((nullCount / rowCount) * 100),
    distinctCount,
    distinctPercentage: rowCount === 0 ? 0 : round((distinctCount / rowCount) * 100),
    isPotentialKey: rowCount > 0 && distinctCount === rowCount && nullCount === 0,
  }

  if (column.dataType === 'integer' || column.dataType === 'decimal') {
    const numbers = nonNull.map((value) => Number(value)).filter((value) => !Number.isNaN(value))
    if (numbers.length > 0) {
      profile.min = Math.min(...numbers)
      profile.max = Math.max(...numbers)
      profile.mean = round(numbers.reduce((sum, value) => sum + value, 0) / numbers.length)
    }
  } else if (column.dataType === 'string') {
    const lengths = nonNull.map((value) => String(value).length)
    if (lengths.length > 0) {
      profile.minLength = Math.min(...lengths)
      profile.maxLength = Math.max(...lengths)
    }
  } else if (column.dataType === 'date' || column.dataType === 'datetime') {
    const sorted = [...nonNull].map(String).sort()
    if (sorted.length > 0) {
      profile.min = sorted[0]
      profile.max = sorted[sorted.length - 1]
    }
  }

  return profile
}
