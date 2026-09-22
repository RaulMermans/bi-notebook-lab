import { describe, expect, it } from 'vitest'
import { primaryTable } from '../../../src/domain/data'
import type { TestCell } from '../../../src/domain/notebook'
import { powerQueryLesson } from '../../../src/data/lessons/powerQueryLesson'
import { NotebookRuntime } from '../../../src/runtime/notebook/notebookRuntime'
import { isLessonComplete, createLessonAttemptFromCheckpointRuns } from '../../../src/runtime/learning/lessonProgress'
import { runValidation } from '../../../src/runtime/validation/validationEngine'
import type { ValidationRun } from '../../../src/domain/validation'

function checkpointCellsByStageId(testCells: TestCell[], validationIds: { stageId: string; checkpointValidationId: string }[]) {
  const map: Record<string, TestCell> = {}
  for (const { stageId, checkpointValidationId } of validationIds) {
    map[stageId] = testCells.find((c) => c.validation.id === checkpointValidationId)!
  }
  return map
}

/**
 * Full headless run of the Sprint 14 Power Query lesson, driving the real
 * `NotebookRuntime`/query runtime/Validation Engine/Learning System — never
 * constructing a `QueryEvaluation` directly (sprint brief "Full Power Query
 * Lesson Test"). Proves: the initial state fails every checkpoint, partial
 * work passes only the matching checkpoint, and the complete solution
 * passes all four and would record one aggregated `LessonAttempt`.
 */
