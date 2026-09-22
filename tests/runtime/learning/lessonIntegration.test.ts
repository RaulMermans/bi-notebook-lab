import { describe, expect, it } from 'vitest'
import type { Dataset } from '../../../src/domain/data'
import type { LessonStage } from '../../../src/domain/learning'
import type { TestCell } from '../../../src/domain/notebook'
import type { ValidationRun } from '../../../src/domain/validation'
import { filterContextLesson } from '../../../src/data/lessons/filterContextLesson'
import { retailFoundationsLesson } from '../../../src/data/lessons/retailFoundationsLesson'
import { timeIntelligenceLesson } from '../../../src/data/lessons/timeIntelligenceLesson'
import { isLessonComplete } from '../../../src/runtime/learning/lessonProgress'
import { NotebookRuntime } from '../../../src/runtime/notebook/notebookRuntime'
import { runValidation } from '../../../src/runtime/validation/validationEngine'

function findColumnId(dataset: Dataset, name: string): string {
  return dataset.tables[0].columns.find((c) => c.name === name)!.id
}

function findDataset(datasets: Record<string, Dataset>, name: string): Dataset {
  return Object.values(datasets).find((d) => d.name === name)!
}

function modelIdOf(testCell: TestCell): string {
  if (testCell.scope.kind !== 'model') throw new Error('expected a model-scoped TestCell')
  return testCell.scope.modelId
}

/** These lessons define exactly one checkpoint stage, so `isLessonComplete` needs a single-entry map keyed by that stage's `checkpointValidationId`. */
function singleCheckpointComplete(stages: LessonStage[], run: ValidationRun, isStale: boolean): boolean {
  const validationId = stages.find((s) => s.checkpointValidationId)!.checkpointValidationId!
  return isLessonComplete(stages, { [validationId]: run }, { [validationId]: isStale })
}

/**
 * Full headless scenarios for all three built-in lessons (sprint brief
 * "Lesson Integration Tests"). Each proves the Learning System's
 * orchestration of the *existing* runtime/Validation Engine — not new
 * runtime semantics — and, critically, that this sprint's two new
 * checkpoint fixtures (`filterContextValidation.ts`,
 * `timeIntelligenceValidation.ts`) have correctly hand-computed expected
 * values: if either fixture's independently-computed numbers were wrong,
 * the "complete the lesson" case below would fail to reach 100%.
 */
describe('Retail Foundations lesson integration', () => {
  it('fails on the untouched starting state, then scores 100/100 once the star schema and calculations are complete', () => {
    const state = retailFoundationsLesson.initialize()
    const runtime = new NotebookRuntime({ notebook: state.notebook, datasets: state.datasets, models: state.models, queries: {}, queryEvaluations: {} })
    const testCell = state.notebook.cells.find((cell): cell is TestCell => cell.kind === 'test')!
    const modelId = modelIdOf(testCell)

    const partialRun = runValidation({ datasets: runtime.getSnapshot().datasets, models: runtime.getSnapshot().models, queries: {}, queryEvaluations: {} }, testCell)
    expect(partialRun.passed).toBe(false)
    expect(singleCheckpointComplete(retailFoundationsLesson.definition.stages, partialRun, false)).toBe(false)

    const customersDs = findDataset(state.datasets, 'Customers')
    const productsDs = findDataset(state.datasets, 'Products')
    const salesDs = findDataset(state.datasets, 'Sales')
    const calendarDs = findDataset(state.datasets, 'Calendar')

    function connect(left: Dataset, leftColumn: string, right: Dataset, rightColumn: string) {
      const diagnostics = runtime.createRelationship(modelId, {
        left: { datasetId: left.id, tableId: left.tables[0].id, columnId: findColumnId(left, leftColumn) },
        right: { datasetId: right.id, tableId: right.tables[0].id, columnId: findColumnId(right, rightColumn) },
        cardinality: 'one-to-many',
        oneSide: 'left',
        crossFilterDirection: 'left-to-right',
        active: true,
      })
      expect(diagnostics.some((d) => d.severity === 'error')).toBe(false)
    }

    connect(customersDs, 'CustomerID', salesDs, 'CustomerID')
    connect(productsDs, 'ProductID', salesDs, 'ProductID')
    connect(calendarDs, 'Date', salesDs, 'Date')

    const model = runtime.getModel(modelId)!
    const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

    const columnResult = runtime.createCalculatedColumnCell(modelId, { modelTableId: salesTableId, name: 'Margin', expression: 'Sales[Revenue] - Sales[Cost]' })
    expect(columnResult.diagnostics).toEqual([])

    const measures = [
      { name: 'Total Revenue', expression: 'SUM(Sales[Revenue])' },
      { name: 'Total Cost', expression: 'SUM(Sales[Cost])' },
      { name: 'Gross Margin', expression: '[Total Revenue] - [Total Cost]' },
      { name: 'Orders', expression: 'DISTINCTCOUNT(Sales[OrderID])' },
      { name: 'Average Order Value', expression: 'DIVIDE([Total Revenue], [Orders])' },
    ]
    for (const measure of measures) {
      const result = runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: measure.name, expression: measure.expression })
      expect(result.diagnostics).toEqual([])
    }

    const finalSnapshot = runtime.getSnapshot()
    const finalRun = runValidation({ datasets: finalSnapshot.datasets, models: finalSnapshot.models, queries: {}, queryEvaluations: {} }, testCell)
    expect(finalRun.passed).toBe(true)
    expect(finalRun.percentage).toBe(100)
    expect(singleCheckpointComplete(retailFoundationsLesson.definition.stages, finalRun, false)).toBe(true)
  })
})

