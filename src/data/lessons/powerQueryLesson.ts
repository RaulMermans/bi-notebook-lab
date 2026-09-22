import type { BuiltInLesson, LessonInitialState } from '../../domain/learning'
import { generateMonthlyTargetsDataset } from '../../lib/sample/generateMonthlyTargetsDataset'
import { generatePowerQueryLabDataset } from '../../lib/sample/generatePowerQueryLabDataset'
import {
  customersCleanValidationSpec,
  modelReadyOutputValidationSpec,
  monthlyTargetsValidationSpec,
  salesAnalyticalColumnsValidationSpec,
} from '../exercises/powerQueryLessonValidation'
import { createLessonRuntime } from './support/retailModelBuilder'

function initialize(): LessonInitialState {
  const runtime = createLessonRuntime('Power Query — Cleaning & Reshaping Data')

  const [salesJanDs, salesFebDs, productsDs, customersDirtyDs] = generatePowerQueryLabDataset()
  const monthlyTargetsDs = generateMonthlyTargetsDataset()
  ;[salesJanDs, salesFebDs, productsDs, customersDirtyDs, monthlyTargetsDs].forEach((ds) => runtime.importDataset(ds))

  // Load starts OFF for all three — the final stage teaches Enable Load as an explicit, meaningful
  // step rather than something already true by default (a new QueryDefinition otherwise defaults
  // to `loadEnabled: true`, which would make that checkpoint trivially pass from the start).
  const { query: customersQuery } = runtime.createQueryFromDataset(customersDirtyDs.id, customersDirtyDs.tables[0].id, 'Customers_Clean')
  const { query: targetsQuery } = runtime.createQueryFromDataset(monthlyTargetsDs.id, monthlyTargetsDs.tables[0].id, 'Monthly_Targets_Long')
  const { query: salesQuery } = runtime.createQueryFromDataset(salesJanDs.id, salesJanDs.tables[0].id, 'Sales_Clean')
  // The Applied Steps UI's Append Queries form only lists other *queries*, never a raw dataset
  // directly — so Sales_Feb needs its own (untouched) query cell to be an appendable source.
  const { query: salesFebQuery } = runtime.createQueryFromDataset(salesFebDs.id, salesFebDs.tables[0].id, 'Sales_Feb')
  runtime.setQueryLoadEnabled(customersQuery.id, false)
  runtime.setQueryLoadEnabled(targetsQuery.id, false)
  runtime.setQueryLoadEnabled(salesQuery.id, false)
  runtime.setQueryLoadEnabled(salesFebQuery.id, false)

  runtime.createTestCell({ kind: 'workspace' }, customersCleanValidationSpec, 'Clean Customers Checkpoint')
  runtime.createTestCell({ kind: 'workspace' }, monthlyTargetsValidationSpec, 'Reshape Monthly Targets Checkpoint')
  runtime.createTestCell({ kind: 'workspace' }, salesAnalyticalColumnsValidationSpec, 'Analytical Columns Checkpoint')
  runtime.createTestCell({ kind: 'workspace' }, modelReadyOutputValidationSpec, 'Model-Ready Output Checkpoint')

  const snapshot = runtime.getSnapshot()
  return { notebook: snapshot.notebook, datasets: snapshot.datasets, models: snapshot.models, queries: snapshot.queries }
}

/**
 * Lesson 4 (Sprint 14): the first lesson the Learning System can grade
 * directly on Power Query work — no Semantic Model exists anywhere in this
 * lesson (every checkpoint is `'workspace'`-scoped). Reuses the Sprint 12
 * Power Query Lab dataset (deliberately dirty `Customers_Dirty`,
 * append-compatible `Sales_Jan`/`Sales_Feb`) plus a small dedicated
 * `Monthly_Targets_Wide` table added specifically to motivate Unpivot
 * Columns (docs/QUERY_VALIDATION.md; docs/POWER_QUERY_EXPRESSIONS.md).
 */