describe('Power Query lesson — full headless run', () => {
  it('drives the actual lesson end to end through NotebookRuntime + Validation Engine', () => {
    const state = powerQueryLesson.initialize()
    const runtime = new NotebookRuntime({ notebook: state.notebook, datasets: state.datasets, models: state.models, queries: state.queries ?? {}, queryEvaluations: {} })
    runtime.refreshQueries()

    const testCells = state.notebook.cells.filter((cell): cell is TestCell => cell.kind === 'test')
    const stages = powerQueryLesson.definition.stages.filter((s) => s.checkpointValidationId)
    const cellByStage = checkpointCellsByStageId(
      testCells,
      stages.map((s) => ({ stageId: s.id, checkpointValidationId: s.checkpointValidationId! })),
    )

    const queries = Object.values(runtime.getSnapshot().queries)
    const customersQueryId = queries.find((q) => q.name === 'Customers_Clean')!.id
    const targetsQueryId = queries.find((q) => q.name === 'Monthly_Targets_Long')!.id
    const salesQueryId = queries.find((q) => q.name === 'Sales_Clean')!.id
    const salesFebQueryId = queries.find((q) => q.name === 'Sales_Feb')!.id

    function runAll(): Record<string, ValidationRun> {
      const snapshot = runtime.getSnapshot()
      const runs: Record<string, ValidationRun> = {}
      for (const stage of stages) runs[stage.id] = runValidation(snapshot, cellByStage[stage.id])
      return runs
    }

    // --- Initial state: nothing passes -----------------------------------
    const initialRuns = runAll()
    for (const stage of stages) expect(initialRuns[stage.id].passed, `stage ${stage.id} should not pass yet`).toBe(false)

    // --- Stage: Clean Customers -------------------------------------------
    const customersDs = Object.values(state.datasets).find((d) => d.name === 'Customers_Dirty')!
    const customerIdCol = customersDs.tables[0].columns.find((c) => c.name === 'customer_id')!

    runtime.addQueryStep(customersQueryId, { kind: 'filter-rows', logic: 'and', conditions: [{ columnId: customerIdCol.id, operator: 'is-not-blank' }] })
    runtime.addQueryStep(customersQueryId, { kind: 'remove-duplicates' })
    runtime.addQueryStep(customersQueryId, { kind: 'change-type', changes: [{ columnId: customerIdCol.id, dataType: 'integer' }] })
    runtime.addQueryStep(customersQueryId, { kind: 'rename-columns', renames: [{ columnId: customerIdCol.id, newName: 'CustomerID' }] })

    const afterCustomers = runAll()
    expect(afterCustomers['clean-customers'].passed).toBe(true)
    expect(afterCustomers['reshape-monthly-targets'].passed).toBe(false)
    expect(afterCustomers['analytical-columns'].passed).toBe(false)
    expect(afterCustomers['prepare-model-ready-output'].passed).toBe(false)

    // --- Stage: Reshape monthly targets -------------------------------------
    const targetsDs = Object.values(state.datasets).find((d) => d.name === 'Monthly_Targets_Wide')!
    const monthColumnIds = ['Jan', 'Feb', 'Mar', 'Apr'].map((name) => targetsDs.tables[0].columns.find((c) => c.name === name)!.id)

    runtime.addQueryStep(targetsQueryId, {
      kind: 'unpivot-columns',
      mode: 'selected',
      columnIds: monthColumnIds,
      attributeColumnName: 'Month',
      valueColumnName: 'Target',
    })

    const afterTargets = runAll()
    expect(afterTargets['clean-customers'].passed).toBe(true)
    expect(afterTargets['reshape-monthly-targets'].passed).toBe(true)
    expect(afterTargets['analytical-columns'].passed).toBe(false)
    expect(afterTargets['prepare-model-ready-output'].passed).toBe(false)

    // --- Stage: Analytical columns ------------------------------------------
    const salesJanDs = Object.values(state.datasets).find((d) => d.name === 'Sales_Jan')!
    const salesFebDs = Object.values(state.datasets).find((d) => d.name === 'Sales_Feb')!
    const columnNames = [...new Set([...salesJanDs.tables[0].columns.map((c) => c.name), ...salesFebDs.tables[0].columns.map((c) => c.name)])]

    runtime.addQueryStep(salesQueryId, {
      kind: 'append-queries',
      sources: [{ kind: 'query', queryId: salesFebQueryId }],
      columnNames,
    })

    const postAppendOutput = runtime.getSnapshot().queryEvaluations[salesQueryId]!.output!
    const postAppendColumns = primaryTable(postAppendOutput).columns
    const revenueColumnId = postAppendColumns.find((c) => c.name === 'Revenue')!.id

    runtime.addQueryStep(salesQueryId, {
      kind: 'conditional-column',
      outputName: 'RevenueBand',
      clauses: [
        { columnId: revenueColumnId, operator: 'greater-than-or-equal', value: 300, result: 'High' },
        { columnId: revenueColumnId, operator: 'greater-than-or-equal', value: 100, result: 'Medium' },
      ],
      elseValue: 'Low',
    })
    runtime.addQueryStep(salesQueryId, { kind: 'custom-column', outputName: 'RevenuePerUnit', expression: '[Revenue] / [Quantity]' })

    const afterSales = runAll()
    expect(runtime.getSnapshot().queryEvaluations[salesQueryId]!.status, 'Sales_Clean should evaluate without error').toBe('success')
    expect(afterSales['clean-customers'].passed).toBe(true)
    expect(afterSales['reshape-monthly-targets'].passed).toBe(true)
    expect(afterSales['analytical-columns'].passed).toBe(true)
    expect(afterSales['prepare-model-ready-output'].passed).toBe(false)

    // --- Stage: Prepare model-ready output -----------------------------------
    runtime.setQueryLoadEnabled(customersQueryId, true)
    runtime.setQueryLoadEnabled(targetsQueryId, true)
    runtime.setQueryLoadEnabled(salesQueryId, true)

    const final = runAll()
    for (const stage of stages) expect(final[stage.id].passed, `stage ${stage.id} should pass once the lesson is complete`).toBe(true)

    const runsByValidationId: Record<string, ValidationRun> = {}
    const staleByValidationId: Record<string, boolean> = {}
    for (const stage of stages) {
      runsByValidationId[stage.checkpointValidationId!] = final[stage.id]
      staleByValidationId[stage.checkpointValidationId!] = false
    }
    expect(isLessonComplete(powerQueryLesson.definition.stages, runsByValidationId, staleByValidationId)).toBe(true)

    const attempt = createLessonAttemptFromCheckpointRuns({
      lessonId: powerQueryLesson.definition.id,
      lessonVersion: powerQueryLesson.definition.version,
      startedAt: new Date().toISOString(),
      runs: Object.values(final),
      hintsUsed: 0,
    })
    expect(attempt.passed).toBe(true)
    expect(attempt.percentage).toBe(100)
    expect(attempt.pointsPossible).toBe(400) // 4 checkpoints × 100 points each
  })
})
