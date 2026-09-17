import type { DataType } from '../../domain/data'

export interface ColumnProfile {
  columnId: string
  columnName: string
  dataType: DataType
  rowCount: number
  nullCount: number
  nullPercentage: number
  distinctCount: number
  distinctPercentage: number
  min?: number | string
  max?: number | string
  mean?: number
  minLength?: number
  maxLength?: number
  isPotentialKey: boolean
}
