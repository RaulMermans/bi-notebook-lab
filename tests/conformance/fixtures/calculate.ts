import type { DaxConformanceCase } from '../../../src/conformance/types'
import { buildSharedFixture, SPAIN_FILTER, FRANCE_FILTER } from './sharedFixture'

const fixture = buildSharedFixture()

/**
 * CALCULATE replacement semantics, FILTER, REMOVEFILTERS/ALL, KEEPFILTERS,
 * IF/SWITCH/BLANK — see docs/CALCULATE.md. All expected values hand-derived
 * from the shared fixture's Sales rows (see `sharedFixture.ts` doc comment):
 *   OrderID 1: Cust 1 (Spain),  Product 1 (Furniture, 100), Revenue 100, Cost 60
 *   OrderID 2: Cust 2 (France), Product 2 (Electronics, 50), Revenue 200, Cost 150
 *   OrderID 3: Cust 3 (Spain),  Product 1 (Furniture, 100), Revenue 50,  Cost 40
 *   OrderID 4: Cust 1 (Spain),  Product 2 (Electronics, 50), Revenue BLANK, Cost BLANK
 */
export const CALCULATE_CASES: DaxConformanceCase[] = [
  {
    id: 'calculate-001',
    category: 'CALCULATE',
    description: 'A same-column CALCULATE filter REPLACES an incompatible ambient filter outright, never intersects to empty',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), Customers[Country] = "France")',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 200, // France's own number (order 2) — proves replace, not intersect (which would be BLANK)
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'calculate-002',
    category: 'CALCULATE',
    description: 'REMOVEFILTERS(Table) clears an ambient filter on that table entirely',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), REMOVEFILTERS(Customers))',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 350, // back to the grand total
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'calculate-003',
    category: 'CALCULATE',
    description: 'ALL(Table[Column]) is equivalent to REMOVEFILTERS(Table[Column]) — removes just that column filter',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), ALL(Customers[Country]))',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 350,
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'calculate-004',
    category: 'CALCULATE',
    description: 'REMOVEFILTERS() with no arguments clears every filter in the current context',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), REMOVEFILTERS())',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 350,
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'calculate-005',
    category: 'CALCULATE',
    description: 'FILTER(Table, predicate) as a CALCULATE argument scans Sales directly',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), FILTER(Sales, Sales[Revenue] > 60))',
    evaluationMode: 'measure',
    expected: 300, // order 1 (100) + order 2 (200); order 3 (50) fails the predicate, order 4 is blank
    provenance: 'hand-calculated',
  },
  {
    id: 'calculate-006',
    category: 'CALCULATE',
    description: 'FILTER(Table, predicate) on a dimension table (Products) still reaches Sales through the relationship',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), FILTER(Products, Products[UnitPrice] > 60))',
    evaluationMode: 'measure',
    expected: 150, // only Furniture (UnitPrice 100) qualifies -> orders 1 (100) + 3 (50)
    provenance: 'hand-calculated',
  },
  {
    id: 'calculate-007',
    category: 'CALCULATE',
    description: 'KEEPFILTERS on the same column INTERSECTS with a compatible ambient filter instead of replacing it',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), KEEPFILTERS(Customers[Country] = "Spain"))',
    evaluationMode: 'measure',
    filterContext: SPAIN_FILTER,
    expected: 150, // Spain intersected with Spain stays Spain
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'calculate-008',
    category: 'CALCULATE',
    description: 'KEEPFILTERS intersected with an incompatible ambient same-column filter narrows to an empty set (BLANK)',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), KEEPFILTERS(Customers[Country] = "Spain"))',
    evaluationMode: 'measure',
    filterContext: FRANCE_FILTER,
    expected: null, // France (ambient) AND Spain (KEEPFILTERS) -> no rows -> BLANK, never a plain replace
    provenance: 'documented-dax-semantics',
  },
  {
    id: 'calculate-009',
    category: 'CALCULATE',
    description: 'IF branches on a CALCULATE-computed scalar',
    fixture,
    expression: 'IF(CALCULATE(SUM(Sales[Revenue]), Customers[Country] = "Spain") > 100, "High", "Low")',
    evaluationMode: 'measure',
    expected: 'High', // Spain revenue is 150 > 100
    provenance: 'hand-calculated',
  },
  {
    id: 'calculate-010',
    category: 'CALCULATE',
    description: 'SWITCH(TRUE(), ...) evaluates its first matching condition against an aggregation',
    fixture,
    expression: 'SWITCH(TRUE(), SUM(Sales[Revenue]) > 300, "Big", SUM(Sales[Revenue]) > 100, "Medium", "Small")',
    evaluationMode: 'measure',
    expected: 'Big', // grand total 350 > 300
    provenance: 'hand-calculated',
  },
  {
    id: 'calculate-011',
    category: 'CALCULATE',
    description: 'CALCULATE filtered down to zero rows returns BLANK, not zero or an error',
    fixture,
    expression: 'CALCULATE(SUM(Sales[Revenue]), Customers[Country] = "Germany")',
    evaluationMode: 'measure',
    expected: null, // no Customers row is Germany -> no Sales rows visible
    provenance: 'hand-calculated',
  },
]