describe('Filter Context & CALCULATE lesson integration', () => {
  it('fails until Spain Revenue / Revenue All Countries / Revenue % All Countries exist, then scores 100/100', () => {
    const state = filterContextLesson.initialize()
    const runtime = new NotebookRuntime({ notebook: state.notebook, datasets: state.datasets, models: state.models, queries: {}, queryEvaluations: {} })
    const testCell = state.notebook.cells.find((cell): cell is TestCell => cell.kind === 'test')!
    const modelId = modelIdOf(testCell)

    const partialRun = runValidation({ datasets: state.datasets, models: state.models, queries: {}, queryEvaluations: {} }, testCell)
    expect(partialRun.passed).toBe(false)

    const model = runtime.getModel(modelId)!
    const salesDs = findDataset(state.datasets, 'Sales')
    const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

    const measures = [
      { name: 'Spain Revenue', expression: 'CALCULATE(SUM(Sales[Revenue]), Customers[Country] = "Spain")' },
      { name: 'Revenue All Countries', expression: 'CALCULATE(SUM(Sales[Revenue]), REMOVEFILTERS(Customers))' },
      { name: 'Revenue % All Countries', expression: 'DIVIDE([Total Revenue], [Revenue All Countries]) * 100' },
    ]
    for (const measure of measures) {
      const result = runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: measure.name, expression: measure.expression })
      expect(result.diagnostics).toEqual([])
    }

    const finalSnapshot = runtime.getSnapshot()
    const finalRun = runValidation({ datasets: finalSnapshot.datasets, models: finalSnapshot.models, queries: {}, queryEvaluations: {} }, testCell)
    expect(finalRun.ruleResults.filter((r) => r.status !== 'passed')).toEqual([])
    expect(finalRun.passed).toBe(true)
    expect(finalRun.percentage).toBe(100)
    expect(singleCheckpointComplete(filterContextLesson.definition.stages, finalRun, false)).toBe(true)
  })
})

describe('Time Intelligence lesson integration', () => {
  it('fails until Revenue LY / Revenue YTD / Revenue YoY exist, then scores 100/100 under two different month/year filters', () => {
    const state = timeIntelligenceLesson.initialize()
    const runtime = new NotebookRuntime({ notebook: state.notebook, datasets: state.datasets, models: state.models, queries: {}, queryEvaluations: {} })
    const testCell = state.notebook.cells.find((cell): cell is TestCell => cell.kind === 'test')!
    const modelId = modelIdOf(testCell)

    const partialRun = runValidation({ datasets: state.datasets, models: state.models, queries: {}, queryEvaluations: {} }, testCell)
    expect(partialRun.passed).toBe(false)

    const model = runtime.getModel(modelId)!
    const salesDs = findDataset(state.datasets, 'Sales')
    const salesTableId = model.tables.find((t) => t.datasetId === salesDs.id)!.id

    const measures = [
      { name: 'Revenue LY', expression: 'CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(Calendar[Date]))' },
      { name: 'Revenue YTD', expression: 'TOTALYTD([Total Revenue], Calendar[Date])' },
      { name: 'Revenue YoY', expression: '[Total Revenue] - [Revenue LY]' },
    ]
    for (const measure of measures) {
      const result = runtime.createMeasureCell(modelId, { homeModelTableId: salesTableId, name: measure.name, expression: measure.expression })
      expect(result.diagnostics).toEqual([])
    }

    const finalSnapshot = runtime.getSnapshot()
    const finalRun = runValidation({ datasets: finalSnapshot.datasets, models: finalSnapshot.models, queries: {}, queryEvaluations: {} }, testCell)
    expect(finalRun.ruleResults.filter((r) => r.status !== 'passed')).toEqual([])
    expect(finalRun.passed).toBe(true)
    expect(finalRun.percentage).toBe(100)
    expect(singleCheckpointComplete(timeIntelligenceLesson.definition.stages, finalRun, false)).toBe(true)
  })
})
