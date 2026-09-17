import type { Dataset } from '../../domain/data'
import type { SemanticModel } from '../../domain/model'
import type { ModelHealthValidationRule, RelationshipValidationRule, TablePresenceValidationRule } from '../../domain/validation'
import { validateModel } from '../model/graphAnalysis'
import { classifySelectorFailure, resolveColumnSelector, resolveTableSelector } from './selectorResolver'
import type { RuleEvaluationResult } from './types'

function configError(message: string): RuleEvaluationResult {
  return { status: 'error', pointsEarned: 0, feedback: [{ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message }] }
}

/**
 * Checks that a specific 1 → * relationship exists between the two named
 * columns, in the right direction, with the expected active state. Reads
 * only `SemanticModel.relationships` — never reimplements relationship
 * validation (see docs/VALIDATION_ENGINE.md "No independent calculation
 * oracle").
 */
export function evaluateRelationshipRule(
  rule: RelationshipValidationRule,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
): RuleEvaluationResult {
  const oneResolution = resolveColumnSelector(model, datasets, rule.one)
  if (!oneResolution.ok) {
    if (classifySelectorFailure(oneResolution.error) === 'failed') {
      return {
        status: 'failed',
        pointsEarned: 0,
        feedback: [{ severity: 'error', code: 'RELATIONSHIP_TABLE_MISSING', message: oneResolution.error.message }],
      }
    }
    return configError(`Relationship rule "${rule.title}": ${oneResolution.error.message}`)
  }

  const manyResolution = resolveColumnSelector(model, datasets, rule.many)
  if (!manyResolution.ok) {
    if (classifySelectorFailure(manyResolution.error) === 'failed') {
      return {
        status: 'failed',
        pointsEarned: 0,
        feedback: [{ severity: 'error', code: 'RELATIONSHIP_TABLE_MISSING', message: manyResolution.error.message }],
      }
    }
    return configError(`Relationship rule "${rule.title}": ${manyResolution.error.message}`)
  }

  const one = oneResolution.value
  const many = manyResolution.value

  const matchesSide = (side: { datasetId: string; tableId: string; columnId: string }, resolved: typeof one) =>
    side.datasetId === resolved.datasetId && side.tableId === resolved.tableId && side.columnId === resolved.columnId

  const forward = model.relationships.find((r) => matchesSide(r.one, one) && matchesSide(r.many, many))
  if (forward) {
    const expectedActive = rule.active ?? true
    if (forward.active !== expectedActive) {
      return {
        status: 'failed',
        pointsEarned: 0,
        feedback: [
          {
            severity: 'error',
            code: 'RELATIONSHIP_WRONG_ACTIVE_STATE',
            message: `The relationship between "${one.tableName}[${one.columnName}]" and "${many.tableName}[${many.columnName}]" exists but is currently ${forward.active ? 'active' : 'inactive'}; it should be ${expectedActive ? 'active' : 'inactive'}.`,
            hint: 'Toggle the relationship\'s active state on the model canvas.',
          },
        ],
        evidence: { relationshipId: forward.id },
      }
    }
    return {
      status: 'passed',
      pointsEarned: rule.points,
      feedback: [{ severity: 'success', code: 'RELATIONSHIP_OK', message: `${rule.title} is correct.` }],
      evidence: { relationshipId: forward.id },
    }
  }

  const reversed = model.relationships.find((r) => matchesSide(r.one, many) && matchesSide(r.many, one))
  if (reversed) {
    return {
      status: 'failed',
      pointsEarned: 0,
      feedback: [
        {
          severity: 'error',
          code: 'RELATIONSHIP_WRONG_DIRECTION',
          message: `A relationship connects "${one.tableName}" and "${many.tableName}", but it runs the wrong way — "${many.tableName}[${many.columnName}]" should be on the "many" side.`,
          hint: 'Delete the relationship and recreate it with the "1" and "many" sides swapped.',
        },
      ],
      evidence: { relationshipId: reversed.id },
    }
  }

  return {
    status: 'failed',
    pointsEarned: 0,
    feedback: [
      {
        severity: 'error',
        code: 'RELATIONSHIP_MISSING',
        message: `No relationship connects "${one.tableName}[${one.columnName}]" (1) to "${many.tableName}[${many.columnName}]" (*) yet.`,
      },
    ],
  }
}

/** Checks model-wide graph diagnostics (cycles, ambiguous paths, star-schema shape) via the real Sprint 2 `validateModel`. */
export function evaluateModelHealthRule(
  rule: ModelHealthValidationRule,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
): RuleEvaluationResult {
  const diagnostics = validateModel(model, datasets)
  const problems: { code: string; message: string }[] = []

  if (rule.requireValidGraph ?? true) {
    for (const d of diagnostics.filter((d) => d.severity === 'error')) {
      problems.push({ code: d.code, message: d.message })
    }
  }

  if (rule.requireStarSchema && !diagnostics.some((d) => d.code === 'STAR_SCHEMA_VALID')) {
    problems.push({ code: 'STAR_SCHEMA_MISSING', message: 'The model does not currently form a valid star schema.' })
  }

  for (const code of rule.forbidDiagnostics ?? []) {
    for (const d of diagnostics.filter((d) => d.code === code)) {
      problems.push({ code: d.code, message: d.message })
    }
  }

  if (problems.length > 0) {
    return {
      status: 'failed',
      pointsEarned: 0,
      feedback: problems.map((p) => ({ severity: 'error' as const, code: p.code, message: p.message })),
      evidence: { diagnostics },
    }
  }

  return {
    status: 'passed',
    pointsEarned: rule.points,
    feedback: [{ severity: 'success', code: 'MODEL_HEALTH_OK', message: `${rule.title} is healthy.` }],
    evidence: { diagnostics },
  }
}

/** Confirms a table (by author selector) has been added to the model — useful for exercises that start earlier in the notebook than a relationship rule would imply. */
export function evaluateTablePresenceRule(
  rule: TablePresenceValidationRule,
  model: SemanticModel,
  datasets: Record<string, Dataset>,
): RuleEvaluationResult {
  const resolution = resolveTableSelector(model, datasets, rule.table)
  if (!resolution.ok) {
    if (classifySelectorFailure(resolution.error) === 'failed') {
      return {
        status: 'failed',
        pointsEarned: 0,
        feedback: [{ severity: 'error', code: 'TABLE_MISSING', message: resolution.error.message }],
      }
    }
    return configError(`Table-presence rule "${rule.title}": ${resolution.error.message}`)
  }

  return {
    status: 'passed',
    pointsEarned: rule.points,
    feedback: [{ severity: 'success', code: 'TABLE_PRESENT', message: `"${rule.table.tableName}" is in the model.` }],
  }
}
