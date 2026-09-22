import { generateRetailDataset } from '../../lib/sample/generateRetailDataset'
import type { ValidationSpec } from '../../domain/validation'

/**
 * Frozen fixture values for the Filter Context & CALCULATE checkpoint
 * (Lesson 2). Computed independently of the model/measure runtime, exactly
 * like `retailFoundationsValidation.ts` — see that file's doc comment for
 * why ("Expected values are frozen fixtures, not re-derived from the
 * learner").
 */
const [customersDs, , salesDs] = generateRetailDataset()
const customerRows = customersDs.tables[0].rows
const salesRows = salesDs.tables[0].rows

function sum(rows: Record<string, unknown>[], selector: (row: Record<string, unknown>) => number): number {
  return rows.reduce((total, row) => total + selector(row), 0)
}

const totalRevenue = sum(salesRows, (r) => r.Revenue as number)
const spainCustomerIds = new Set(customerRows.filter((r) => r.Country === 'Spain').map((r) => r.CustomerID))
const revenueSpain = sum(
  salesRows.filter((r) => spainCustomerIds.has(r.CustomerID)),
  (r) => r.Revenue as number,
)

const CUSTOMERS = { tableName: 'Customers', sourceKey: 'customers' }

/**
 * The second scored checkpoint (Sprint 13). Builds on a completed Retail
 * Foundations model (relationships + `Total Revenue` already exist — see
 * `src/data/lessons/filterContextLesson.ts`) and requires three new
 * CALCULATE-based measures: a same-column filter override (`Spain
 * Revenue`), a filter-removal override (`Revenue All Countries`), and a
 * ratio of the two (`Revenue % All Countries`). Every case applies an
 * *external* filter and checks the measure still returns the
 * CALCULATE-overridden result — the whole point of this lesson.
 */
export const filterContextValidationSpec: ValidationSpec = {
  id: 'filter-context-checkpoint',
  title: 'Filter Context & CALCULATE',
  passingPercentage: 70,
  rules: [
    {
      id: 'measure-spain-revenue',
      type: 'measure-result',
      title: 'Spain Revenue',
      category: 'Measures',
      points: 25,
      measure: { name: 'Spain Revenue' },
      cases: [
        { id: 'no-external-filter', title: 'No external filter', filters: [], expected: revenueSpain },
        {
          id: 'external-country-filter',
          title: 'External filter: Country = France',
          filters: [{ column: { table: CUSTOMERS, columnName: 'Country' }, values: ['France'] }],
          expected: revenueSpain,
        },
      ],
    },
    {
      id: 'semantics-spain-revenue',
      type: 'expression-semantics',
      title: 'Spain Revenue uses CALCULATE',
      category: 'Filter behavior',
      points: 10,
      target: { kind: 'measure', measure: { name: 'Spain Revenue' } },
      assertions: [{ kind: 'uses-function', functionName: 'CALCULATE' }],
    },
    {
      id: 'measure-revenue-all-countries',
      type: 'measure-result',
      title: 'Revenue All Countries',
      category: 'Measures',
      points: 25,
      measure: { name: 'Revenue All Countries' },
      cases: [
        {
          id: 'filtered-spain',
          title: 'External filter: Country = Spain',
          filters: [{ column: { table: CUSTOMERS, columnName: 'Country' }, values: ['Spain'] }],
          expected: totalRevenue,
        },
        { id: 'no-filter', title: 'No external filter', filters: [], expected: totalRevenue },
      ],
    },
    {
      id: 'semantics-revenue-all-countries',
      type: 'expression-semantics',
      title: 'Revenue All Countries ignores the external filter deliberately',
      category: 'Filter behavior',
      points: 10,
      target: { kind: 'measure', measure: { name: 'Revenue All Countries' } },
      assertions: [{ kind: 'not-constant-only' }],
    },
    {
      id: 'measure-revenue-pct-all-countries',
      type: 'measure-result',
      title: 'Revenue % All Countries',
      category: 'Measures',
      points: 30,
      measure: { name: 'Revenue % All Countries' },
      cases: [
        {
          id: 'spain',
          title: 'External filter: Country = Spain',
          filters: [{ column: { table: CUSTOMERS, columnName: 'Country' }, values: ['Spain'] }],
          expected: (revenueSpain / totalRevenue) * 100,
        },
        { id: 'no-filter', title: 'No external filter', filters: [], expected: 100 },
      ],
    },
  ],
}
