import { useCallback, useMemo, useState } from 'react'
import { EMPTY_FILTER_CONTEXT, mergeFilterContexts, type ColumnFilter, type FilterContext } from '../measure/filterContext'

/**
 * The Sprint 7 `NotebookVisualContext` (brief §14): the shared, transient
 * filter state every KPI/Table/Bar/Line/Slicer cell reads. Deliberately its
 * own React state, not the Sprint 6 Context Explorer's filter state (brief
 * §15) — two different surfaces with two different lifetimes, kept apart
 * even though both are built on the same `ColumnFilter[]`/`FilterContext`
 * primitives.
 *
 * Selections are keyed by the emitting Slicer's cell id, not by column, so
 * clearing one Slicer removes exactly its own filter and nothing else
 * (brief §36) even if (unusually) two Slicers targeted the same column.
 * Never persisted — reloading the notebook always starts every Slicer back
 * at "All" (brief §14/§45), while the Slicer *cells themselves* (their
 * `VisualSpec`) persist as ordinary `NotebookDocument.cells` state.
 */
export function useNotebookVisualContext() {
  const [bySlicer, setBySlicer] = useState<Record<string, ColumnFilter>>({})

  const setSlicerFilter = useCallback((slicerId: string, filter: ColumnFilter | undefined) => {
    setBySlicer((prev) => {
      if (!filter) {
        if (!(slicerId in prev)) return prev
        const next = { ...prev }
        delete next[slicerId]
        return next
      }
      return { ...prev, [slicerId]: filter }
    })
  }, [])

  const clearSlicer = useCallback((slicerId: string) => setSlicerFilter(slicerId, undefined), [setSlicerFilter])

  const filterContext = useMemo<FilterContext>(
    () => Object.values(bySlicer).reduce<FilterContext>((ctx, filter) => mergeFilterContexts(ctx, { filters: [filter] }), EMPTY_FILTER_CONTEXT),
    [bySlicer],
  )

  return { filterContext, bySlicer, setSlicerFilter, clearSlicer }
}

export type NotebookVisualContext = ReturnType<typeof useNotebookVisualContext>
