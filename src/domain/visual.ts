import type { ColumnRef } from './model'

/**
 * Sprint 7 visualization domain. A `VisualSpec` is field-mapping
 * configuration only — it never stores computed results. Every value shown
 * by a visual is produced at render time by `runtime/visual/*` reusing the
 * Sprint 4 measure runtime (see docs/VISUAL_CELLS.md); this file has no
 * runtime behavior of its own.
 */

export type VisualType = 'kpi' | 'table' | 'bar' | 'line' | 'slicer'

export interface BaseVisualSpec {
  id: string
  type: VisualType
  title?: string
}

export interface KpiVisualSpec extends BaseVisualSpec {
  type: 'kpi'
  measureId: string
}

export type BarSortOrder = 'category-asc' | 'category-desc' | 'value-asc' | 'value-desc'

/**
 * `category` is always a physical `ColumnRef` — Sprint 7 defers calculated
 * columns as visual dimensions (see docs/VISUAL_CELLS.md "Known
 * limitations"); measure aggregation still supports calculated columns
 * unchanged (Sprint 4).
 */
export interface BarVisualSpec extends BaseVisualSpec {
  type: 'bar'
  category: ColumnRef
  measureId: string
  sort?: BarSortOrder
  limit?: number
}

export type LineSortOrder = 'axis-asc' | 'axis-desc'

export interface LineVisualSpec extends BaseVisualSpec {
  type: 'line'
  axis: ColumnRef
  measureId: string
  sort?: LineSortOrder
}

export interface TableVisualSpec extends BaseVisualSpec {
  type: 'table'
  dimension?: ColumnRef
  measureIds: string[]
  limit?: number
}

export type SlicerMode = 'single' | 'multi'

export interface SlicerVisualSpec extends BaseVisualSpec {
  type: 'slicer'
  column: ColumnRef
  mode?: SlicerMode
}

export type VisualSpec = KpiVisualSpec | TableVisualSpec | BarVisualSpec | LineVisualSpec | SlicerVisualSpec

/** Recommended defaults from the Sprint 7 brief §18 "Axis Cardinality Limits". */
export const VISUAL_CARDINALITY_LIMITS = {
  bar: 30,
  line: 100,
  table: 100,
  slicer: 200,
} as const

export const DEFAULT_BAR_SORT: BarSortOrder = 'value-desc'
export const DEFAULT_LINE_SORT: LineSortOrder = 'axis-asc'
