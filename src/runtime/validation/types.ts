import type { ValidationEvidence, ValidationFeedback, ValidationRuleStatus } from '../../domain/validation'

/**
 * The common shape every rule evaluator (`structuralValidation.ts`,
 * `measureValidation.ts`, ...) returns. `validationEngine.ts` wraps this
 * with the rule's static `id`/`title`/`points`/`required` to build the
 * public `ValidationRuleResult`.
 */
export interface RuleEvaluationResult {
  status: ValidationRuleStatus
  pointsEarned: number
  feedback: ValidationFeedback[]
  evidence?: ValidationEvidence
}
