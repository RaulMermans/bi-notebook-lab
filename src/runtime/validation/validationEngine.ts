import type { Dataset } from '../../domain/data'
import type { TestCell } from '../../domain/notebook'
import type { SemanticModel } from '../../domain/model'
import type { QueryDefinition, QueryEvaluation } from '../../domain/query'
import type { ValidationRule, ValidationRuleResult, ValidationRun } from '../../domain/validation'
import { evaluateCalculatedColumnResultRule } from './calculatedColumnValidation'
import { evaluateDateTableRule } from './dateTableValidationRule'
import { computeValidationFingerprint } from './fingerprint'
import { evaluateMeasureResultRule } from './measureValidation'
import {
  evaluateQueryHealthRule,
  evaluateQueryOutputRowCountRule,
  evaluateQueryOutputSchemaRule,
  evaluateQueryOutputValueRule,
  evaluateQueryPresentRule,
  evaluateQueryStepSemanticsRule,
} from './queryValidation'
import { computeValidationRun } from './scoring'
import { evaluateExpressionSemanticRule } from './semanticValidation'
import { evaluateModelHealthRule, evaluateRelationshipConfigRule, evaluateRelationshipRule, evaluateTablePresenceRule } from './structuralValidation'
import type { RuleEvaluationResult } from './types'

/**
 * Sprint 14: extended with `queries`/`queryEvaluations` so Direct Query
 * Validation rules never need to duplicate the Query Runtime's own
 * evaluation (docs/QUERY_VALIDATION.md). Existing model-only callers are
 * unaffected — every field is still required, but a `'workspace'`-scoped
 * `TestCell` simply never triggers the model-requiring rule branches.
 */
export interface ValidationSnapshot {
  datasets: Record<string, Dataset>
  models: Record<string, SemanticModel>
  queries: Record<string, QueryDefinition>
  queryEvaluations: Record<string, QueryEvaluation>
}

function modelConfigError(rule: ValidationRule): RuleEvaluationResult {
  return {
    status: 'error',
    pointsEarned: 0,
    feedback: [{ severity: 'error', code: 'VALIDATION_CONFIG_ERROR', message: `"${rule.title}" requires a model, but this checkpoint has workspace scope.` }],
  }
}

function evaluateRule(rule: ValidationRule, model: SemanticModel | undefined, snapshot: ValidationSnapshot): RuleEvaluationResult {
  switch (rule.type) {
    case 'relationship':
      return model ? evaluateRelationshipRule(rule, model, snapshot.datasets) : modelConfigError(rule)
    case 'relationship-config':
      return model ? evaluateRelationshipConfigRule(rule, model, snapshot.datasets) : modelConfigError(rule)
    case 'model-health':
      return model ? evaluateModelHealthRule(rule, model, snapshot.datasets) : modelConfigError(rule)
    case 'table-present':
      return model ? evaluateTablePresenceRule(rule, model, snapshot.datasets) : modelConfigError(rule)
    case 'calculated-column-result':
      return model ? evaluateCalculatedColumnResultRule(rule, model, snapshot.datasets) : modelConfigError(rule)
    case 'measure-result':
      return model ? evaluateMeasureResultRule(rule, model, snapshot.datasets) : modelConfigError(rule)
    case 'expression-semantics':
      return model ? evaluateExpressionSemanticRule(rule, model, snapshot.datasets) : modelConfigError(rule)
    case 'date-table':
      return model ? evaluateDateTableRule(rule, model, snapshot.datasets) : modelConfigError(rule)
    case 'query-present':
      return evaluateQueryPresentRule(rule, snapshot.queries)
    case 'query-health':
      return evaluateQueryHealthRule(rule, snapshot.queries, snapshot.queryEvaluations)
    case 'query-output-schema':
      return evaluateQueryOutputSchemaRule(rule, snapshot.queries, snapshot.queryEvaluations)
    case 'query-output-row-count':
      return evaluateQueryOutputRowCountRule(rule, snapshot.queries, snapshot.queryEvaluations)
    case 'query-output-value':
      return evaluateQueryOutputValueRule(rule, snapshot.queries, snapshot.queryEvaluations)
    case 'query-step-semantics':
      return evaluateQueryStepSemanticsRule(rule, snapshot.queries)
  }
}

/**
 * The Sprint 5 entry point: executes every rule in a `TestCell`'s
 * `ValidationSpec` against the current notebook state and returns a scored,
 * fully-explained `ValidationRun`. Pure and framework-free — no persistence
 * side effects, no React dependency (AGENTS.md "keep BI semantics outside
 * React components"). Every rule is graded by running the learner's actual
 * model/columns/measures/queries through the real runtimes; nothing here
 * reimplements aggregation, filter propagation, relationship validation, or
 * query transformation (docs/VALIDATION_ENGINE.md "No independent
 * calculation oracle").
 *
 * Sprint 14: `TestCell.scope` replaces the old `modelId`-only contract.
 * `{ kind: 'model' }` behaves exactly as before (a missing model is still a
 * `VALIDATION_CONFIG_ERROR` for every rule). `{ kind: 'workspace' }` needs no
 * model at all — a query-only checkpoint never has to reference a dummy
 * model (docs/VALIDATION_ENGINE.md "TestCell scope").
 */
export function runValidation(snapshot: ValidationSnapshot, testCell: TestCell): ValidationRun {
  const spec = testCell.validation
  const scope = testCell.scope
  const model = scope.kind === 'model' ? snapshot.models[scope.modelId] : undefined

  if (scope.kind === 'model' && !model) {
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
    const result = evaluateRule(rule, model, snapshot)
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

  const fingerprint = computeValidationFingerprint(snapshot, testCell)
  return computeValidationRun(testCell.id, ruleResults, spec.passingPercentage, fingerprint)
}
