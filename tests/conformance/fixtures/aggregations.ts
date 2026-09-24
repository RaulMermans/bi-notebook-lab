import type { DaxConformanceCase } from '../../../src/conformance/types'
import { buildSharedFixture, SPAIN_FILTER } from './sharedFixture'

const fixture = buildSharedFixture()

/**
 * Aggregation functions (SUM, AVERAGE, MIN, MAX, COUNT, DISTINCTCOUNT) — see
 * docs/MEASURES.md. All hand-calculated from the shared fixture's Sales rows:
 *   OrderID 1: CustomerID 1, ProductID 1, Revenue 100, Cost 60
 *   OrderID 2: CustomerID 2, ProductID 2, Revenue 200, Cost 150
 *   OrderID 3: CustomerID 3, ProductID 1, Revenue 50,  Cost 40
 *   OrderID 4: CustomerID 1, ProductID 2, Revenue BLANK, Cost BLANK (excluded from every aggregation below)
 */
export const AGGREGATION_CASES: DaxConformanceCase[] = [
  {
    id: 'aggregations-001',
    category: 'Aggregations',
    description: 'SUM ignores the blank Revenue row',
    fixture,
    expression: 'SUM(Sales[Revenue])',
    evaluationMode: 'measure',
    expected: 350, // 100 + 200 + 50
    provenance: 'hand-calculated',
  },
  {
    id: 'aggregations-002',
    category: 'Aggregations',
    description: 'SUM over Cost',
    fixture,
    expression: 'SUM(Sales[Cost])',
    evaluationMode: 'measure',
    expected: 250, // 60 + 150 + 40
    provenance: 'hand-calculated',
  },
  {
    id: 'aggregations-003',
    category: 'Aggregations',
    description: 'AVERAGE divides by the non-blank row count only',
    fixture,
    expression: 'AVERAGE(Sales[Cost])',
    evaluationMode: 'measure',
    expected: 250 / 3, // (60 + 150 + 40) / 3, not / 4
    provenance: 'hand-calculated',
  },
  {
    id: 'aggregations-004',
    category: 'Aggregations',
    description: 'MIN across the non-blank Revenue values',
    fixture,
    expression: 'MIN(Sales[Revenue])',
    evaluationMode: 'measure',
    expected: 50,
    provenance: 'hand-calculated',
  },
  {
    id: 'aggregations-005',
    category: 'Aggregations',
    description: 'MAX across the non-blank Revenue values',
    fixture,
    expression: 'MAX(Sales[Revenue])',
    evaluationMode: 'measure',
    expected: 200,
    provenance: 'hand-calculated',
  },
  {
    id: 'aggregations-006',
    category: 'Aggregations',
    description: 'COUNT counts only the non-blank Revenue values',
    fixture,
    expression: 'COUNT(Sales[Revenue])',
    evaluationMode: 'measure',
    expected: 3, // OrderID 4's blank Revenue excluded
    provenance: 'hand-calculated',
  },
  {
    id: 'aggregations-007',
    category: 'Aggregations',
    description: 'DISTINCTCOUNT over a repeated-value column',
    fixture,
    expression: 'DISTINCTCOUNT(Sales[CustomerID])',
    evaluationMode: 'measure',
    expected: 3, // {1, 2, 3} — CustomerID 1 appears twice (orders 1 and 4)
    provenance: 'hand-calculated',
  },
  {
    id: 'aggregations-008',
    category: 'Aggregations',
    description: 'DISTINCTCOUNT over a two-value column',
    fixture,
    expression: 'DISTINCTCOUNT(Sales[ProductID])',
    evaluationMode: 'measure',
    expected: 2, // {1, 2}
    provenance: 'hand-calculated',
  },
  {
    id: 'aggregations-009',
    category: 'Aggregations',
    description: 'SUM under an ambient FilterContext propagated from Customers into Sales',
    fixture,
    expression: 'SUM(Sales[Revenue])',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 150, // orders 1 (100) and 3 (50); order 4's Revenue is still blank
    provenance: 'hand-calculated',
  },
]
