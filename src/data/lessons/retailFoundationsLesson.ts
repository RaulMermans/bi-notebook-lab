import type { BuiltInLesson, LessonInitialState } from '../../domain/learning'
import { retailFoundationsValidationSpec } from '../exercises/retailFoundationsValidation'
import { buildRetailNotebookBase, createLessonRuntime } from './support/retailModelBuilder'

function initialize(): LessonInitialState {
  const runtime = createLessonRuntime('Retail Foundations')
  const base = buildRetailNotebookBase(runtime)
  runtime.createTestCell({ kind: 'model', modelId: base.modelId }, retailFoundationsValidationSpec, 'Retail Foundations Checkpoint')

  const snapshot = runtime.getSnapshot()
  return { notebook: snapshot.notebook, datasets: snapshot.datasets, models: snapshot.models, queries: snapshot.queries }
}

/**
 * Lesson 1 (Sprint 13): star-schema modeling, a row-level calculated
 * column, and the four foundational Retail measures. Reuses
 * `retailFoundationsValidationSpec` (Sprint 5) as its checkpoint rather
 * than authoring a new one (sprint brief "Do not duplicate the validation
 * fixture. Reuse it.").
 */
export const retailFoundationsLesson: BuiltInLesson = {
  definition: {
    id: 'retail-foundations',
    version: 1,
    title: 'Retail Foundations',
    description:
      'Build a star-schema model over the Retail sample, add a calculated column, and create the measures every retail report needs.',
    difficulty: 'beginner',
    estimatedMinutes: 25,
    objectives: [
      'Recognize table grain and why Customers/Products/Calendar sit on the "1" side of a relationship',
      'Connect Customers, Products and Calendar to Sales with 1:* relationships',
      'Create a row-level calculated column (Margin)',
      'Create aggregate measures (Total Revenue, Orders, Average Order Value, Gross Margin)',
      'Observe how a measure responds to filter context',
    ],
    tags: ['star-schema', 'relationships', 'calculated-columns', 'measures'],
    stages: [
      {
        id: 'inspect-data',
        title: 'Inspect the data',
        instructions:
          'Open each imported table. Customers has one row per customer. Products has one row per product. Sales has many rows per customer and many rows per product — that difference in grain is what a relationship connects.',
        learningObjective: 'Table grain',
        hints: [
          { id: 'hint-1', text: 'Look at which table contains repeated CustomerIDs.' },
          {
            id: 'hint-2',
            text: 'A table with one row per entity sits on the "1" side of a relationship; a table with many rows per entity sits on the "many" side.',
          },
        ],
      },
      {
        id: 'build-model',
        title: 'Build the model',
        instructions:
          'Customers contains one row per customer. Sales contains many rows per customer. Create the relationship that lets a customer filter their sales. Do the same for Products and Calendar.',
        learningObjective: 'Star-schema modeling',
        hints: [
          { id: 'hint-1', text: 'Customers should normally sit on the "1" side of the relationship.' },
          { id: 'hint-2', text: 'Connect Customers[CustomerID] → Sales[CustomerID].' },
          { id: 'hint-3', text: 'Repeat the same pattern for Products[ProductID] → Sales[ProductID] and Calendar[Date] → Sales[Date].' },
        ],
      },
      {
        id: 'create-margin',
        title: 'Create Margin',
        instructions: 'Every sale has a Revenue and a Cost. Add a calculated column named "Margin" on Sales that computes Revenue minus Cost for each row.',
        learningObjective: 'Row-level calculated columns',
        hints: [
          { id: 'hint-1', text: 'A calculated column runs once per row, using that row’s own values.' },
          { id: 'hint-2', text: 'Margin = Sales[Revenue] - Sales[Cost]' },
        ],
      },
      {
        id: 'create-measures',
        title: 'Create measures',
        instructions:
          'Add Total Revenue (sum of Revenue), Orders (distinct count of OrderID), Average Order Value (Total Revenue divided by Orders), and Gross Margin (Total Revenue minus Total Cost).',
        learningObjective: 'Aggregate measures',
        hints: [
          { id: 'hint-1', text: 'Total Revenue = SUM(Sales[Revenue])' },
          { id: 'hint-2', text: 'Orders = DISTINCTCOUNT(Sales[OrderID])' },
          { id: 'hint-3', text: 'Average Order Value = DIVIDE([Total Revenue], [Orders]) — DIVIDE avoids a division-by-zero error.' },
        ],
      },
      {
        id: 'verify-filter-behavior',
        title: 'Verify filter behavior',
        instructions:
          'Run the Retail Foundations checkpoint. A correct model scores 100/100 across relationships, the star schema, Margin, and every measure — including how Total Revenue responds when you filter to Spain, to Furniture, or to a single year.',
        learningObjective: 'Filter-context behavior',
        checkpointValidationId: retailFoundationsValidationSpec.id,
        hints: [
          {
            id: 'hint-1',
            text: 'A measure automatically recomputes for whatever rows are currently visible — you never write separate versions of Total Revenue per country.',
          },
        ],
      },
    ],
    solution: {
      explanation:
        'Connect each dimension table to Sales on its key column (Customers[CustomerID], Products[ProductID], Calendar[Date]), all as 1:* relationships with Sales on the "many" side. Add Margin as a row-level calculated column, then build the four measures as plain aggregations over Sales.',
      keyPoints: [
        'Dimension tables (Customers, Products, Calendar) sit on the "1" side; the fact table (Sales) sits on the "many" side.',
        'A calculated column is evaluated once per row; a measure is evaluated once per filter context.',
        'DIVIDE(...) instead of "/" avoids a division-by-zero error when a filter leaves zero orders.',
      ],
      exampleExpressions: [
        'Margin = Sales[Revenue] - Sales[Cost]',
        'Total Revenue = SUM(Sales[Revenue])',
        'Total Cost = SUM(Sales[Cost])',
        'Gross Margin = [Total Revenue] - [Total Cost]',
        'Orders = DISTINCTCOUNT(Sales[OrderID])',
        'Average Order Value = DIVIDE([Total Revenue], [Orders])',
      ],
    },
  },
  initialize,
}
