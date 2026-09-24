import type { PracticeProjectDefinition } from '../../domain/practiceProject'
import { daxPlaygroundProject } from './daxPlaygroundProject'
import { filterContextLabProject } from './filterContextLabProject'
import { powerQueryCleaningProject } from './powerQueryCleaningProject'
import { retailModelingProject } from './retailModelingProject'

/**
 * The code-owned Practice Project registry (Sprint 16 Part B), mirroring
 * `lessonRegistry.ts` exactly — plain factory objects, no JSON/DSL bundle
 * format. Practice Projects are free-experimentation starting points shown
 * in Free Lab; they are never scored and have nothing to do with the
 * Learning System's lesson registry.
 */
const PRACTICE_PROJECTS: PracticeProjectDefinition[] = [retailModelingProject, daxPlaygroundProject, powerQueryCleaningProject, filterContextLabProject]

const duplicateIds = PRACTICE_PROJECTS.map((project) => project.id).filter((id, index, ids) => ids.indexOf(id) !== index)
if (duplicateIds.length > 0) {
  throw new Error(`Duplicate practice project id(s): ${duplicateIds.join(', ')}`)
}

export function listPracticeProjects(): PracticeProjectDefinition[] {
  return PRACTICE_PROJECTS
}

export function getPracticeProject(id: string): PracticeProjectDefinition | undefined {
  return PRACTICE_PROJECTS.find((project) => project.id === id)
}
