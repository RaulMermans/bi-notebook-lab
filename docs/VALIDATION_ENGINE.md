# Validation Engine

## Goal

Grade BI work by semantics and outcomes rather than by exact source text.

## Validation layers

### 1. Structural

Examples:
- required table exists
- relationship exists
- relationship uses expected columns
- cardinality is valid
- measure has expected name/type

### 2. Numerical

Execute the learner solution against deterministic fixtures and compare outputs.

Examples:
- Total Revenue equals expected value
- measure returns correct result under Spain filter
- calculated column matches expected row values

### 3. Semantic

Where feasible, inspect the parsed expression/plan.

Examples:
- uses aggregation instead of row-by-row duplication
- respects filter context
- does not hardcode the expected answer

### 4. Pedagogical

Return specific feedback:

Bad:
> Incorrect.

Good:
> Your formula returns the correct unfiltered total, but it ignores the current Country filter. Check whether the calculation is using the active filter context.

## Rule

A correct alternative solution should pass if it produces the correct semantics across the validation fixture set.
