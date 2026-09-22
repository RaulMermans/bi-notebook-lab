# Custom Column Expression Subsystem (Sprint 14)

Custom Column (`domain/query.ts#CustomColumnStep`) is the one Applied Step
whose configuration carries free-form source text:

```ts
interface CustomColumnStep extends BaseQueryStep {
  kind: 'custom-column'
  outputColumnId: string
  outputName: string
  expression: string
}
```

Every other step in the Applied Steps set is pure structured configuration
— column ids, operators, literal values (`docs/APPLIED_STEPS.md`). A raw
string field is the one place in the whole Power Query runtime that could
plausibly look like an opening for "just parse M." It is not. This document
is the full reference for what `expression` actually is: a small, bounded,
hand-written scalar-expression language, implemented under
`src/runtime/query/expression/`, with its own grammar, its own function
set, and an explicit non-goal list. See
[`docs/POWER_QUERY_RUNTIME.md`](./POWER_QUERY_RUNTIME.md) "M-language
boundary" for how this fits into the wider Power Query architecture, and
[`docs/APPLIED_STEPS.md`](./APPLIED_STEPS.md) "Custom Column" for the step
itself.

## Why this is a new subsystem, not a reuse of `expression/*`

The DAX expression engine (`src/expression/*`) already exists, is already
battle-tested (Sprints 3–11), and already has a lexer/parser/binder/
evaluator/trace pipeline. Custom Column deliberately does **not** reuse it.
The two languages solve different problems with different semantics:

- DAX expressions bind against a `SemanticModel` (tables, relationships,
  measures, row/filter context). A Custom Column expression binds against a
  single `QueryFrame`'s columns — there is no model, no relationship
  traversal, no aggregation, no context transition.
- DAX's `RELATED`, `CALCULATE`, iterators, and time intelligence have no
  Power Query equivalent and would be meaningless here.
- Power Query's own M has `let/in`, records, lists, `each`, and
  query-folding semantics that don't exist in DAX either.

Reusing `expression/*` would mean either dragging DAX-only concepts into
Power Query, or silently forking `expression/*` under a shared name until
the two inevitably diverge in confusing ways. A distinct, smaller subsystem
with its own file (`runtime/query/expression/`) keeps both boundaries
honest — this is the same reasoning `docs/POWER_QUERY_RUNTIME.md`
"M-language boundary" already applies to the DAX engine vs. M itself, just
one layer further down.

## Pipeline

```text
source text (CustomColumnStep.expression)
     │
     ▼  tokenize()          lexer.ts    — never on a persisted AST
     ▼  parseExpression()   parser.ts   — recursive descent → ExprNode
     ▼  bindExpression()    binder.ts   — ExprNode + columns → BoundExprNode
     ▼  evaluateBoundExpression()  evaluator.ts  — BoundExprNode + row → value
```

`steps/customColumn.ts` runs all four stages **fresh, on every
evaluation** — nothing is cached or persisted beyond the source string
itself. This is a deliberate simplicity choice, not an oversight: parsing a
short scalar expression is cheap, and persisting a bound/serialized AST
would mean keeping that serialization format in sync with the grammar
forever. The one thing that *is* reused across rows within a single
evaluation is the bind step — `bindExpression` runs once per step
evaluation (not once per row), and `evaluateBoundExpression` then runs once
per row against the same bound tree.

A failure at any stage fails the **entire step** (the Step Failure
Boundary, `docs/POWER_QUERY_RUNTIME.md` "Evaluation architecture") — Custom
Column never partially applies some rows and skips others.

## Grammar

A small, non-M scalar grammar, roughly (informal EBNF; see `parser.ts` for
the authoritative recursive-descent implementation):

```text
expr        := comparison
comparison  := concat ( ( "=" | "<>" | ">" | ">=" | "<" | "<=" ) concat )*
concat      := additive ( "&" additive )*
additive    := multiplicative ( ( "+" | "-" ) multiplicative )*
multiplicative := unary ( ( "*" | "/" ) unary )*
unary       := "-" unary | primary
primary     := number | string | column | boolean | "null"
             | "if" expr "then" expr "else" expr
             | "(" expr ")"
             | call
call        := identifier ( "." identifier )? "(" ( expr ( "," expr )* )? ")"
column      := "[" identifier "]"
```

Precedence, loosest to tightest: **comparison < concatenation (`&`) <
additive (`+`/`-`) < multiplicative (`*`/`/`) < unary (`-`)**. This is a
deliberate choice, not an M/DAX default: comparison sits loosest so
`[Revenue] > 100 & " units"` style expressions don't need parentheses
around the arithmetic, and `&` sits looser than `+`/`-` so `"Total: " &
[Revenue] + [Tax]` reads as `"Total: " & ([Revenue] + [Tax])`, matching how
a learner coming from Excel/M would expect string-building around a
computed number to read.

