import type { BuiltInLesson, LessonInitialState } from '../../domain/learning'
import { filterContextValidationSpec } from '../exercises/filterContextValidation'
import { addRetailFoundationsSolution, buildRetailNotebookBase, connectRetailStarSchema, createLessonRuntime } from './support/retailModelBuilder'

function initialize(): LessonInitialState {
  const runtime = createLessonRuntime('Filter Context & CALCULATE')
  const base = buildRetailNotebookBase(runtime)
  connectRetailStarSchema(runtime, base)
  addRetailFoundationsSolution(runtime, base)
  runtime.createTestCell({ kind: 'model', modelId: base.modelId }, filterContextValidationSpec, 'Filter Context Checkpoint')

  const snapshot = runtime.getSnapshot()
  return { notebook: snapshot.notebook, datasets: snapshot.datasets, models: snapshot.models, queries: snapshot.queries }
}

/**
 * Lesson 2 (Sprint 13): starts from an already-completed Retail Foundations
 * model (relationships, Margin, and the four base measures already exist
 * — the point of this lesson is CALCULATE, not modeling again) and teaches
 * external filter context, same-column filter replacement, and
 * REMOVEFILTERS/ALL.
 */
export const filterContextLesson: BuiltInLesson = {
  definition: {
    id: 'filter-context-calculate',
    version: 1,
    title: 'Filter Context & CALCULATE',
    description: 'Learn how external filter context shapes a measure, and how CALCULATE lets you override it on purpose.',
    difficulty: 'intermediate',
    estimatedMinutes: 30,
    prerequisites: ['retail-foundations'],
    objectives: [
      'Explain what "external filter context" means for a measure',
      'Use CALCULATE to replace a filter on the same column (same-column replacement)',
      'Use REMOVEFILTERS/ALL to ignore an external filter entirely',
      'Combine two measures into a ratio that reads correctly under any filter',
    ],
    tags: ['calculate', 'filter-context', 'measures'],
    stages: [
      {
        id: 'external-filter-context',
        title: 'Understand external filter context',
        instructions:
          'Total Revenue already responds to whatever is filtered outside the measure — a country slicer, a category slicer, a visual’s own row/column fields. That incoming filter is the "external filter context." A measure has no CALCULATE of its own until you add one.',
        learningObjective: 'External filter context',
        hints: [
          { id: 'hint-1', text: 'Add a Country slicer and watch Total Revenue change without editing its expression at all.' },
        ],
      },
      {
        id: 'same-column-override',
        title: 'Override the filter with CALCULATE',
        instructions:
          'Create a measure named "Spain Revenue" that always returns Spain’s revenue, no matter what country filter is applied outside it. CALCULATE lets you replace a filter on a column with your own condition.',
        learningObjective: 'Same-column filter replacement',
        hints: [
          { id: 'hint-1', text: 'Think about which column decides "Spain": Customers[Country].' },
          { id: 'hint-2', text: 'Spain Revenue = CALCULATE(SUM(Sales[Revenue]), Customers[Country] = "Spain")' },
        ],
      },
      {
        id: 'remove-filters',
        title: 'Ignore the filter entirely',
        instructions:
          'Create a measure named "Revenue All Countries" that always returns the total across every country, even when a country filter is applied outside it.',
        learningObjective: 'REMOVEFILTERS / ALL',
        hints: [
          { id: 'hint-1', text: 'You don’t want to replace the filter with a specific value this time — you want to remove it.' },
          { id: 'hint-2', text: 'Revenue All Countries = CALCULATE(SUM(Sales[Revenue]), REMOVEFILTERS(Customers))' },
        ],
      },
      {
        id: 'ratio-measure',
        title: 'Build a ratio measure',
        instructions:
          'Create a measure named "Revenue % All Countries" that shows what percentage of the all-country total the currently filtered revenue represents.',
        learningObjective: 'Combining measures',
        hints: [
          { id: 'hint-1', text: 'Total Revenue already reflects the current filter; Revenue All Countries ignores it — divide one by the other.' },
          { id: 'hint-2', text: 'Revenue % All Countries = DIVIDE([Total Revenue], [Revenue All Countries]) * 100' },
        ],
      },
      {
        id: 'verify',
        title: 'Verify multiple filter contexts',
        instructions:
          'Run the Filter Context checkpoint. It applies several different external filters and checks that each measure keeps behaving correctly under all of them.',
        learningObjective: 'Filter-context correctness',
        checkpointValidationId: filterContextValidationSpec.id,
      },
    ],
    solution: {
      explanation:
        'CALCULATE takes a measure expression plus one or more filter arguments. A filter argument on a column that’s already filtered externally replaces that filter (same-column replacement); REMOVEFILTERS/ALL removes an external filter instead of replacing it.',
      keyPoints: [
        'CALCULATE filter arguments replace filters on the same column, they don’t add to them.',
        'REMOVEFILTERS(Customers) (or ALL(Customers)) clears every filter currently applied through the Customers table.',
        'A ratio measure built from two other measures automatically stays correct under every filter, since each side recomputes independently.',
      ],
      exampleExpressions: [
        'Spain Revenue = CALCULATE(SUM(Sales[Revenue]), Customers[Country] = "Spain")',
        'Revenue All Countries = CALCULATE(SUM(Sales[Revenue]), REMOVEFILTERS(Customers))',
        'Revenue % All Countries = DIVIDE([Total Revenue], [Revenue All Countries]) * 100',
      ],
    },
  },
  initialize,
}
