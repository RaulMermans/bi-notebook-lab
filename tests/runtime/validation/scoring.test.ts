import { describe, expect, it } from 'vitest'
import type { ValidationRuleResult } from '../../../src/domain/validation'
import { computeNotebookScore, computeValidationRun } from '../../../src/runtime/validation/scoring'

function rule(overrides: Partial<ValidationRuleResult>): ValidationRuleResult {
  return {
    ruleId: 'r', title: 'Rule', status: 'passed', pointsEarned: 10, pointsPossible: 10, required: false, feedback: [],
    ...overrides,
  }
}

describe('computeValidationRun', () => {
  it('scores 100% when every rule passes fully', () => {
    const run = computeValidationRun('test', [rule({}), rule({ ruleId: 'r2' })], 70, 'fp')
    expect(run.percentage).toBe(100)
    expect(run.passed).toBe(true)
  })

  it('computes a mixed partial score across rules', () => {
    const run = computeValidationRun(
      'test',
      [rule({ pointsEarned: 10, pointsPossible: 10 }), rule({ ruleId: 'r2', pointsEarned: 0, pointsPossible: 10, status: 'failed' })],
      70,
      'fp',
    )
    expect(run.percentage).toBe(50)
    expect(run.passed).toBe(false)
  })

  it('supports a rule that itself earned partial credit', () => {
    const run = computeValidationRun('test', [rule({ pointsEarned: 5, pointsPossible: 20, status: 'partial' })], 70, 'fp')
    expect(run.percentage).toBe(25)
  })

  it('passes at exactly the passing threshold', () => {
    const run = computeValidationRun('test', [rule({ pointsEarned: 70, pointsPossible: 100, status: 'partial' })], 70, 'fp')
    expect(run.percentage).toBe(70)
    expect(run.passed).toBe(true)
  })

  it('a failed required rule blocks PASS even above the threshold', () => {
    const run = computeValidationRun(
      'test',
      [rule({ pointsEarned: 90, pointsPossible: 90 }), rule({ ruleId: 'gate', pointsEarned: 0, pointsPossible: 10, status: 'failed', required: true })],
      70,
      'fp',
    )
    expect(run.percentage).toBe(90)
    expect(run.passed).toBe(false)
  })

  it('a required rule that only partially passed still blocks PASS', () => {
    const run = computeValidationRun(
      'test',
      [rule({ ruleId: 'gate', pointsEarned: 5, pointsPossible: 10, status: 'partial', required: true })],
      50,
      'fp',
    )
    expect(run.percentage).toBe(50)
    expect(run.passed).toBe(false)
  })

  it('an error-status rule earns no points and does not crash scoring', () => {
    const run = computeValidationRun('test', [rule({ status: 'error', pointsEarned: 0 })], 70, 'fp')
    expect(run.percentage).toBe(0)
    expect(run.passed).toBe(false)
  })
})

describe('computeNotebookScore', () => {
  it('sums earned/possible points across multiple runs', () => {
    const score = computeNotebookScore([
      computeValidationRun('a', [rule({ pointsEarned: 40, pointsPossible: 40 })], 70, 'fp'),
      computeValidationRun('b', [rule({ pointsEarned: 20, pointsPossible: 60, status: 'partial' })], 70, 'fp'),
    ])
    expect(score.pointsEarned).toBe(60)
    expect(score.pointsPossible).toBe(100)
    expect(score.percentage).toBe(60)
  })

  it('returns 0% with no runs', () => {
    expect(computeNotebookScore([]).percentage).toBe(0)
  })
})
