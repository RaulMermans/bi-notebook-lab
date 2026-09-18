import type { ComparisonOperator } from './ast'

/**
 * Documented blank-comparison semantics for the bounded Sprint 8 boolean
 * subset (sprint brief §10 "Document exact blank comparison semantics"):
 *
 * - `=`:  BLANK = BLANK is true; BLANK = anything-else is false. No implicit
 *   coercion of blank to 0/"" the way some real-DAX contexts do.
 * - `<>`: the exact negation of `=` above.
 * - `> >= < <=`: any comparison involving a blank operand is **never true**
 *   (a blank never satisfies a relational comparison) — this is simpler than
 *   real DAX's blank-coercion rules and is a documented incompatibility (see
 *   docs/CALCULATE.md "Known limitations").
 * - Comparing two non-blank values of **different JS types** never coerces
 *   (sprint brief §52 "do not silently coerce arbitrary strings to
 *   numbers"): `=` is false, `<>` is true, relational operators are false.
 *
 * A pure, model-free utility shared by CALCULATE/FILTER boolean predicates
 * (`runtime/measure/booleanFilter.ts`), calculated-column comparisons
 * (`expression/evaluator.ts`), measure comparisons (`runtime/measure/
 * measureEvaluator.ts`), iterator row expressions and `SWITCH` (`runtime/
 * iterator/iteratorEvaluator.ts`) — one implementation, not five.
 */
export function compareScalarValues(operator: ComparisonOperator, left: unknown, right: unknown): boolean {
  const leftBlank = left === null || left === undefined
  const rightBlank = right === null || right === undefined

  if (leftBlank || rightBlank) {
    if (operator === '=') return leftBlank && rightBlank
    if (operator === '<>') return !(leftBlank && rightBlank)
    return false
  }

  if (typeof left !== typeof right) {
    if (operator === '=') return false
    if (operator === '<>') return true
    return false
  }

  switch (operator) {
    case '=':
      return left === right
    case '<>':
      return left !== right
    case '>':
      return (left as number | string) > (right as number | string)
    case '>=':
      return (left as number | string) >= (right as number | string)
    case '<':
      return (left as number | string) < (right as number | string)
    case '<=':
      return (left as number | string) <= (right as number | string)
  }
}
