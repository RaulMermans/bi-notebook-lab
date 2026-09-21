import { describe, expect, it } from 'vitest'
import type { TestCell } from '../../../src/domain/notebook'
import { createCalculatedColumn } from '../../../src/runtime/calculatedColumn/calculatedColumnRuntime'
import { createMeasure, updateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { moveTable, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'
import { isValidationRunStale } from '../../../src/runtime/validation/fingerprint'
import { runValidation } from '../../../src/runtime/validation/validationEngine'
import { addRetailFoundationsSolution, buildRetailModel } from './helpers'
import { retailFoundationsValidationSpec } from '../../../src/data/exercises/retailFoundationsValidation'

function testCellFor(modelId: string): TestCell {
  return { id: 'test-cell', kind: 'test', title: 'Retail Foundations', modelId, validation: retailFoundationsValidationSpec }
}

describe('validation staleness', () => {
  it('a freshly-run result is current against the same semantic state', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const models = { [solved.id]: solved }
    const cell = testCellFor(solved.id)

    const run = runValidation({ datasets, models }, cell)
    expect(isValidationRunStale(run, solved, datasets, cell.validation)).toBe(false)
  })

  it('becomes stale after editing a measure expression', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const cell = testCellFor(solved.id)
    const run = runValidation({ datasets, models: { [solved.id]: solved } }, cell)

    const revenueMeasure = solved.measures.find((m) => m.name === 'Total Revenue')!
    const edited = updateMeasure(solved, datasets, revenueMeasure.id, { expression: 'SUM(Sales[Revenue]) + 0' }).model

    expect(isValidationRunStale(run, edited, datasets, cell.validation)).toBe(true)
  })

  it('becomes stale after toggling a relationship', () => {
    const { model, datasets, salesTableId, productRelationshipId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const cell = testCellFor(solved.id)
    const run = runValidation({ datasets, models: { [solved.id]: solved } }, cell)

    const { model: toggled } = setRelationshipActive(solved, productRelationshipId, false)
    expect(isValidationRunStale(run, toggled, datasets, cell.validation)).toBe(true)
  })

  it('becomes stale after adding a calculated column', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const cell = testCellFor(solved.id)
    const run = runValidation({ datasets, models: { [solved.id]: solved } }, cell)

    const withExtra = createCalculatedColumn(solved, datasets, { modelTableId: salesTableId, name: 'Extra', expression: 'Sales[Revenue] * 2' }).model
    expect(isValidationRunStale(run, withExtra, datasets, cell.validation)).toBe(true)
  })

  it('does NOT become stale after moving a model table on the canvas', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const cell = testCellFor(solved.id)
    const run = runValidation({ datasets, models: { [solved.id]: solved } }, cell)

    const moved = moveTable(solved, salesTableId, { x: 400, y: 250 })
    expect(isValidationRunStale(run, moved, datasets, cell.validation)).toBe(false)
  })
})
