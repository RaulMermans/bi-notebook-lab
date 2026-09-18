import type { DataType } from '../../domain/data'
import type { BarSortOrder, LineSortOrder } from '../../domain/visual'
import type { VisualDataRow } from './types'

/**
 * Deterministic sorting for grouped Visual rows (Sprint 7 brief §19/§20).
 * Never relies on JS object insertion order. Blank dimension members
 * always sort last, in every sort direction — a deliberate, documented
 * choice (docs/VISUAL_CELLS.md) rather than an accident of swapping
 * comparator arguments for descending order.
 */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined
}

function compareNonBlankDimension(a: unknown, b: unknown, dataType: DataType): number {
  if (dataType === 'integer' || dataType === 'decimal') return (a as number) - (b as number)
  if (dataType === 'date' || dataType === 'datetime') return new Date(a as string).getTime() - new Date(b as string).getTime()
  return String(a).localeCompare(String(b))
}

function compareBlanksLast(a: unknown, b: unknown, compareNonBlank: (a: unknown, b: unknown) => number, descending: boolean): number {
  const aBlank = isBlank(a)
  const bBlank = isBlank(b)
  if (aBlank && bBlank) return 0
  if (aBlank) return 1
  if (bBlank) return -1
  const cmp = compareNonBlank(a, b)
  return descending ? -cmp : cmp
}

function compareNumeric(a: unknown, b: unknown): number {
  return (a as number) - (b as number)
}

export function sortBarRows(rows: VisualDataRow[], measureId: string, sort: BarSortOrder, dimensionDataType: DataType): VisualDataRow[] {
  const sorted = [...rows]
  switch (sort) {
    case 'category-asc':
      sorted.sort((a, b) => compareBlanksLast(a.dimensionValue, b.dimensionValue, (x, y) => compareNonBlankDimension(x, y, dimensionDataType), false))
      break
    case 'category-desc':
      sorted.sort((a, b) => compareBlanksLast(a.dimensionValue, b.dimensionValue, (x, y) => compareNonBlankDimension(x, y, dimensionDataType), true))
      break
    case 'value-asc':
      sorted.sort((a, b) => compareBlanksLast(a.measureValues[measureId], b.measureValues[measureId], compareNumeric, false))
      break
    case 'value-desc':
    default:
      sorted.sort((a, b) => compareBlanksLast(a.measureValues[measureId], b.measureValues[measureId], compareNumeric, true))
      break
  }
  return sorted
}

export function sortLineRows(rows: VisualDataRow[], sort: LineSortOrder, axisDataType: DataType): VisualDataRow[] {
  const sorted = [...rows]
  const descending = sort === 'axis-desc'
  sorted.sort((a, b) => compareBlanksLast(a.dimensionValue, b.dimensionValue, (x, y) => compareNonBlankDimension(x, y, axisDataType), descending))
  return sorted
}
