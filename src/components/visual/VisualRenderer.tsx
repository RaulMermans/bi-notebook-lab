import { useMemo } from 'react'
import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { VisualSpec } from '../../domain/visual'
import type { FilterContext } from '../../runtime/measure/filterContext'
import { resolveColumnRef } from '../../runtime/model/modelRuntime'
import { runSlicerMembers, runVisualQuery } from '../../runtime/visual/visualRuntime'
import type { KpiQueryResult, VisualQueryResult } from '../../runtime/visual/types'
import { BarVisual } from './BarVisual'
import { KpiVisual } from './KpiVisual'
import { LineVisual } from './LineVisual'
import { SlicerVisual } from './SlicerVisual'
import { TableVisual } from './TableVisual'

interface VisualRendererProps {
  visual: VisualSpec
  model: SemanticModel
  datasets: Record<string, Dataset>
  notebookContext: FilterContext
  slicerSelection: unknown[]
  onSlicerChange: (values: unknown[]) => void
}

/**
 * Dispatches a `VisualSpec` to its renderer. Every measure-backed branch
 * calls the shared `runVisualQuery`/`runKpiVisual` entry point and passes
 * only the resulting `VisualQueryResult`/`KpiQueryResult` down — chart/table
 * components never see `SemanticModel`/`Dataset` directly (brief §21/§27).
 */
export function VisualRenderer({ visual, model, datasets, notebookContext, slicerSelection, onSlicerChange }: VisualRendererProps) {
  const result = useMemo(() => {
    if (visual.type === 'slicer') return undefined
    return runVisualQuery(model, datasets, visual, notebookContext)
  }, [visual, model, datasets, notebookContext])

  if (visual.type === 'kpi') {
    return <KpiVisual result={result as KpiQueryResult} />
  }

  if (visual.type === 'bar') {
    const measureName = model.measures.find((m) => m.id === visual.measureId)?.name ?? 'Measure'
    return <BarVisual result={result as VisualQueryResult} measureId={visual.measureId} measureName={measureName} />
  }

  if (visual.type === 'line') {
    const measureName = model.measures.find((m) => m.id === visual.measureId)?.name ?? 'Measure'
    return <LineVisual result={result as VisualQueryResult} measureId={visual.measureId} measureName={measureName} />
  }

  if (visual.type === 'table') {
    const measureNames = Object.fromEntries(model.measures.map((m) => [m.id, m.name]))
    const dimensionLabel = visual.dimension ? resolveColumnRef(datasets, visual.dimension)?.column.name : undefined
    return (
      <TableVisual
        result={result as VisualQueryResult}
        dimensionLabel={dimensionLabel}
        measureIds={visual.measureIds}
        measureNames={measureNames}
      />
    )
  }

  // Slicers don't evaluate a measure at all — they resolve distinct members directly.
  const columnName = resolveColumnRef(datasets, visual.column)?.column.name ?? ''
  const members = runSlicerMembers(datasets, visual)
  return (
    <SlicerVisual
      id={visual.id}
      columnName={columnName}
      mode={visual.mode ?? 'single'}
      members={members}
      selectedValues={slicerSelection}
      onChange={(values) => onSlicerChange(values)}
    />
  )
}
