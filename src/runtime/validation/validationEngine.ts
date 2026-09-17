import type { Dataset } from '../../domain/data'
import type { TestCell } from '../../domain/notebook'
import type { SemanticModel } from '../../domain/model'
import type { ValidationRule, ValidationRuleResult, ValidationRun } from '../../domain/validation'
import { evaluateCalculatedColumnResultRule } from './calculatedColumnValidation'
import { computeValidationFingerprint } from './fingerprint'
import { evaluateMeasureResultRule } from './measureValidation'
import { computeValidationRun } from './scoring'
import { evaluateExpressionSemanticRule } from './semanticValidation'
import { evaluateModelHealthRule, evaluateRelationshipRule, evaluateTablePresenceRule } from './structuralValidation'
import type { RuleEvaluationResult } from './types'

export interface ValidationSnapshot {
  datasets: Record<string, Dataset>
  models: Record<string, SemanticModel>
}

function evaluateRule(rule: ValidationRule, model: SemanticModel, datasets: Record<string, Dataset>): RuleEvaluationResult {
  switch (rule.type) {
    case 'relationship':
      return evaluateRelationshipRule(rule, model, datasets)
    case 'model-health':
      return evaluateModelHealthRule(rule, model, datasets)
    case 'table-present':
      return evaluateTablePresenceRule(rule, model, datasets)
    case 'calculated-column-result':
      return evaluateCalculatedColumnResultRule(rule, model, datasets)
    case 'measure-result':
      return evaluateMeasureResultRule(rule, model, datasets)
    case 'expression-semantics':
      return evaluateExpressionSemanticRule(rule, model, datasets)
  }
}

/**
 * The Sprint 5 entry point: executes every rule in a `TestCell`'s
 * `ValidationSpec` against the current notebook state and returns a scored,
 * fully-explained `ValidationRun`. Pure and framework-free — no persistence
 * side effects, no React dependency (AGENTS.md "keep BI semantics outside
 * React components"). Every rule is graded by running the learner's actual
 * model/columns/measures through the real Sprint 1–4 runtimes; nothing here
 * reimplements aggregation, filter propagation, or relationship validation
 * (docs/VALIDATION_ENGINE.md "No independent calculation oracle").
 */
export function runValidation(snapshot: ValidationSnapshot, testCell: TestCell): ValidationRun {
  const spec = testCell.validation
  const model = snapshot.models[testCell.modelId]

  if (!model) {
    const ruleResults: ValidationRuleResult[] = spec.rules.map((rule) => ({
      ruleId: rule.id,
      title: rule.title,
      category: rule.category,
      status: 'error',
      pointsEarned: 0,
      pointsPossible: rule.points,
      required: rule.required ?? false,
      feedback: [{ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message: "This checkpoint's model could not be found." }],
    }))
    return computeValidationRun(testCell.id, ruleResults, spec.passingPercentage, '')
  }

  const ruleResults: ValidationRuleResult[] = spec.rules.map((rule) => {
    const result = evaluateRule(rule, model, snapshot.datasets)
    return {
      ruleId: rule.id,
      title: rule.title,
      category: rule.category,
      status: result.status,
      pointsEarned: result.pointsEarned,
      pointsPossible: rule.points,
      required: rule.required ?? false,
      feedback: result.feedback,
      evidence: result.evidence,
    }
  })

  const fingerprint = computeValidationFingerprint(model, snapshot.datasets, spec)
  return computeValidationRun(testCell.id, ruleResults, spec.passingPercentage, fingerprint)
}
