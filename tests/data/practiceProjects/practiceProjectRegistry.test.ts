import { describe, expect, it } from 'vitest'
import { getPracticeProject, listPracticeProjects } from '../../../src/data/practiceProjects/practiceProjectRegistry'
import { validateWorkspaceIntegrity } from '../../../src/runtime/integrity/workspaceIntegrity'

describe('practiceProjectRegistry', () => {
  it('registers four practice projects with unique ids', () => {
    const ids = listPracticeProjects().map((project) => project.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(['practice-retail-modeling', 'practice-dax-playground', 'practice-power-query-cleaning', 'practice-filter-context-lab'])
  })

  it('looks up a project by id, and returns undefined for an unknown id', () => {
    expect(getPracticeProject('practice-retail-modeling')?.title).toBe('Retail Modeling')
    expect(getPracticeProject('does-not-exist')).toBeUndefined()
  })

  it('every project initializes into a workspace-integrity-clean starting state', () => {
    for (const project of listPracticeProjects()) {
      const initial = project.initialize()
      const report = validateWorkspaceIntegrity({
        notebook: initial.notebook,
        datasets: initial.datasets,
        models: initial.models,
        queries: initial.queries ?? {},
        queryEvaluations: {},
      })
      expect(report.valid, `${project.id}: ${report.issues.map((i) => i.reason).join('; ')}`).toBe(true)
      expect(initial.notebook.cells.length).toBeGreaterThan(0)
    }
  })

  it('starting the same template twice never shares ids (template isolation, brief §13)', () => {
    for (const project of listPracticeProjects()) {
      const first = project.initialize()
      const second = project.initialize()
      expect(first.notebook.id).not.toBe(second.notebook.id)
      expect(Object.keys(first.datasets).some((id) => id in second.datasets)).toBe(false)
      expect(Object.keys(first.models).some((id) => id in second.models)).toBe(false)
    }
  })
})