export const powerQueryLesson: BuiltInLesson = {
  definition: {
    id: 'power-query-cleaning-reshaping',
    version: 1,
    title: 'Power Query — Cleaning & Reshaping Data',
    description: 'Clean a dirty customer table, reshape a wide monthly-targets table, and derive analytical columns — all through typed Applied Steps, graded directly.',
    difficulty: 'intermediate',
    estimatedMinutes: 35,
    objectives: [
      'Clean a real-world messy table with Filter Rows, Remove Duplicates and Change Type',
      'Reshape a wide table into a long one with Unpivot Columns',
      'Derive analytical columns with Conditional Column and a bounded Custom Column expression',
      'Combine two compatible tables with Append Queries',
      'Prepare query output to feed a Semantic Model with Enable Load',
    ],
    tags: ['power-query', 'applied-steps', 'data-cleaning', 'unpivot', 'custom-column'],
    stages: [
      {
        id: 'inspect-source-data',
        title: 'Inspect the source data',
        instructions:
          'Open Customers_Dirty, Sales_Jan, Sales_Feb, Products and Monthly_Targets_Wide. Customers_Dirty has a text CustomerID column, blank ids, and duplicate rows. Monthly_Targets_Wide has one column per month — Jan, Feb, Mar, Apr — the shape Unpivot exists to fix.',
        learningObjective: 'What "dirty" data looks like before Power Query cleans it',
        hints: [
          { id: 'hint-1', text: 'customer_id is a text column even though it holds numbers — that\'s a Change Type candidate.' },
          { id: 'hint-2', text: 'A handful of rows in Customers_Dirty are exact duplicates, and a few have a blank customer_id.' },
        ],
      },
      {
        id: 'clean-customers',
        title: 'Clean Customers',
        instructions:
          'On Customers_Clean (sourced from Customers_Dirty): filter out rows with a blank customer_id, remove exact duplicate rows, then change customer_id to a Whole Number and rename it to CustomerID. Run the checkpoint once Customers_Clean has exactly 100 rows.',
        learningObjective: 'Data cleaning before modeling',
        checkpointValidationId: customersCleanValidationSpec.id,
        hints: [
          { id: 'hint-1', text: 'Filter Rows: customer_id "is not blank".' },
          { id: 'hint-2', text: 'Remove Duplicates before Change Type — a blank/duplicate row is easier to reason about while it\'s still text.' },
          { id: 'hint-3', text: 'Change Type expects a clean numeric-looking column — blanks must already be gone.' },
        ],
      },
      {
        id: 'reshape-monthly-targets',
        title: 'Reshape monthly targets',
        instructions:
          'On Monthly_Targets_Long (sourced from Monthly_Targets_Wide): use Unpivot Columns on Jan, Feb, Mar and Apr, naming the new columns Month and Target. Run the checkpoint once it produces 12 rows — one per product per month.',
        learningObjective: 'Unpivot Columns',
        checkpointValidationId: monthlyTargetsValidationSpec.id,
        hints: [
          { id: 'hint-1', text: 'Select Jan, Feb, Mar, Apr and choose "Unpivot selected columns".' },
          { id: 'hint-2', text: 'Product is not selected, so it stays as its own column — only the month columns collapse into Month/Target.' },
        ],
      },
      {
        id: 'analytical-columns',
        title: 'Create analytical columns',
        instructions:
          'On Sales_Clean (sourced from Sales_Jan): add an Append Queries step bringing in Sales_Feb. Then add a Conditional Column named RevenueBand ("High" when Revenue >= 300, "Medium" when Revenue >= 100, otherwise "Low"), and a Custom Column named RevenuePerUnit with the expression [Revenue] / [Quantity].',
        learningObjective: 'Conditional Column and the Custom Column expression subset',
        checkpointValidationId: salesAnalyticalColumnsValidationSpec.id,
        hints: [
          { id: 'hint-1', text: 'Append Queries combines Sales_Jan (300 total rows once both months are in) — Sales_Feb has an extra Promotion column, which is fine, Append just fills it with blanks for Jan rows.' },
          { id: 'hint-2', text: 'Conditional Column clauses are checked in order — put the highest threshold first.' },
          { id: 'hint-3', text: 'Custom Column expression: [Revenue] / [Quantity] — no "=" prefix, just the expression.' },
        ],
      },
      {
        id: 'prepare-model-ready-output',
        title: 'Prepare model-ready output',
        instructions:
          'Turn on Enable Load for Customers_Clean, Monthly_Targets_Long and Sales_Clean so they can feed a Semantic Model. Run the final checkpoint once all three evaluate without errors and have Enable Load turned on.',
        learningObjective: 'Enable Load as the boundary between Power Query and the Semantic Model',
        checkpointValidationId: modelReadyOutputValidationSpec.id,
        hints: [
          { id: 'hint-1', text: 'Enable Load is the toggle in each query\'s header, next to its row/column count.' },
          { id: 'hint-2', text: 'A query with an unresolved error can\'t pass query-health, even with Enable Load turned on.' },
        ],
      },
    ],
    solution: {
      explanation:
        'Customers_Clean: Filter Rows (customer_id is not blank) → Remove Duplicates → Change Type (customer_id → Whole Number) → Rename Columns (customer_id → CustomerID). Monthly_Targets_Long: Unpivot Columns on Jan/Feb/Mar/Apr into Month/Target. Sales_Clean: Append Queries (+ Sales_Feb) → Conditional Column (RevenueBand) → Custom Column (RevenuePerUnit).',
      keyPoints: [
        'Remove blanks and duplicates before changing a column\'s type — a dirty value can make type conversion fail.',
        'Unpivot Columns turns "one column per category" into "one row per category" — the shape most aggregation and charting expects.',
        'Conditional Column clauses are checked in order, first match wins — Revenue >= 300 → "High", else Revenue >= 100 → "Medium", else "Low".',
        'A Custom Column expression is a bounded Power Query subset, not full M — see docs/POWER_QUERY_EXPRESSIONS.md.',
        'Enable Load is the explicit boundary between a Power Query transformation and a table the Semantic Model can use.',
      ],
      exampleExpressions: ['[Revenue] / [Quantity]'],
    },
  },
  initialize,
}
