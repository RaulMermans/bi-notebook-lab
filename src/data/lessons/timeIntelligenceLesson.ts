import type { BuiltInLesson, LessonInitialState } from '../../domain/learning'
import { timeIntelligenceValidationSpec } from '../exercises/timeIntelligenceValidation'
import {
  addRetailFoundationsSolution,
  buildRetailNotebookBase,
  connectRetailStarSchema,
  createLessonRuntime,
  markRetailCalendarDateTable,
} from './support/retailModelBuilder'

function initialize(): LessonInitialState {
  const runtime = createLessonRuntime('Time Intelligence')
  const base = buildRetailNotebookBase(runtime)
  connectRetailStarSchema(runtime, base)
  addRetailFoundationsSolution(runtime, base)
  markRetailCalendarDateTable(runtime, base)
  runtime.createTestCell({ kind: 'model', modelId: base.modelId }, timeIntelligenceValidationSpec, 'Time Intelligence Checkpoint')

  const snapshot = runtime.getSnapshot()
  return { notebook: snapshot.notebook, datasets: snapshot.datasets, models: snapshot.models, queries: snapshot.queries }
}

/**
 * Lesson 3 (Sprint 13): starts from a completed Retail Foundations model
 * with Calendar already marked as a Date Table, and teaches classic
 * time-intelligence measures (`SAMEPERIODLASTYEAR`, `DATESYTD`/`TOTALYTD`).
 */
export const timeIntelligenceLesson: BuiltInLesson = {
  definition: {
    id: 'time-intelligence',
    version: 1,
    title: 'Time Intelligence',
    description: 'Compare this year to last year, and this year to date, using a properly marked Date Table.',
    difficulty: 'intermediate',
    estimatedMinutes: 30,
    prerequisites: ['retail-foundations'],
    objectives: [
      'Explain why time intelligence requires a marked Date Table',
      'Create a same-period-last-year measure',
      'Create a year-to-date measure',
      'Build a year-over-year comparison from the two',
    ],
    tags: ['time-intelligence', 'date-table', 'measures'],
    stages: [
      {
        id: 'why-date-tables-matter',
        title: 'Why a marked Date Table matters',
        instructions:
          'Calendar has already been marked as this model’s Date Table using its Date column. Every classic time-intelligence function reads and rewrites the currently visible dates in that specific table — that’s why it has to be marked, not just related.',
        learningObjective: 'Date Table requirement',
        hints: [
          { id: 'hint-1', text: 'Open the model canvas and check Calendar’s Date Table badge.' },
        ],
      },
      {
        id: 'same-period-last-year',
        title: 'Compare to the same period last year',
        instructions:
          'Create a measure named "Revenue LY" that returns Total Revenue for the same dates one year earlier than whatever period is currently filtered.',
        learningObjective: 'SAMEPERIODLASTYEAR',
        hints: [
          { id: 'hint-1', text: 'SAMEPERIODLASTYEAR shifts every currently visible date back one year, then hands that new date set to CALCULATE.' },
          { id: 'hint-2', text: 'Revenue LY = CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))' },
        ],
      },
      {
        id: 'year-to-date',
        title: 'Accumulate year to date',
        instructions:
          'Create a measure named "Revenue YTD" that returns Total Revenue from January 1st of the current year through the last currently visible date.',
        learningObjective: 'DATESYTD / TOTALYTD',
        hints: [
          { id: 'hint-1', text: 'DATESYTD(Calendar[Date]) returns every Date Table row from January 1st through the last visible date.' },
          { id: 'hint-2', text: 'Revenue YTD = TOTALYTD([Total Revenue], Calendar[Date])' },
        ],
      },
      {
        id: 'year-over-year',
        title: 'Build the year-over-year comparison',
        instructions: 'Create a measure named "Revenue YoY" that returns the difference between the current period’s revenue and the same period last year.',
        learningObjective: 'YoY thinking',
        hints: [{ id: 'hint-1', text: 'Revenue YoY = [Total Revenue] - [Revenue LY]' }],
      },
      {
        id: 'verify',
        title: 'Verify across two periods',
        instructions: 'Run the Time Intelligence checkpoint. It checks Revenue LY, Revenue YTD, and Revenue YoY under two different month/year filters.',
        learningObjective: 'Time-intelligence correctness',
        checkpointValidationId: timeIntelligenceValidationSpec.id,
      },
    ],
    solution: {
      explanation:
        'Every classic time-intelligence function operates on the Date Table’s currently visible dates, then hands the shifted date set to CALCULATE as a filter. SAMEPERIODLASTYEAR shifts every visible date back one year; DATESYTD/TOTALYTD expand to January 1st through the last visible date. Because the Retail Calendar only starts in 2024, any 2024 period has no prior year to compare against and correctly returns BLANK.',
      keyPoints: [
        'Time-intelligence functions require a column that has been explicitly marked as a Date Table — a plain relationship to a date column is not enough.',
        'SAMEPERIODLASTYEAR keeps the same month/day range, just one year earlier; it is not the same as PREVIOUSYEAR, which returns the entire prior year.',
        'TOTALYTD([measure], Calendar[Date]) and CALCULATE([measure], DATESYTD(Calendar[Date])) are the same computation, just two ways of writing it.',
      ],
      exampleExpressions: [
        'Revenue LY = CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))',
        'Revenue YTD = TOTALYTD([Total Revenue], Calendar[Date])',
        'Revenue YoY = [Total Revenue] - [Revenue LY]',
      ],
    },
  },
  initialize,
}
