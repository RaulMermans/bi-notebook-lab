import { describe, expect, it } from 'vitest'
import type { TestCell } from '../../../src/domain/notebook'
import { retailFoundationsValidationSpec } from '../../../src/data/exercises/retailFoundationsValidation'
import { generateRetailDataset } from '../../../src/lib/sample/generateRetailDataset'
import { updateMeasure } from '../../../src/runtime/measure/measureRuntime'
import { addTable, createModel, setRelationshipActive } from '../../../src/runtime/model/modelRuntime'
import { runValidation } from '../../../src/runtime/validation/validationEngine'
import { addRetailFoundationsSolution, buildRetailModel } from './helpers'

function cellFor(modelId: string): TestCell {
  return { id: 'checkpoint', kind: 'test', title: 'Retail Foundations', modelId, validation: retailFoundationsValidationSpec }
}

function ruleById(run: ReturnType<typeof runValidation>, id: string) {
  return run.ruleResults.find((r) => r.ruleId === id)!
}

describe('Retail Foundations checkpoint (Sprint 5 end-to-end)', () => {
  it('a complete, correct solution scores 100/100 and PASSES', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const cell = cellFor(solved.id)

    const run = runValidation({ datasets, models: { [solved.id]: solved } }, cell)

    expect(run.percentage).toBeCloseTo(100, 5)
    expect(run.pointsEarned).toBeCloseTo(100, 5)
    expect(run.passed).toBe(true)
    expect(run.ruleResults.every((r) => r.status === 'passed')).toBe(true)
  })

  it('an intentionally incomplete solution (only Customers + Sales, nothing else) receives a partial score without crashing', () => {
    const [customersDs, , salesDs] = generateRetailDataset()
    const datasets = { [customersDs.id]: customersDs, [salesDs.id]: salesDs }
    let model = createModel('Incomplete Retail')
    model = addTable(model, { datasetId: customersDs.id, tableId: customersDs.tables[0].id })
    model = addTable(model, { datasetId: salesDs.id, tableId: salesDs.tables[0].id })

    const cell = cellFor(model.id)
    const run = runValidation({ datasets, models: { [model.id]: model } }, cell)

    expect(run.passed).toBe(false)
    expect(run.pointsEarned).toBe(0)
    expect(run.pointsPossible).toBe(100)
    // No relationships exist at all yet — every rule should report a clear, non-crashing failure.
    expect(run.ruleResults.every((r) => r.status === 'failed' || r.status === 'error')).toBe(true)
  })

  it('disabling the Products relationship lowers the score and fails exactly the relevant rules', () => {
    const { model, datasets, salesTableId, productRelationshipId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const baseline = runValidation({ datasets, models: { [solved.id]: solved } }, cellFor(solved.id))
    expect(baseline.passed).toBe(true)

    const broken = setRelationshipActive(solved, productRelationshipId, false)
    const run = runValidation({ datasets, models: { [broken.id]: broken } }, cellFor(broken.id))

    expect(run.percentage).toBeLessThan(baseline.percentage)
    // Directly broken: the relationship rule itself, and the filtered cases in "Filter behavior"
    // that depend on Products → Sales propagation (Furniture, Spain+Furniture).
    expect(ruleById(run, 'rel-products-sales').status).toBe('failed')
    expect(ruleById(run, 'context-total-revenue').status).toBe('partial')

    // Unrelated rules are unaffected — the failure is localized to what actually broke. A single
    // disabled relationship leaves Products merely isolated, not the graph invalid, so the model
    // still forms a valid (smaller) star schema — this is existing Sprint 2 behavior, not a bug.
    expect(ruleById(run, 'rel-customers-sales').status).toBe('passed')
    expect(ruleById(run, 'rel-calendar-sales').status).toBe('passed')
    expect(ruleById(run, 'model-health').status).toBe('passed')
    expect(ruleById(run, 'margin-column').status).toBe('passed')
    expect(ruleById(run, 'measure-total-revenue').status).toBe('passed')
  })

  it('replacing Total Revenue with a hardcoded literal passes the unfiltered fixture but fails filtered ones — no full credit', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const baseline = runValidation({ datasets, models: { [solved.id]: solved } }, cellFor(solved.id))
    expect(baseline.passed).toBe(true)

    const revenueMeasure = solved.measures.find((m) => m.name === 'Total Revenue')!
    const totalRevenue = datasets[Object.keys(datasets).find((id) => datasets[id].tables[0].name === 'Sales')!]
      .tables[0].rows.reduce((sum, r) => sum + (r.Revenue as number), 0)

    const hardcoded = updateMeasure(solved, datasets, revenueMeasure.id, { expression: String(totalRevenue) }).model
    const run = runValidation({ datasets, models: { [hardcoded.id]: hardcoded } }, cellFor(hardcoded.id))

    expect(ruleById(run, 'measure-total-revenue').status).toBe('passed') // unfiltered case still matches
    expect(ruleById(run, 'context-total-revenue').status).toBe('failed') // every filtered case fails
    expect(ruleById(run, 'context-total-revenue').pointsEarned).toBe(0)
    expect(run.percentage).toBeLessThan(100) // no full credit, even though it isn't necessarily an overall fail
  })

  it('DUPLICATE of the mandatory hardcoded-measure regression, at the full-spec level: never reaches 100%', () => {
    const { model, datasets, salesTableId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const revenueMeasure = solved.measures.find((m) => m.name === 'Total Revenue')!
    const salesDsId = Object.keys(datasets).find((id) => datasets[id].tables[0].name === 'Sales')!
    const totalRevenue = datasets[salesDsId].tables[0].rows.reduce((sum, r) => sum + (r.Revenue as number), 0)

    const hardcoded = updateMeasure(solved, datasets, revenueMeasure.id, { expression: String(totalRevenue) }).model
    const run = runValidation({ datasets, models: { [hardcoded.id]: hardcoded } }, cellFor(hardcoded.id))

    expect(run.pointsEarned).toBeLessThan(run.pointsPossible)
  })

  it('re-enabling a disabled relationship restores the full score', () => {
    const { model, datasets, salesTableId, productRelationshipId } = buildRetailModel()
    const solved = addRetailFoundationsSolution(model, datasets, salesTableId)
    const disabled = setRelationshipActive(solved, productRelationshipId, false)
    const reenabled = setRelationshipActive(disabled, productRelationshipId, true)

    const run = runValidation({ datasets, models: { [reenabled.id]: reenabled } }, cellFor(reenabled.id))
    expect(run.percentage).toBeCloseTo(100, 5)
    expect(run.passed).toBe(true)
  })
})