`if...then...else` parses its branches at comparison precedence
(`parseComparison`), so `if [A] then [B] else [C]` and `if [A] > 0 then
[B] & "x" else [C]` both work without extra parentheses; nesting the
`else` branch with another `if` gives an else-if chain for free (it's just
recursion, not a special "else if" grammar rule):

```text
if [Revenue] >= 300 then "High"
else if [Revenue] >= 100 then "Medium"
else "Low"
```

### Literals and references

- **Numbers**: `123`, `12.5`, `.5` — integer or decimal, always base 10.
- **Strings**: `"quoted"`, with `\` as the escape character (`\"` for a
  literal quote inside a string).
- **`true` / `false` / `null`**: keywords, not identifiers — `null` binds
  to the same blank semantics the rest of the query runtime uses (nullable
  output, `& `-concatenation treats it as empty text).
- **`[Column]`**: a column reference by name (case-insensitive at bind
  time). Brackets are the *only* column syntax — there is no bare-identifier
  column reference, so a function name and a column name can never be
  ambiguous to the parser.
- **Dotted identifiers**: `Text.Trim`, `Number.Round`, `Date.Year` — the
  lexer tokenizes `identifier "." identifier` as two tokens (`identifier`,
  `dot`, `identifier`), and the parser's `parseCall` joins them into one
  function name string. This is purely a naming convention (mirroring
  Power Query's own `Category.Function` naming), not a real namespace/
  module system — there's no way to define a new one.

### Operators

`+ - * /` (arithmetic, numeric operands only), `&` (text concatenation —
`null` coerces to empty text on either side, matching Power Query's own
`&` blank-handling), `= <> > >= < <=` (comparison — `>`/`>=`/`<`/`<=`
reject a `null` operand outright rather than guessing an ordering; `=`/`<>`
treat two `null`s as equal to each other).

## Binder (`binder.ts`)

`bindExpression(ast, columns, stepId)` walks the unbound `ExprNode` tree and
produces a `BoundExprNode` tree plus a `QueryDiagnostic[]`:

- Every `{ kind: 'column'; name }` node resolves `name` against `columns`
  (the input `QueryFrame`'s `DataColumn[]`) case-insensitively and is
  replaced by `{ kind: 'column'; name; columnId }`. This is the same
  "resolve to a stable id at bind time, never re-resolve by name at
  evaluation time" pattern used everywhere else in the query runtime
  (`docs/POWER_QUERY_RUNTIME.md` "Stable identity") — it's what makes
  renaming an upstream column safe as long as the Custom Column step
  itself is re-applied against the new schema (a rename that removes the
  referenced column outright still correctly fails with
  `QUERY_CUSTOM_COLUMN_NOT_FOUND`). An unresolved reference produces that
  diagnostic and leaves the surrounding tree unbindable (`bind()` returns
  `undefined` up the call stack).
- Every `{ kind: 'call'; functionName }` node is checked against
  `CUSTOM_COLUMN_FUNCTIONS` (see "Function set" below) for existence and
  arity (`minArgs`/`maxArgs`); a violation produces
  `QUERY_CUSTOM_PARSE_ERROR` with a specific message ("expects 1-2
  argument(s), got 3") rather than a generic failure.

## Evaluator (`evaluator.ts`) — the "never `eval`" property

`evaluateBoundExpression(node, row)` is a **plain recursive tree-walk**
over the bound AST — a `switch` on `node.kind` that recurses into children
and combines their results. There is no `eval()`, no `new Function()`, no
string-templating a value into executable code at any point in this
pipeline. This isn't a performance choice; it's a safety property: the
learner's expression text can never influence what JavaScript actually
executes beyond "which pre-defined AST-walking branch runs, with which
already-typed operand values." A malicious or malformed expression can
produce a wrong value or a thrown `ExpressionEvalError` — it can never
reach arbitrary code execution, because there is no code path from parsed
text to `Function`/`eval`/`vm` anywhere in `runtime/query/expression/`.

Type-checking is enforced at evaluation time, per operation, per row (not
once, up front) — `toNumber`/`toBoolean`/`toText` in `evaluator.ts` throw a
typed `ExpressionEvalError('QUERY_CUSTOM_TYPE_ERROR', ...)` the moment an
operator/function receives a value of the wrong shape (e.g. `+` on a
string, `if` on a non-boolean condition). Division by zero is its own
distinct code, `QUERY_CUSTOM_DIVIDE_BY_ZERO`, rather than being folded into
the generic type-error path — it's a distinguishable, common-enough
learner mistake to deserve its own message. `ExpressionEvalError`
(`evalError.ts`) is caught exactly once, in `steps/customColumn.ts`, and
turned into a `QueryDiagnostic` that fails the whole step; nothing upstream
of that catch ever sees a raw JS exception.

## Output type inference

A Custom Column's output `DataType` isn't declared anywhere in the step's
config — it's inferred from the values actually produced across every row,
via the same `runtime/query/steps/inferOutputType.ts#inferOutputType`
Conditional Column also uses (`docs/APPLIED_STEPS.md` "Conditional
Column"). Values are bucketed by JS type (`boolean` / `number` / `string` /
other); a single-category numeric result infers `'integer'` when every
produced value is a whole number, or `'decimal'` the moment even one isn't
— the same integer+decimal promotion lattice Conditional Column uses. Any
*other* category mix (e.g. some rows produce text, others numbers) fails
the whole step with `QUERY_CUSTOM_TYPE_ERROR` — a Custom Column is expected
to produce values of one consistent kind, and a learner discovers that
constraint from a diagnostic, not a silently mistyped column.

## Function set

The current, deliberately small `CUSTOM_COLUMN_FUNCTIONS` registry
(`functions.ts`) — not a general M standard-library port:

| Function | Arity | Behavior |
|---|---|---|
| `Text.Trim(text)` | 1 | Trims leading/trailing whitespace. |
| `Text.Upper(text)` | 1 | Uppercases. |
| `Text.Lower(text)` | 1 | Lowercases. |
| `Text.Length(text)` | 1 | String length. |
| `Number.Abs(number)` | 1 | Absolute value. |
| `Number.Round(number, digits?)` | 1–2 | Rounds to `digits` decimal places (default `0`). |
| `Date.Year(date)` | 1 | UTC calendar year. |
| `Date.Month(date)` | 1 | UTC calendar month (1–12). |
| `Date.Day(date)` | 1 | UTC day of month. |

Every argument is type-checked at call time (`asText`/`asNumber`/`asDate`
in `functions.ts`, mirroring the evaluator's own `toNumber`/`toBoolean`/
`toText`), throwing `QUERY_CUSTOM_TYPE_ERROR` on a mismatch — e.g.
`Text.Trim(42)` fails rather than coercing `42` to `"42"`. Adding a new
function means adding one entry to this registry (`minArgs`, `maxArgs`,
`apply`); it never touches the lexer, parser, or binder, since a function
call is already fully general grammar (`identifier ( "." identifier )?
"(" args ")"`).

## Explicitly not supported (the M-language boundary, one level down)

None of the following are parsed — they aren't partially supported or
silently ignored, they simply have no grammar production that produces
them, so writing one is a `QUERY_CUSTOM_PARSE_ERROR`:

- `let ... in ...` — no local-variable/multi-statement expressions.
- Records (`[Field = value, ...]`) or lists (`{1, 2, 3}`) as values —
  `[Name]` is exclusively column-reference syntax here, never a record
  literal.
- `each` / anonymous functions — no way to define a function inline or
  pass one as a value.
- User-defined functions of any kind — the function set is exactly the
  fixed registry above; there is no way for a learner (or a lesson author)
  to add one from expression text.
- External connectors, parameters, credentials, dataflows, or anything
  that would reach outside the current `QueryFrame`.
- Query folding — irrelevant here anyway, since there's no external query
  engine to fold into (`docs/POWER_QUERY_RUNTIME.md` "Known compatibility
  limitations").

A parse failure surfaces as `QUERY_CUSTOM_PARSE_ERROR` (from the lexer,
e.g. an unterminated string; from the parser, e.g. an unexpected token
from one of the constructs above); an unresolved `[Column]` reference is
`QUERY_CUSTOM_COLUMN_NOT_FOUND`. Both are structured `QueryDiagnostic`s,
never a raw thrown JS error surfaced to the learner.

## File layout

```text
runtime/query/expression/
  lexer.ts       tokenize() — numbers, "strings", [Column] refs, true/false/
                 null/if/then/else keywords, operators, dotted identifiers
  ast.ts         ExprNode (unbound) / BoundExprNode (bound) — a discriminated
                 union per node kind, mirroring expression/ast.ts's shape
                 one layer down in complexity
  parser.ts      recursive-descent Parser class + parseExpression() —
                 precedence exactly as described above
  binder.ts      bindExpression(ast, columns, stepId) — resolves [Column]
                 refs to columnId, validates function name/arity
  functions.ts   CUSTOM_COLUMN_FUNCTIONS registry (the table above)
  evaluator.ts   evaluateBoundExpression(node, row) — the tree-walk, never
                 eval/new Function
  evalError.ts   ExpressionEvalError — the one typed exception this
                 subsystem throws, caught exactly once by
                 steps/customColumn.ts
```

`steps/customColumn.ts` (`docs/APPLIED_STEPS.md` "Custom Column") is the
only caller of this pipeline — no other step, and no UI code, imports from
`runtime/query/expression/*` directly except the Applied Steps form's
inline-diagnostic preview (`CustomColumnForm`, `queryStepForms.tsx`), which
re-runs the same tokenize → parse → bind sequence purely to show a live
error message before Apply; it never runs `evaluateBoundExpression` itself,
and its result is never treated as authoritative (the real evaluation
happens again, independently, inside `steps/customColumn.ts`).
