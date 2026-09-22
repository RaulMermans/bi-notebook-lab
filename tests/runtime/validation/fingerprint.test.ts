import { describe, expect, it } from 'vitest'
import type { TestCell } from '../../../src/domain/notebook'
import type { ValidationSnapshot } from '../../../src/runtime/validation/validationEngine'
import { createCalculatedColumn } from '../../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { createMeasure, updateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { moveTable, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'
import { isValidationRunStale } from '../../../src/runtime/validation/fingerprint'
import { runValidation } from '../../../src/runtime/validation/validationEngine'
import { addRetailFoundationsSolution, buildRetailModel } from './helpers'
import { retailFoundationsValidationSpec } from '../../../src/data/exercises/retailFoundationsValidation'

function testCellFor(modelId: string): TestCell {
  return { id: 'test-cell', kind: 'test', title: 'Retail Foundations', scope: { kind: 'model', modelId }, validation: retailFoundationsValidationSpec }
}

function snapshotFor(models: ValidationSnapshot['models'], datasets: ValidationSnapshot['datasets']): ValidationSnapshot {
  return { models, datasets, queries: {}, queryEvaluations: {} }
}

describe('validation staleness', () => {
  it('a freshly-run result is current against the same semantic state', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const cell = testCellFor(solved.id)
    const snapshot = snapshotFor({ [solved.id]: solved }, datasets)

    const run = runValidation(snapshot, cell)
    expect(isValidationRunStale(run, snapshot, cell)).toBe(false)
  })

  it('becomes stale after editing a measure expression', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const cell = testCellFor(solved.id)
    const run = runValidation(snapshotFor({ [solved.id]: solved }, datasets), cell)

    const revenueMeasure = solved.measures.find((m) => m.name === 'Total Revenue')!
    const edited = updateMeasure(solved, datasets, revenueMeasure.id, { expression: 'SUM(Sales[Revenue]) + 0' }).model

    expect(isValidationRunStale(run, snapshotFor({ [solved.id]: edited }, datasets), cell)).toBe(true)
  })

  it('becomes stale after toggling a relationship', () => {
    const { model, datasets, salesTableId, productRelationshipId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const cell = testCellFor(solved.id)
    const run = runValidation(snapshotFor({ [solved.id]: solved }, datasets), cell)

    const { model: toggled } = setRelationshipActive(solved, productRelationshipId, false)
    expect(isValidationRunStale(run, snapshotFor({ [solved.id]: toggled }, datasets), cell)).toBe(true)
  })

  it('becomes stale after adding a calculated column', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const cell = testCellFor(solved.id)
    const run = runValidation(snapshotFor({ [solved.id]: solved }, datasets), cell)

    const withExtra = createCalculatedColumn(solved, datasets, { modelTableId: salesTableId, name: 'Extra', expression: 'Sales[Revenue] * 2' }).model
    expect(isValidationRunStale(run, snapshotFor({ [solved.id]: withExtra }, datasets), cell)).toBe(true)
  })

  it('does NOT become stale after moving a model table on the canvas', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const cell = testCellFor(solved.id)
    const run = runValidation(snapshotFor({ [solved.id]: solved }, datasets), cell)

    const moved = moveTable(solved, salesTableId, { x: 400, y: 250 })
    expect(isValidationRunStale(run, snapshotFor({ [solved.id]: moved }, datasets), cell)).toBe(false)
  })
})
