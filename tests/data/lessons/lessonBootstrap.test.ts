import { describe, expect, it } from 'vitest'
import { filterContextLesson } from '../../../src/data/lessons/filterContextLesson'
import { retailFoundationsLesson } from '../../../src/data/lessons/retailFoundationsLesson'
import { timeIntelligenceLesson } from '../../../src/data/lessons/timeIntelligenceLesson'
import { runValidation } from '../../../src/runtime/validation/validationEngine'
import type { TestCell } from '../../../src/domain/notebook'

describe('retailFoundationsLesson.initialize()', () => {
  it('imports the four Retail datasets, an empty model with all four tables, and one checkpoint TestCell', () => {
    const state = retailFoundationsLesson.initialize()
    const kinds = state.notebook.cells.map((cell) => cell.kind)
    expect(kinds.filter((k) => k === 'data')).toHaveLength(4)
    expect(kinds.filter((k) => k === 'model')).toHaveLength(1)
    expect(kinds.filter((k) => k === 'test')).toHaveLength(1)

    const model = Object.values(state.models)[0]
    expect(model.tables).toHaveLength(4)
    expect(model.relationships).toHaveLength(0)
    expect(model.calculatedColumns).toHaveLength(0)
    expect(model.measures).toHaveLength(0)
  })

  it('does not pass its own checkpoint on the untouched starting state (nothing built yet)', () => {
    const state = retailFoundationsLesson.initialize()
    const testCell = state.notebook.cells.find((cell): cell is TestCell => cell.kind === 'test')!
    const run = runValidation({ datasets: state.datasets, models: state.models }, testCell)
    expect(run.passed).toBe(false)
    expect(run.percentage).toBeLessThan(70)
  })

  it('mints fresh ids on every call (no shared runtime state between attempts) while producing identical structure', () => {
    const a = retailFoundationsLesson.initialize()
    const b = retailFoundationsLesson.initialize()
    expect(a.notebook.id).not.toBe(b.notebook.id)
    expect(Object.keys(a.models)[0]).not.toBe(Object.keys(b.models)[0])
    expect(a.notebook.cells.map((cell) => cell.kind)).toEqual(b.notebook.cells.map((cell) => cell.kind))
  })
})

describe('filterContextLesson.initialize()', () => {
  it('starts from an already-connected, already-measured Retail model (Lesson 2 teaches CALCULATE, not modeling)', () => {
    const state = filterContextLesson.initialize()
    const model = Object.values(state.models)[0]
    expect(model.relationships).toHaveLength(3)
    expect(model.calculatedColumns.map((c) => c.name)).toEqual(['Margin'])
    expect(model.measures.map((m) => m.name).sort()).toEqual(['Average Order Value', 'Gross Margin', 'Orders', 'Total Cost', 'Total Revenue'])
  })

  it('does not pass its own checkpoint until the CALCULATE measures exist', () => {
    const state = filterContextLesson.initialize()
    const testCell = state.notebook.cells.find((cell): cell is TestCell => cell.kind === 'test')!
    const run = runValidation({ datasets: state.datasets, models: state.models }, testCell)
    expect(run.passed).toBe(false)
  })
})

describe('timeIntelligenceLesson.initialize()', () => {
  it('starts from a completed Retail model with Calendar already marked as a Date Table', () => {
    const state = timeIntelligenceLesson.initialize()
    const model = Object.values(state.models)[0]
    expect(model.relationships).toHaveLength(3)
    expect(model.dateTables).toHaveLength(1)
    expect(model.measures.map((m) => m.name).sort()).toEqual(['Average Order Value', 'Gross Margin', 'Orders', 'Total Cost', 'Total Revenue'])
  })

  it('does not pass its own checkpoint until the time-intelligence measures exist', () => {
    const state = timeIntelligenceLesson.initialize()
    const testCell = state.notebook.cells.find((cell): cell is TestCell => cell.kind === 'test')!
    const run = runValidation({ datasets: state.datasets, models: state.models }, testCell)
    expect(run.passed).toBe(false)
  })
})
