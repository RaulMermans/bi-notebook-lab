import type { DaxConformanceCase } from '../../../src/conformance/types'
import { buildSharedFixture, resolveSharedTableIds, SPAIN_FILTER, FRANCE_FILTER } from './sharedFixture'

const fixture = buildSharedFixture()
const { customersTableId } = resolveSharedTableIds(fixture)

/**
 * Explicit `FilterContext` construction and its effect on a measure,
 * relationship propagation from Customers into Sales, SELECTEDVALUE and
 * HASONEVALUE (Sprint 15) — see docs/FILTER_CONTEXT.md. Sales rows as
 * documented in `sharedFixture.ts`: order 1 (Cust 1, Spain, Revenue 100),
 * order 2 (Cust 2, France, 200), order 3 (Cust 3, Spain, 50), order 4
 * (Cust 1, Spain, blank Revenue/Cost).
 */
export const FILTER_CONTEXT_CASES: DaxConformanceCase[] = [
  {
    id: 'filterContext-001',
    category: 'Filter context',
    description: 'An explicit single-value equality FilterContext on Customers propagates into Sales',
    fixture,
    expression: 'SUM(Sales[Revenue])',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 150, // orders 1 (100) and 3 (50)
    provenance: 'hand-calculated',
  },
  {
    id: 'filterContext-002',
    category: 'Filter context',
    description: 'A different single-value FilterContext (France) narrows to a different subset',
    fixture,
    expression: 'SUM(Sales[Revenue])',
    evaluationMode: 'measure',
    filterContext: FRANCE_FILTER,
    expected: 200, // order 2 only
    provenance: 'hand-calculated',
  },
  {
    id: 'filterContext-003',
    category: 'Filter context',
    description: 'A propagated FilterContext also narrows a different Sales column (Cost)',
    fixture,
    expression: 'SUM(Sales[Cost])',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 100, // orders 1 (60) and 3 (40); order 4's Cost is blank
    provenance: 'hand-calculated',
  },
  {
    id: 'filterContext-004',
    category: 'Filter context',
    description: 'An explicit "in" FilterContext covering every distinct value behaves like no filter at all',
    fixture,
    expression: 'SUM(Sales[Revenue])',
    evaluationMode: 'measure',
    filterContext: {
      filters: [
        {
          column: { datasetId: 'customers-ds', tableId: 'customers-table', columnId: 'customer-country' },
          operator: 'in',
          values: ['Spain', 'France'],
        },
      ],
    },
    expected: 350, // Spain + France covers every Customers row
    provenance: 'hand-calculated',
  },
  {
    id: 'filterContext-005',
    category: 'Filter context',
    description: 'COUNTROWS(Sales) reflects the same Customers -> Sales propagation as an aggregation would',
    fixture,
    expression: 'COUNTROWS(Sales)',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 3, // orders 1, 3, 4 all belong to Spain customers (1 and 3)
    provenance: 'hand-calculated',
  },
  {
    id: 'filterContext-006',
    category: 'Filter context',
    description: 'SELECTEDVALUE returns its alternate when more than one distinct value is visible',
    fixture,
    expression: 'SELECTEDVALUE(Customers[Country], "Multiple")',
    evaluationMode: 'measure',
    expected: 'Multiple', // no filter: Spain and France both visible
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'filterContext-007',
    category: 'Filter context',
    description: 'SELECTEDVALUE returns the single visible value once the filter narrows to it',
    fixture,
    expression: 'SELECTEDVALUE(Customers[Country], "Multiple")',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 'Spain',
    provenance: 'hand-calculated',
  },
  {
    id: 'filterContext-008',
    category: 'Filter context',
    description: 'SELECTEDVALUE with no alternate argument returns BLANK when multiple values are visible',
    fixture,
    expression: 'SELECTEDVALUE(Customers[Country])',
    evaluationMode: 'measure',
    expected: null,
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'filterContext-009',
    category: 'Filter context',
    description: 'HASONEVALUE is false with no filter and two distinct countries visible',
    fixture,
    expression: 'HASONEVALUE(Customers[Country])',
    evaluationMode: 'measure',
    expected: false,
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'filterContext-010',
    category: 'Filter context',
    description: 'HASONEVALUE becomes true once a FilterContext narrows the column to a single distinct value',
    fixture: { ...fixture, homeModelTableId: customersTableId },
    expression: 'HASONEVALUE(Customers[Country])',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: true,
    provenance: 'hand-calculated',
  },
]
