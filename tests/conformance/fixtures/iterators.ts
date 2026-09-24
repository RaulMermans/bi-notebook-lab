import type { DaxConformanceCase } from '../../../src/conformance/types'
import type { ConformanceModelFixture } from '../../../src/conformance/types'
import { createMeasure } from '../../../src/runtime/measure/measureRuntime'
import { buildSharedFixture, resolveSharedTableIds } from './sharedFixture'

const fixture = buildSharedFixture()

/**
 * A second fixture layered on the shared model with one pre-built measure
 * ("Total Revenue" = SUM(Sales[Revenue])), needed only for the context-
 * transition case (a measure reference inside an iterator's row expression).
 * `createMeasure` here is just fixture setup (identical to how
 * `iterators.ts`'s own conformance case will later call `createMeasure`
 * again for the probe expression) — it never supplies an `expected` value.
 */
function iteratorContextFixture(): ConformanceModelFixture {
  const base = buildSharedFixture()
  const { salesTableId, productsTableId } = resolveSharedTableIds(base)
  const withMeasure = createMeasure(base.model, base.datasets, {
    homeModelTableId: salesTableId,
    name: 'Total Revenue',
    expression: 'SUM(Sales[Revenue])',
  })
  return { model: withMeasure.model, datasets: base.datasets, homeModelTableId: productsTableId }
}

const contextFixture = iteratorContextFixture()

/**
 * SUMX/AVERAGEX/MINX/MAXX/COUNTX and context transition — see
 * docs/ITERATORS.md. Sales rows (see `sharedFixture.ts`):
 *   OrderID 1: Revenue 100, Cost 60  -> Revenue-Cost = 40
 *   OrderID 2: Revenue 200, Cost 150 -> Revenue-Cost = 50
 *   OrderID 3: Revenue 50,  Cost 40  -> Revenue-Cost = 10
 *   OrderID 4: Revenue BLANK, Cost BLANK -> BLANK - BLANK = BLANK (this
 *     engine propagates BLANK through arithmetic uniformly — see
 *     `blanks.ts` blank-008 — so the row expression itself is BLANK and is
 *     excluded from every iterator fold below, matching real DAX's "blank
 *     row-expression results never contribute" rule regardless of *why*
 *     the row expression came out blank).
 */
export const ITERATOR_CASES: DaxConformanceCase[] = [
  {
    id: 'iterators-001',
    category: 'Iterators',
    description: 'SUMX folds a per-row arithmetic expression, excluding the blank row',
    fixture,
    expression: 'SUMX(Sales, Sales[Revenue] - Sales[Cost])',
    evaluationMode: 'measure',
    expected: 100, // 40 + 50 + 10
    provenance: 'hand-calculated',
  },
  {
    id: 'iterators-002',
    category: 'Iterators',
    description: 'AVERAGEX divides by the count of non-blank row-expression results only',
    fixture,
    expression: 'AVERAGEX(Sales, Sales[Revenue] - Sales[Cost])',
    evaluationMode: 'measure',
    expected: 100 / 3, // (40 + 50 + 10) / 3, not / 4
    provenance: 'hand-calculated',
  },
  {
    id: 'iterators-003',
    category: 'Iterators',
    description: 'MINX finds the minimum per-row expression result',
    fixture,
    expression: 'MINX(Sales, Sales[Revenue] - Sales[Cost])',
    evaluationMode: 'measure',
    expected: 10,
    provenance: 'hand-calculated',
  },
  {
    id: 'iterators-004',
    category: 'Iterators',
    description: 'MAXX finds the maximum per-row expression result',
    fixture,
    expression: 'MAXX(Sales, Sales[Revenue] - Sales[Cost])',
    evaluationMode: 'measure',
    expected: 50,
    provenance: 'hand-calculated',
  },
  {
    id: 'iterators-005',
    category: 'Iterators',
    description: 'COUNTX counts only non-blank per-row expression results',
    fixture,
    expression: 'COUNTX(Sales, Sales[Revenue] - Sales[Cost])',
    evaluationMode: 'measure',
    expected: 3, // OrderID 4's BLANK result excluded
    provenance: 'hand-calculated',
  },
  {
    id: 'iterators-006',
    category: 'Iterators',
    description: 'SUMX over a bare column matches SUM over the same column (blank row still excluded, not coerced to zero)',
    fixture,
    expression: 'SUMX(Sales, Sales[Revenue])',
    evaluationMode: 'measure',
    expected: 350,
    provenance: 'hand-calculated',
  },
  {
    id: 'iterators-007',
    category: 'Iterators',
    description: 'A measure reference inside an iterator row expression undergoes context transition per row',
    fixture: contextFixture,
    expression: 'SUMX(Products, [Total Revenue])',
    evaluationMode: 'measure',
    // Products fully partitions Sales (every Sales row has exactly one ProductID), so summing
    // [Total Revenue] context-transitioned per product must reconstruct the grand total:
    // Furniture (ProductID 1: orders 1+3 = 100+50 = 150) + Electronics (ProductID 2: order 2 = 200,
    // order 4's Revenue is blank and contributes nothing) = 150 + 200 = 350.
    expected: 350,
    provenance: 'hand-calculated',
  },
]
