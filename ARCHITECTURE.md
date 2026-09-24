# Architecture

## High-level model

```text
┌────────────────────────────────────────────────────────────┐
│                       Notebook UI                          │
│                                                            │
│  Data │ Model │ Column │ Measure │ Visual │ Question/Test │
└──────────────────────────────┬─────────────────────────────┘
                               │
                               ▼
┌────────────────────────────────────────────────────────────┐
│                     Notebook Runtime                       │
│  cell ordering · dependencies · execution state · outputs │
└──────────────┬───────────────────┬─────────────────────────┘
               │                   │
               ▼                   ▼
┌──────────────────────┐   ┌──────────────────────────┐
│   BI Semantic Core   │   │    Validation Engine     │
│                      │   │                          │
│ tables               │   │ structural checks        │
│ columns              │   │ numeric/output checks    │
│ relationships        │   │ semantic equivalence     │
│ filter context       │   │ teaching feedback        │
│ expressions          │   │ scoring                  │
└──────────┬───────────┘   └──────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────────────────┐
│                   Power Query Runtime (Sprint 12)           │
│   QueryDefinition · Applied Steps · dependency graph        │
│   → produces an ordinary Dataset; the Semantic Core above   │
│     never imports from this layer                          │
└──────────────────────────────┬───────────────────────────────┘
                               ▼
┌────────────────────────────────────────────────────────────┐
│                      Local Data Layer                      │
│            CSV / XLSX / bundled exercise datasets         │
└────────────────────────────────────────────────────────────┘
```

The Power Query layer sits between the Local Data Layer and the BI
Semantic Core, but the arrow direction matters: it *reads* raw imported
`Dataset`s and *produces* another `Dataset`, which the Semantic Core then
consumes exactly like a raw import — there is no dependency edge running
the other way. See [`docs/POWER_QUERY_RUNTIME.md`](./docs/POWER_QUERY_RUNTIME.md).

## Architectural rule

The UI must never become the source of truth for BI semantics.

All data-model logic lives in the semantic core so the same model can later power:

- notebook execution;
- automated grading;
- context visualizations;
- headless tests;
- saved lessons.

## Major packages/modules

### `domain`
Canonical contracts for notebooks, cells, datasets, models, measures and execution results.

### `runtime`
Executes notebook cells in dependency order and stores outputs.

### `runtime/integrity`
Workspace referential integrity (Sprint 15): pure functions that check every
structural reference a notebook cell/model object/query claims, and a
pre-mutation impact analysis (RESTRICT vs. CASCADE) that every destructive
`NotebookRuntime` mutation method calls internally before mutating. See
[`docs/WORKSPACE_INTEGRITY.md`](./docs/WORKSPACE_INTEGRITY.md).

### `conformance`
The Semantic Conformance Suite (Sprint 15): a corpus of hand-verified DAX
cases run through the real public runtime APIs, independent of the
unit/integration test suite, answering "is the supported DAX subset actually
correct" rather than "does the code do what the tests told it to." See
[`docs/SEMANTIC_CONFORMANCE.md`](./docs/SEMANTIC_CONFORMANCE.md).

### `semantic-core`
Represents tables, relationships, row context, filter context and expression evaluation.

### `validation`
Compares learner work against lesson expectations without relying on string equality.

### `lessons`
Portable lesson definitions: datasets, prompts, expected semantics and tests.
Implemented (Sprint 13) as `src/domain/learning.ts` (contracts) +
`src/data/lessons/` (the code-owned built-in lesson registry and each
lesson's deterministic bootstrap) + `src/runtime/learning/` (session/
progress orchestration, framework-free). See
[`docs/LEARNING_SYSTEM.md`](./docs/LEARNING_SYSTEM.md).

### `ui`
Notebook editor and visual explanations. It consumes domain/runtime contracts; it does not implement BI logic.

## Persistence

Local-first, via IndexedDB (`idb-keyval`):

- lesson definitions: TypeScript fixtures (`src/data/lessons/`), never persisted — code is the source of truth
- the Free Lab notebook: one fixed-key document (`persistence/notebookStore.ts`)
- a lesson's notebook/session/attempt history: keyed by lesson id (`persistence/learningStore.ts`, Sprint 13)
- datasets/models: keyed by their own generated id (`notebookStore.ts`/`modelStore.ts`), shared by the Free Lab and every lesson
- `ValidationRun` (current-state validation truth): never persisted, always recomputed

A database is not required for the first usable version.

## Sprint 1 implementation (Data Runtime)

The layers above are realized concretely as:

```text
components/notebook/   UI: ImportDataPanel, DataCellCard, Table{Preview,Schema,Profile}
runtime/notebook/      NotebookRuntime (pure) + useNotebookRuntime (React + persistence wiring)
runtime/data/          dataRuntime.ts — import orchestration, limits, error surfacing
lib/csv/, lib/excel/   File-format parsing (PapaParse, SheetJS) into a raw header/row grid
lib/profiling/         Type inference, value coercion, column profiling
lib/sample/            Deterministic seeded generator for the built-in retail dataset
domain/data.ts         DataType, DataColumn, DataTable, Dataset contracts
persistence/           IndexedDB notebook + dataset stores (idb-keyval)
```

`NotebookRuntime` holds no framework or persistence code — it is a plain,
synchronously-testable class (`addCell`/`removeCell`/`moveCell`/
`importDataset`/`removeDataset`/`updateCell`, plus the Sprint 2 model actions
below), matching the "keep BI semantics outside React components" guardrail.
See [`docs/DATA_RUNTIME.md`](./docs/DATA_RUNTIME.md) for the full
import/type-inference/persistence design.

## Sprint 2 implementation (Model Runtime)

```text
components/notebook/ModelCellCard.tsx   UI: collapsed summary + expanded canvas/forms
components/notebook/model/              ModelCanvas (React Flow), ModelTableNode,
                                         RelationshipEdge, TableRegistrationPanel,
                                         RelationshipForm, ModelHealthSummary
runtime/model/modelRuntime.ts           Pure functions: create/add/remove table,
                                         create/remove relationship, toggle active,
                                         move table, validateRelationship
runtime/model/graphAnalysis.ts          Cycle detection, ambiguous-path detection,
                                         isolated tables, fact/dimension inference
runtime/model/columnCompatibility.ts    Relationship column type-compatibility matrix
persistence/modelStore.ts               IndexedDB model store, keyed by model.id
domain/model.ts                         TableRef, ColumnRef, ModelTable, Relationship,
                                         SemanticModel, diagnostic contracts
```

`NotebookCell` (in `domain/notebook.ts`) became a discriminated union —
`DataCell | ModelCell | GenericNotebookCell` — so a `DataCell` without a
`datasetId` or a `ModelCell` without a `modelId` cannot be represented.
`modelRuntime.ts` is deliberately a set of pure `(model, ...) => model`
functions rather than a second stateful class: `NotebookRuntime` is the only
`useSyncExternalStore` source the UI subscribes to, and it already owns both
`datasets` and (now) `models`, so its model-related methods are thin
wrappers around the pure functions. See
[`docs/MODEL_RUNTIME.md`](./docs/MODEL_RUNTIME.md) for the full
relationship-validation, graph-diagnostic, and persistence design.

## Sprint 3 implementation (Expression Engine + Calculated Columns)

```text
expression/               Framework-free expression engine, reused by
                           calculated columns now and measures in Sprint 4:
  ast.ts                   Expression AST node contracts + source spans
  lexer.ts, parser.ts      Hand-written tokenizer/parser (no eval/new Function)
  diagnostics.ts           ExpressionDiagnostic contract + codes
  binder.ts                Resolves AST names -> stable ColumnRefs/relationships
  relatedLookup.ts          RELATED relationship resolution + indexed lookup
  evaluator.ts             Executes a bound expression against a RowContext
  rowContext.ts            RowContext contract
  trace.ts                 ExecutionTraceNode contract

runtime/calculatedColumn/  calculatedColumnRuntime.ts: create/update/remove/
                           evaluate/validate a CalculatedColumn (pure
                           functions, same shape as runtime/model/modelRuntime.ts)

components/notebook/       CalculatedColumnCellCard.tsx, CreateCalculatedColumnPanel.tsx
components/notebook/
  calculatedColumn/         ExpressionEditor, CalculatedColumnPreview,
                            RowContextVisualizer

domain/model.ts             CalculatedColumn + SemanticModel.calculatedColumns
domain/notebook.ts           CalculatedColumnCell (real cell kind, not generic)
```

`CalculatedColumn` definitions persist inside `SemanticModel` — no new
persistence store was needed, since `modelStore.ts` already round-trips
the whole model. Execution output (computed values, row errors, traces)
is never persisted; it's recomputed from current model/dataset state on
every render, mirroring how `graphAnalysis.ts#validateModel` is
recomputed rather than cached. See
[`docs/EXPRESSION_ENGINE.md`](./docs/EXPRESSION_ENGINE.md) and
[`docs/CALCULATED_COLUMNS.md`](./docs/CALCULATED_COLUMNS.md) for the full
design.

## Sprint 4 implementation (Measures + Filter Context)

```text
expression/
  ast.ts                    + TableReferenceNode (bare `Sales`, e.g. inside COUNTROWS)
  parser.ts                 accepts a bare identifier as TableReferenceNode instead of a SYNTAX_ERROR
  diagnostics.ts            + measure/filter-context diagnostic codes
  measureBinder.ts          bindMeasureExpression() — a second, parallel binder for measures,
                             sharing the parser/AST/diagnostics/name-resolution helpers from binder.ts
  trace.ts                  + measure-reference | aggregation | filter-context | relationship-propagation

runtime/measure/
  logicalColumn.ts           unifies physical + calculated columns for aggregation binding/evaluation
  filterContext.ts            FilterContext / ColumnFilter contracts
  filterPropagation.ts        resolveFilterContext(): direct filters -> fixed-point 1->* propagation,
                               fails closed on ACTIVE_CYCLE/AMBIGUOUS_PATH
  aggregation.ts               SUM/AVERAGE/MIN/MAX/COUNT/DISTINCTCOUNT/COUNTROWS over visible rows
  dependencyGraph.ts            measure-reference graph + cycle detection (shares lib/graph/cycle.ts
                                 with runtime/model/graphAnalysis.ts's relationship-cycle check)
  measureEvaluator.ts            evaluateMeasure(): recursive evaluation with per-evaluation caches
  measureRuntime.ts               validate/create/update/remove — same shape as calculatedColumnRuntime.ts

runtime/model/graphAnalysis.ts   directedActiveGraph/undirectedActiveEdges exported (were private)
                                  so filterPropagation.ts reuses the same graph builders as the
                                  ACTIVE_CYCLE/AMBIGUOUS_PATH diagnostics, instead of a third one
runtime/model/modelRuntime.ts    + hydrateSemanticModel() for pre-Sprint-4 persisted models

components/notebook/       MeasureCellCard.tsx, CreateMeasurePanel.tsx
components/notebook/
  measure/                  FilterContextPanel, MeasureTraceVisualizer
  shared/TraceTree.tsx      TraceNodeView extracted so calculated-column and measure traces
                            render through one component

domain/model.ts             Measure + SemanticModel.measures
domain/notebook.ts           MeasureCell (real cell kind, promoted out of GenericCellKind)
```

See [`docs/MEASURES.md`](./docs/MEASURES.md) and
[`docs/FILTER_CONTEXT.md`](./docs/FILTER_CONTEXT.md) for the full design:
measure vs. calculated-column semantics, the measure-binding rules,
supported aggregations, dependency/cycle detection, the filter-propagation
algorithm, and execution traces.

## Sprint 5 implementation (Validation Engine)

```text
domain/validation.ts         Author selectors (TableSelector/ColumnSelector/
                              MeasureSelector/CalculatedColumnSelector),
                              NumericTolerance, ValidationScalar,
                              ValidationRule union (6 rule types),
                              ValidationSpec, ValidationRun/ValidationRuleResult
domain/notebook.ts            + TestCell (real cell kind, promoted out of
                               GenericCellKind, mirroring Sprint 3/4's cells)

runtime/validation/
  selectorResolver.ts          author selector -> runtime entity, with
                                structured VALIDATION_TARGET_NOT_FOUND /
                                VALIDATION_TARGET_AMBIGUOUS diagnostics
  scalarComparison.ts           tolerance-aware number/string/boolean/null
                                 comparison
  structuralValidation.ts       relationship / model-health / table-present
                                 rules, over SemanticModel + graphAnalysis.ts
  calculatedColumnValidation.ts row-level result rule, over
                                 calculatedColumnRuntime.ts
  measureValidation.ts          multi-context measure result rule, over
                                 measureRuntime.ts; context-aware feedback
  semanticValidation.ts         AST-level assertions, over expression/parser.ts
  scoring.ts                    weighted partial credit, required-rule
                                 gating, notebook-wide score
  fingerprint.ts                staleness fingerprint (FNV-1a over semantic
                                 model state, excluding canvas position)
  validationEngine.ts           runValidation(): the single entry point,
                                 dispatches each rule to its evaluator

data/exercises/
  retailFoundationsValidation.ts  the first real scored checkpoint (100 pts);
                                   expected values derived independently from
                                   generateRetailDataset()'s raw output

components/notebook/
  TestCellCard.tsx               score bar, PASS/NOT PASSED, per-rule
                                  breakdown grouped by category, staleness
                                  banner
  AddTestCellPanel.tsx           the one predefined "+ Add Retail checkpoint"
                                  creation path (no exercise-authoring UI yet)

runtime/notebook/notebookRuntime.ts   + createTestCell / removeTestCell
App.tsx                                owns the transient
                                        `Record<testCellId, ValidationRun>`
                                        map, derives which runs are current
                                        (non-stale) via isValidationRunStale,
                                        and shows the aggregate notebook score
```

Validation never introduces a second BI engine: every rule evaluator in
`runtime/validation/` is a thin adapter that resolves an author selector
against the current `SemanticModel`/`Dataset` registry, then calls the exact
same `evaluateMeasure`/`evaluateCalculatedColumn`/`validateModel` functions
Sprints 2–4 already built. See
[`docs/VALIDATION_ENGINE.md`](./docs/VALIDATION_ENGINE.md) for the full
selector-resolution, rule-contract, scoring, staleness, and persistence
design — including the mandatory hardcoded-measure regression proof that
motivates multi-context measure validation in the first place.

## Sprint 6 implementation (Context Visualizer)

```text
domain/context.ts               ContextAnalysis, ContextTableState,
                                 ContextRelationshipState, MeasureContextComparison,
                                 ContextFlowStep — a presentation contract, not a
                                 second execution contract

runtime/context/
  contextAnalysis.ts             analyzeMeasureContext(): the single entry point —
                                  composes two evaluateMeasure calls (baseline,
                                  current) and the adapters below
  graphAdapter.ts                buildTableStates / buildRelationshipStates —
                                  adapt ResolvedFilterState into diagram-ready state
  narrative.ts                   buildContextNarrative / buildBeginnerExplanation —
                                  plain-English sequence/prose generated from the
                                  same ResolvedFilterState + execution trace
  comparison.ts                  compareMeasureResults — numeric-only delta/%

runtime/measure/filterPropagation.ts   DirectFilterSummary + modelTableId (the one
                                        additive field Sprint 6 needed; no filtering
                                        behavior changed)

lib/layout/modelLayout.ts       defaultTablePosition() — extracted from
                                 ModelCanvas so the Context Explorer diagram
                                 falls back to the same deterministic grid

components/context/
  ContextExplorer.tsx             top-level surface (measure picker + everything below)
  ContextFilterEditor.tsx         generalized from Sprint 4's FilterContextPanel —
                                   shared by MeasureCellCard and ContextExplorer
  ContextPropagationDiagram.tsx   read-only @xyflow/react graph (reuses ModelCanvas's library)
  ContextTableNode.tsx            table node: visible/total rows, %, state badge
  ContextRelationshipEdge.tsx     relationship edge: 1 → * direction, state, impact
  ContextComparison.tsx           baseline vs. current, delta/%
  ContextDetailsPanel.tsx         table inspector / propagation-step inspector
  ContextFlowNarrative.tsx        Explanation / Step-by-step toggle
  MeasureDependencyTree.tsx       reuses shared TraceNodeView, conditional on dependency
  RowVsFilterContextNote.tsx      static Row Context vs. Filter Context card

components/notebook/ModelCellCard.tsx   + [Model] [Context Explorer] tabs;
                                         both views stay mounted (hidden, not
                                         unmounted) so a filter selection survives
                                         switching tabs to toggle a relationship
components/notebook/TestCellCard.tsx    + a manual "Explore context" pointer next
                                         to a HINT_FILTER_CONTEXT feedback item
                                         (no coupling to Validation Engine state)
```

Every number the Context Explorer renders is read from Sprint 4's own
`ResolvedFilterState`/`MeasureExecution`/`ExecutionTraceNode` — `runtime/
context/*.ts` contains no second filter-propagation algorithm and no second
aggregation function. See
[`docs/CONTEXT_VISUALIZER.md`](./docs/CONTEXT_VISUALIZER.md) for the full
design, including a real pointer-events/accessibility pitfall (React Flow's
edge-label/node wrappers set an inherited `pointer-events: none`) found and
fixed during manual browser verification.

## Sprint 7 implementation (Visual Cells)

```text
domain/visual.ts                VisualSpec union (Kpi/Table/Bar/Line/Slicer),
                                 VISUAL_CARDINALITY_LIMITS
domain/notebook.ts               VisualCell (real cell kind, promoted out of
                                  GenericCellKind, mirroring Sprint 3/4/5's cells)

runtime/visual/
  types.ts                        VisualDiagnostic, VisualDataRow,
                                   VisualQueryResult, KpiQueryResult
  grouping.ts                     getDistinctVisualMembers, evaluateGroupedRows —
                                   the "N members x M measures" mechanism,
                                   reusing evaluateMeasure unmodified
  sorting.ts                      deterministic bar/line sort, blanks always last
  visualQuery.ts                  runKpiVisual/runBarVisual/runLineVisual/
                                   runGroupedTableVisual/runScalarTableVisual
  visualRuntime.ts                 barrel + runTableVisual/runVisualQuery
                                   dispatchers, runSlicerMembers, buildSlicerFilter

runtime/measure/filterContext.ts   + mergeFilterContexts() — the canonical
                                     FilterContext combinator the Visual
                                     Runtime uses to intersect the shared
                                     notebook/slicer context with a grouped
                                     Visual's per-member filter
runtime/notebook/
  useNotebookVisualContext.ts       the shared, transient NotebookVisualContext
                                     (Record<slicerCellId, ColumnFilter>, folded
                                     through mergeFilterContexts) — deliberately
                                     separate from the Context Explorer's filter
                                     state
  notebookRuntime.ts                + createVisualCell/updateVisualCell/
                                     removeVisualCell, mirroring createTestCell

components/visual/
  KpiVisual.tsx, TableVisual.tsx, BarVisual.tsx, LineVisual.tsx,
  SlicerVisual.tsx                  consume only VisualQueryResult/
                                     KpiQueryResult — never SemanticModel/Dataset
  VisualRenderer.tsx                 single dispatch point: spec.type ->
                                      runtime call -> presentation component

components/notebook/
  visual/VisualFieldsForm.tsx        one field-mapping editor shared by create
                                      and edit, per visual type
  AddVisualCellPanel.tsx             creation flow (type -> model -> fields)
  VisualCellCard.tsx                 title/Edit/Delete + VisualRenderer, with
                                      the same edit form used to create it

App.tsx                              owns useNotebookVisualContext() and wires
                                      slicer selections/changes through
                                      NotebookCell to VisualCellCard
```

Every number a Visual Cell shows comes from the unmodified Sprint 4
`evaluateMeasure` — `runtime/visual/*` contains no aggregation function and
no relationship-propagation algorithm of its own, matching the Sprint 6
"runtime-truth reuse" precedent. See
[`docs/VISUAL_CELLS.md`](./docs/VISUAL_CELLS.md) for the full design,
including the `FilterContext` merge semantics, cardinality limits, blank
handling, persistence boundaries, and the one learner-visible consequence of
same-column Slicer + grouped-Visual interaction discovered during manual
verification.

## Sprint 8 implementation (CALCULATE & Filter Context Modification)

```text
expression/
  ast.ts                     + ComparisonExpressionNode, LogicalExpressionNode
                               (=, <>, >, >=, <, <=, &&, ||) — a pure grammar
                               addition, parsed generically, not CALCULATE-specific
  lexer.ts, parser.ts         new tokens + precedence chain (parseOr -> parseAnd ->
                               parseEquality -> parseRelational -> ...existing...)
  diagnostics.ts              + CALCULATE/FILTER/REMOVEFILTERS/ALL diagnostic codes
  binder.ts                    rejects CALCULATE/FILTER/REMOVEFILTERS/ALL in a
                               calculated column with CALCULATE_CONTEXT_TRANSITION_NOT_SUPPORTED
                               (context transition is out of scope — docs/CALCULATE.md)
  measureBinder.ts             + BoundComparison/BoundLogical (general scalar boolean
                               results) and BoundCalculate { expression, modifiers };
                               binds CALCULATE's filter arguments into FilterModifier[]

runtime/measure/
  booleanFilter.ts              NEW — binds/evaluates a CALCULATE/FILTER boolean
                                 predicate (BoundPredicateNode), independent of the
                                 general BoundMeasureExpression tree; documented
                                 blank/cross-type comparison semantics
  contextModifier.ts            NEW — the context-modification layer: EffectiveContext
                                 (replaceable ColumnFilters + FILTER-derived
                                 TableSelections) and applyFilterModifier(), kept
                                 deliberately separate from filterContext.ts's
                                 intersection-based mergeFilterContexts()
  filterPropagation.ts          + resolveFilterContextUnchecked() (skips the
                                 once-per-evaluateMeasure-call graph-validity check)
                                 and an optional tableSelections seed so a FILTER-
                                 derived row subset both AND-combines with ordinary
                                 ColumnFilters and propagates through the unmodified
                                 propagate() loop
  measureEvaluator.ts           + evaluateCalculate(): clones the enclosing
                                 EffectiveContext, applies filter modifiers
                                 sequentially, resolves once, evaluates the inner
                                 expression under a context-safe (fresh-cache)
                                 nested MeasureEvalContext; evaluateMeasure surfaces
                                 the CALCULATE-modified filterState for a top-level
                                 CALCULATE measure (Context Explorer integration)
  dependencyGraph.ts             traverses the two new AST node kinds too

runtime/validation/semanticValidation.ts   traverses the two new AST node kinds,
                                            so uses-function recognizes CALCULATE/
                                            FILTER/REMOVEFILTERS/ALL for free
runtime/context/graphAdapter.ts             one bounded fallback so a FILTER-derived
                                             table reduction still shows a consistent
                                             state badge (docs/CALCULATE.md)

expression/trace.ts             + calculate | filter-modifier | boolean-filter |
                                 table-filter | remove-filters trace node kinds,
                                 rendered through the existing generic TraceNodeView
                                 with no component changes
```

No new UI components were needed: `MeasureCellCard`, `ContextExplorer` and
every `Visual` component already consume `evaluateMeasure`'s output
generically, so a `CALCULATE` measure "just works" everywhere the moment it's
created — see [`docs/CALCULATE.md`](./docs/CALCULATE.md) for the full
same-column-replacement semantics, the `FILTER`/`REMOVEFILTERS`/`ALL`
design, the context-safe caching strategy, nested `CALCULATE`, the
context-transition boundary, and known DAX compatibility limitations.

## Sprint 9 implementation (Iterators, Table Expressions & Conditional Logic)

```text
runtime/tableExpression/          NEW — the canonical table-expression layer
  tableExpressionTypes.ts           BoundTableExpression (BaseTable | FilterTable |
                                     ValuesTable | DistinctTable) + lineage-preserving
                                     EvaluatedTableExpression row types
  tableExpressionBinder.ts          bindTableExpression() — the one binder CALCULATE's
                                     FILTER modifier, COUNTROWS and every iterator share
  tableExpressionEvaluator.ts       evaluateTableExpression() — respects the current
                                     FilterContext for base tables; FILTER/VALUES/DISTINCT
                                     all reduce to this one evaluator

runtime/iterator/                 NEW — the iterator row-context layer
  iteratorTypes.ts                  BoundIteratorExpression (per-row grammar: literals,
                                     column reads, RELATED, measure refs, IF/SWITCH/BLANK,
                                     arithmetic/comparison/logical) + BoundIteratorCall
  iteratorBinder.ts                 bindIteratorRowExpression() / bindIteratorCall() —
                                     binds SUMX/AVERAGEX/MINX/MAXX/COUNTX's row expression
                                     once; scopes column reads to the iterator's own table
  iteratorEvaluator.ts              evaluateIteratorRowExpression() — pure, model-free
                                     per-row evaluator; measure-reference context
                                     transition is injected as a callback (no
                                     binder/evaluator import cycle with measureEvaluator.ts)

expression/
  parser.ts                        + TRUE()/FALSE() as a zero-argument literal call
                                     (needed for the canonical SWITCH(TRUE(), ...) shape)
  diagnostics.ts                   + iterator/table-expression/conditional diagnostic codes
  trace.ts                         + iterator | table-expression | context-transition |
                                     conditional | switch-case trace node kinds
  scalarComparison.ts              NEW — compareScalarValues extracted from
                                     runtime/measure/booleanFilter.ts (which re-exports it)
                                     so the expression layer (calculated-column
                                     evaluator, iterator evaluator) doesn't have to
                                     depend on the runtime layer for a pure scalar utility
  binder.ts                        + BoundComparison/BoundLogical/BoundIf/BoundSwitch/
                                     BoundBlank — calculated columns gain the
                                     comparison/logical/conditional support Sprint 8
                                     deliberately deferred (CALCULATE itself stays rejected)
  evaluator.ts                     + matching Comparison/Logical/If/Switch/Blank
                                     evaluation, row-by-row
  measureBinder.ts                 + BoundMeasureIf/BoundMeasureSwitch/BoundMeasureBlank/
                                     BoundSelectedValue/BoundIteratorCall; COUNTROWS
                                     generalized from a bare modelTableId to a
                                     BoundTableExpression; FILTER's CALCULATE-modifier
                                     binding now delegates to bindTableExpression instead
                                     of duplicating predicate binding

runtime/measure/
  contextModifier.ts               PredicateFilter's row-scan now delegates to
                                     evaluateTableExpression instead of its own scan loop
                                     — CALCULATE's FILTER and the standalone
                                     FILTER/SUMX path are one implementation, not two
  aggregation.ts                   + computeIteratorAggregation() (SUMX/AVERAGEX/MINX/
                                     MAXX/COUNTX fold with structured type-error diagnostics)
  measureEvaluator.ts               + evaluateIteratorCall()/evaluateIteratorMeasureReference()
                                     (the bounded, cache-safe context-transition mechanism)
                                     and evaluateSelectedValue(); CountRows dispatch now
                                     goes through evaluateTableExpression
```

No new UI components were needed here either: `Visual` components and the
Context Explorer already consume `evaluateMeasure`'s output generically, so a
`SUMX`/`IF`/`SELECTEDVALUE` measure "just works" the moment it's created —
see [`docs/ITERATORS.md`](./docs/ITERATORS.md) and
[`docs/TABLE_EXPRESSIONS.md`](./docs/TABLE_EXPRESSIONS.md) for the full
design, known DAX compatibility limitations, and
`tests/runtime/visual/iteratorVisual.test.ts` /
`tests/runtime/validation/semanticValidation.test.ts` for the zero-new-code
integration proofs. All Sprint 1-8 tests remain green — the two Sprint 8
tests whose *diagnostic code* (not behavior) changed as a direct result of
the FILTER refactor were updated in place (see `docs/TABLE_EXPRESSIONS.md`
"FILTER — one implementation, two callers").

## Sprint 10 implementation (Date Tables & Classic Time Intelligence)

```text
domain/model.ts                   + DateTableDefinition { modelTableId, dateColumn }
                                     + SemanticModel.dateTables — plural (a model may mark
                                     more than one Date Table), never a single global
                                     "Calendar" id

runtime/model/modelRuntime.ts     hydrateSemanticModel() + dateTables: model.dateTables ?? []
                                     (identical pattern to Sprint 4's measures ?? []);
                                     createModel() seeds dateTables: []; removeTable() also
                                     drops that table's DateTableDefinition (no dangling
                                     metadata)

runtime/dateTable/                NEW — Date Table domain runtime, no React dependency
  dateMath.ts                       ModelDate + parseModelDate/formatModelDate/
                                     compareModelDates/addDays/addMonthsClassic/
                                     addYearsClassic/shiftByInterval/startOfMonth/
                                     endOfMonth/startOfYear/endOfYear — UTC epoch-day
                                     arithmetic, never local-time Date getters/setters
  dateTableTypes.ts                 DateTableDiagnosticCode/DateTableDiagnostic/
                                     DateTableValidationResult — a diagnostic union of its
                                     own, distinct from ModelDiagnosticCode/
                                     ExpressionDiagnosticCode
  dateTableRuntime.ts               validateDateTableDefinition() (type/blanks/uniqueness/
                                     contiguity/datetime-consistency checks) +
                                     markDateTable()/unmarkDateTable()/
                                     getDateTableDefinition()/findDateTableDefinitionForColumn()
                                     — markDateTable() validates-then-applies, mirroring
                                     modelRuntime.createRelationship()'s shape; an invalid
                                     marking never becomes canonical model state

runtime/timeIntelligence/         NEW — the Classic time-intelligence layer
  timeIntelligenceBinder.ts         bindDateColumnArgument() (shared Table[Column]
                                     resolution + the "marked Date Table required" check)
                                     + bindSamePeriodLastYear/bindDateAdd/
                                     bindPreviousMonth/bindPreviousYear/bindDatesYtd —
                                     DATEADD's YEAR/QUARTER/MONTH/DAY bind as bare
                                     identifiers (TableReferenceNode), never string
                                     literals; its offset must be a constant integer
  timeIntelligenceEvaluator.ts      computeTimeIntelligenceRowIndexes() — reads "currently
                                     visible dates" from a ResolvedFilterState, applies the
                                     operation's date math, and resolves the result against
                                     a Date Table row index built once (O(visible dates +
                                     date table size), never scans the fact table); DATEADD
                                     rejects a non-contiguous current context here (a
                                     runtime-only check — the actual visible dates aren't
                                     known at bind time) + evaluateTimeIntelligenceTable()
                                     for bare table-expression usage (COUNTROWS(...))

runtime/tableExpression/
  tableExpressionTypes.ts          + BoundTimeIntelligenceTable — one new variant for all
                                     five functions (operation: 'same-period-last-year' |
                                     'date-add' | 'previous-month' | 'previous-year' |
                                     'dates-ytd'), not a second table-expression kind
  tableExpressionBinder.ts         bindTableExpression() dispatches SAMEPERIODLASTYEAR/
                                     DATEADD/PREVIOUSMONTH/PREVIOUSYEAR/DATESYTD to
                                     runtime/timeIntelligence/timeIntelligenceBinder.ts
  tableExpressionEvaluator.ts      + 'TimeIntelligenceTable' case delegating to
                                     evaluateTimeIntelligenceTable(); EvaluatedTableExpression
                                     gained an optional diagnostics field for DATEADD's
                                     runtime-only non-contiguous-context failure

runtime/measure/contextModifier.ts + DateTableReplaceModifier { bound: BoundTimeIntelligenceTable }
                                     — a new FilterModifier variant that *replaces* the
                                     Date Table's entire current filter state (clears every
                                     existing column filter/table selection on that table,
                                     installs the computed row set) rather than
                                     intersecting, matching real Power BI semantics; a
                                     runtime diagnostic (e.g. DATEADD's non-contiguous
                                     context) short-circuits CALCULATE before the inner
                                     expression evaluates

expression/
  diagnostics.ts                   + DATE_TABLE_REQUIRED/TIME_INTELLIGENCE_INVALID_ARGUMENT/
                                     DATEADD_INVALID_INTERVAL/DATEADD_INTERVAL_COUNT_INVALID/
                                     DATEADD_NON_CONTIGUOUS_CONTEXT/TOTALYTD_INVALID_ARGUMENT
  trace.ts                         + date-table | time-intelligence | date-shift |
                                     date-period trace node kinds
  measureBinder.ts                 + bindTimeIntelligenceFilterModifier() (dispatched from
                                     bindCalculateFilterArgument for all five functions,
                                     mirroring bindFilterFunction's exact shape) +
                                     bindTotalYtd() — TOTALYTD binds directly to the same
                                     Calculate/DateTableReplace shape CALCULATE(expr,
                                     DATESYTD(...)) would produce; zero new evaluator code

runtime/validation/
  dateTableValidationRule.ts       NEW — evaluateDateTableRule() for the new 'date-table'
                                     ValidationRule type; measure-result rules already
                                     grade YoY/YTD measures with no new rule type
  validationEngine.ts              + 'date-table' case in evaluateRule()

domain/validation.ts               + DateTableValidationRule + 'date-table' in
                                     ValidationRuleType — no hydration needed (validation
                                     specs were never hydrated to begin with)

components/notebook/
  model/DateTableControls.tsx       NEW — per-table "Mark as Date Table" / validated badge
                                     / "Unmark" control, wired through ModelCellCard.tsx →
                                     NotebookCell.tsx → App.tsx exactly like every other
                                     model mutation
  model/ModelTableNode.tsx          + a DATE TABLE badge in the node header
  model/ModelCanvas.tsx             deriveNodes() looks up the table's DateTableDefinition
```

No Context Explorer or Visual Cell code changed at all: both already render
`ExecutionTraceNode` trees and `evaluateMeasure()` output generically, so
`Revenue LY`/`Revenue PM`/`Revenue YTD` "just work" — including the four new
trace node kinds appearing automatically inside CALCULATE's modifier trace,
confirmed live via a Playwright walkthrough of the Retail sample: marking
Calendar as a Date Table, creating all six required Sprint 10 measures, and
verifying `Revenue LY` computes March 2024's revenue (not blank) under a
`Year = 2025, Month = March` slicer, that `Revenue PM` under March 2025
exactly matches an independently-filtered February 2025 total, that
`TOTALYTD` and `CALCULATE(...DATESYTD(...))` render identical values, and
that both the Date Table marking and every measure survive a hard reload
with zero console errors. See [`docs/DATE_TABLES.md`](./docs/DATE_TABLES.md)
and [`docs/TIME_INTELLIGENCE.md`](./docs/TIME_INTELLIGENCE.md) for the full
design and known DAX compatibility limitations.

## Sprint 11 implementation (Advanced Relationships & USERELATIONSHIP/CROSSFILTER)

```text
domain/model.ts                   Relationship migrated to a generic shape:
                                     { id, left, right, cardinality: 'one-to-many' |
                                     'one-to-one' | 'many-to-many', oneSide?, crossFilterDirection:
                                     'left-to-right' | 'right-to-left' | 'both', active, createdAt }
                                     — no field named one/many on the canonical type

runtime/model/relationshipHelpers.ts   NEW — the single centralized module for relationship
                                          orientation: relationshipEndpoint/relationshipOtherSide/
                                          relationshipOneEndpoint(only one-to-many)/
                                          relationshipManyEndpoint/relationshipConnectsColumns/
                                          relationshipConnectsTables/siblingRelationships,
                                          relationshipPropagationEdges() (derives 0-2 directed
                                          RelationshipPropagationEdges per relationship, folding in
                                          any runtime USERELATIONSHIP/CROSSFILTER override),
                                          findAmbiguousDirectedPairs()/hasAmbiguousDirectedPath()
                                          (directed multi-path detection, shared by graphAnalysis.ts
                                          and modelRuntime.ts's create/activate-time validation) —
                                          no other file reads relationship.left/.right and derives
                                          orientation on its own

runtime/model/modelRuntime.ts     hydrateSemanticModel() converts a legacy persisted
                                     { one, many, cardinality: 'one-to-many', crossFilterDirection:
                                     'single' } relationship to the canonical shape (left=one,
                                     right=many, oneSide='left', crossFilterDirection='left-to-right'
                                     — numerically identical to old behavior); createRelationshipConfig/
                                     validateRelationshipConfig/updateRelationship are the new
                                     cardinality-aware create/validate/edit pipeline, replacing the old
                                     single-cardinality createRelationship/validateRelationship, which
                                     now survive only as thin one-to-many convenience wrappers around
                                     the new functions; setRelationshipActive returns { model,
                                     diagnostics } and fails closed (clone-validate-commit) instead of
                                     unconditionally flipping a boolean

runtime/measure/filterPropagation.ts   propagate() walks relationshipPropagationEdges() to a fixed
                                          point instead of a hardcoded one->many step — the same
                                          "foreign key value -> target row indices" membership test
                                          now covers every cardinality/direction combination;
                                          resolveFilterContext/resolveFilterContextUnchecked gained an
                                          optional EffectiveRelationshipState parameter for
                                          USERELATIONSHIP/CROSSFILTER overrides

runtime/model/graphAnalysis.ts    ACTIVE_CYCLE (undirected active-relationship cycle detection) is
                                     retired entirely, not generalized — a legal bidirectional
                                     relationship is a 2-node directed cycle, so simple cycle
                                     detection is the wrong tool once bidirectional cross-filter
                                     exists. AMBIGUOUS_FILTER_PATH (redesigned from the old
                                     undirected AMBIGUOUS_PATH, promoted to error severity) is the
                                     only graph-invalidating condition now: more than one distinct
                                     directed propagation path between an ordered table pair

runtime/measure/contextModifier.ts   EffectiveContext gained relationshipState:
                                        EffectiveRelationshipState (activatedRelationshipIds/
                                        suppressedRelationshipIds/directionOverrides), cloned per
                                        CALCULATE scope exactly like columnFilters/tableSelections;
                                        RelationshipOverrideModifier is a new FilterModifier variant
                                        (alongside ReplaceColumnFilter/PredicateFilter/RemoveColumns/
                                        RemoveTables/ClearAllFilters/DateTableReplace) that
                                        USERELATIONSHIP/CROSSFILTER both bind to — one override
                                        layer, not two — applied through the same applyFilterModifier
                                        switch, never mutating the persisted SemanticModel

expression/measureBinder.ts       bindUserRelationship()/bindCrossFilter() resolve the relationship
                                     connecting two named columns (either argument order) and build a
                                     RelationshipOverrideModifier; CROSSFILTER's direction argument
                                     (NONE/BOTH/ONEWAY/ONEWAY_LEFTFILTERSRIGHT/ONEWAY_RIGHTFILTERSLEFT)
                                     parses as a bare identifier, reusing DATEADD's interval-unit
                                     grammar pattern — no new parser grammar needed

expression/relatedLookup.ts       resolveRelatedRelationship() is now cardinality-aware:
                                     one-to-many unchanged (many->one only), one-to-one valid in
                                     either direction (both sides unique), many-to-many always
                                     rejected with RELATED_UNSUPPORTED_CARDINALITY (RELATED never
                                     picks an arbitrary row)

domain/context.ts                 ContextRelationshipState generalized from one/many to
                                     left/right + cardinality + crossFilterDirection; propagation
                                     is now a list (0-2 entries) instead of one before/after pair;
                                     new effectiveActive/overrideReason fields sourced from
                                     ResolvedFilterState.relationshipOverrides
components/context/ContextDetailsPanel.tsx   renders a human-readable override banner
                                                (activated-by-userelationship/
                                                suppressed-by-userelationship/
                                                crossfilter-direction-override/crossfilter-none)
                                                from runtime truth, never inferred from source text

domain/validation.ts              + RelationshipConfigValidationRule ('relationship-config') for
                                     asserting a relationship's full cardinality/oneSide/
                                     crossFilterDirection/active configuration, alongside the
                                     still-supported 1:* 'relationship' rule
runtime/validation/fingerprint.ts   relationship fingerprint fields changed from
                                       { one, many, active, cardinality } to
                                       { left, right, cardinality, oneSide, crossFilterDirection,
                                       active } — crossFilterDirection now participates in staleness
                                       detection, where it was previously silently omitted
```

No visual-specific or relationship-specific changes were needed in `runtime/visual/*`/`components/visual/*` — every Visual still calls the unmodified `evaluateMeasure`, so a bidirectional/many-to-many/`USERELATIONSHIP`/`CROSSFILTER` measure "just works" the moment it's created. See
[`docs/ADVANCED_RELATIONSHIPS.md`](./docs/ADVANCED_RELATIONSHIPS.md) and
[`docs/USERELATIONSHIP.md`](./docs/USERELATIONSHIP.md) for the full design,
migration/hydration details, and known Power BI compatibility boundaries.

## Sprint 12 implementation (Power Query & Data Transformation Runtime)

New files, none of which any existing BI-engine file imports from:

```text
domain/query.ts                    QueryDefinition, QuerySource, the 14-member QueryStep
                                      union, QueryEvaluation/QueryStepResult/QueryDiagnostic

runtime/query/queryRuntime.ts      top-level API: evaluateAllQueries, frameAtStep,
                                      createQueryDefinition, add/update/remove/moveQueryStep,
                                      rename(Query|QueryStep), setQueryLoadEnabled,
                                      findDependentQueryIds
runtime/query/queryEvaluator.ts    runs one query's Applied Steps in order, stops at the
                                      first failure, enforces DATA_LIMITS per step
runtime/query/queryGraph.ts        dependency DAG, dependency-first order, fail-closed
                                      cycle/missing-dependency detection
runtime/query/queryFingerprint.ts  semantic fingerprint (source + step configs, minus
                                      id/name, + dependency fingerprints)
runtime/query/queryFrame.ts        the in-flight { columns, rows } shape steps operate on
runtime/query/queryDiagnostics.ts  QueryDiagnostic factory
runtime/query/stepContext.ts       what a step needs beyond its own frame (resolving
                                      another QuerySource; row/column limits)
runtime/query/queryStepFactory.ts  builds a fully-formed QueryStep, generating any new
                                      column ids exactly once, never during evaluation
runtime/query/steps/*.ts           one pure evaluator per step kind (14 files)

persistence/queryStore.ts          mirrors modelStore.ts — persists QueryDefinition only

lib/sample/generatePowerQueryLabDataset.ts   the seeded messy-data lab fixture

components/notebook/query/QueryCellCard.tsx  Applied Steps list + preview + toolbar
components/notebook/query/queryStepForms.tsx one form per step kind

docs/POWER_QUERY_RUNTIME.md, docs/APPLIED_STEPS.md
```

Modified files, and exactly what changed:

```text
domain/data.ts                    + DatasetSource variant { type: 'query'; queryId; revision }
domain/notebook.ts                + QueryCell (kind: 'query'), added to the NotebookCell union
lib/hash.ts                       extracted from runtime/validation/fingerprint.ts so
                                     queryFingerprint.ts can reuse the same FNV-1a hash
                                     without duplicating it
runtime/validation/fingerprint.ts   tables payload now includes
                                       resolved.dataset.source.revision when the table's
                                       dataset is query-sourced — the one line that makes a
                                       row-only Power Query edit turn a PASS into STALE
runtime/validation/selectorResolver.ts   sourceKeyOf() now also handles source.type ===
                                            'query' (returns queryId), so a TableSelector can
                                            disambiguate a query-sourced table like it already
                                            could for sample/xlsx/csv sources
runtime/notebook/notebookRuntime.ts   + queries/queryEvaluations on NotebookRuntimeSnapshot;
                                         + createQueryFromDataset/createQueryFromQuery/
                                         renameQuery/add·update·rename·remove·moveQueryStep/
                                         setQueryLoadEnabled/deleteQuery/refreshQueries;
                                         a private reEvaluateQueries() re-runs
                                         evaluateAllQueries and folds load-enabled outputs
                                         back into the same `datasets` map DataCell has
                                         always used — no other runtime file changed
runtime/notebook/useNotebookRuntime.ts   hydrates QueryDefinitions alongside datasets/models,
                                            calls refreshQueries() once after replaceAll,
                                            exposes the new query actions
runtime/data/dataRuntime.ts        + loadSamplePowerQueryLabDataset
components/notebook/NotebookCell.tsx   + 'query' cell dispatch; DataCellCard gained a
                                          "Transform Data" action
components/notebook/DataCellCard.tsx   + onTransformData prop/button — the raw DataCell is
                                          never mutated or removed by it
App.tsx                            wires the new query state/actions through; + "Reference
                                      Query" action
styles/app.css                     + .query-* rules for the Query cell
```

`SemanticModel`, `CalculatedColumn`, `Measure`, every `expression/*` file,
every `runtime/measure/*`/`runtime/dateTable/*`/`runtime/context/*` file,
and every `runtime/visual/*`/`components/visual/*` file are **untouched** —
proof that a query's output really does enter the model exactly like any
other `Dataset` (`docs/POWER_QUERY_RUNTIME.md` "Model integration
boundary"). See [`docs/POWER_QUERY_RUNTIME.md`](./docs/POWER_QUERY_RUNTIME.md)
and [`docs/APPLIED_STEPS.md`](./docs/APPLIED_STEPS.md) for the full design,
stable-identity strategy, and known Power Query compatibility boundaries.

## Sprint 13 implementation (Learning System)

```text
src/domain/learning.ts              LessonDefinition/Stage/Hint/Solution,
                                     LessonSession, LessonAttempt,
                                     LessonProgressSummary (types only)
src/data/lessons/
  lessonRegistry.ts                  code-owned built-in lesson list
  retailFoundationsLesson.ts         Lesson 1 (beginner)
  filterContextLesson.ts             Lesson 2 (intermediate)
  timeIntelligenceLesson.ts          Lesson 3 (intermediate)
  support/retailModelBuilder.ts      shared deterministic Retail bootstrap
                                      steps, driving the real NotebookRuntime
src/data/exercises/
  filterContextValidation.ts         new ValidationSpec (Lesson 2 checkpoint)
  timeIntelligenceValidation.ts      new ValidationSpec (Lesson 3 checkpoint)
  retailFoundationsValidation.ts     REUSED as-is (Lesson 1 checkpoint)
src/runtime/learning/
  lessonSession.ts                   pure session lifecycle functions
  lessonProgress.ts                  stage/lesson completion, attempt
                                      creation, progress aggregation
  useLessonWorkspace.ts              React hook: wires useNotebookRuntime
                                      (lesson-scoped) + session + progress
  useLearningProgress.ts             React hook: attempt history for the
                                      Progress dashboard
src/persistence/learningStore.ts    LessonSession/LessonAttempt/lesson
                                     notebook persistence (idb-keyval,
                                     mirrors notebookStore.ts's pattern)
src/components/
  NotebookWorkspace.tsx              Free Lab, extracted verbatim from the
                                      old App.tsx (unchanged behavior)
  notebook/NotebookBody.tsx          shared cell-list + add-cell bar, used
                                      by both NotebookWorkspace and
                                      LessonWorkspace — one execution UI
  learning/LessonCatalog.tsx         Exercises view
  learning/LessonWorkspace.tsx       lesson header/stages/hints/checkpoint
  learning/ProgressDashboard.tsx     Progress view
App.tsx                             AppView routing ('notebook' |
                                     'exercises' | 'progress'), no router
```

The one existing-runtime change: `runtime/notebook/useNotebookRuntime.ts`
gained an optional `{ persistence, createInitialSnapshot }` parameter pair
(both default to the Free Lab's original fixed-key behavior) so a lesson
can reuse the exact same hook with its own persistence key and its own
deterministic starting snapshot, instead of a parallel notebook-hydration
implementation. Every other runtime file from Sprints 1–12 is untouched —
the Learning System is additive orchestration, per the architectural rule
above ("the same model can later power ... saved lessons"). See
[`docs/LEARNING_SYSTEM.md`](./docs/LEARNING_SYSTEM.md) for the full domain
model, validation integration, and persistence/staleness boundaries.

## Sprint 14 implementation (Advanced Applied Steps, Direct Query Validation & Multi-Checkpoint Learning)

New files:

```text
runtime/query/steps/
  pivotColumn.ts, unpivotColumns.ts, conditionalColumn.ts,
  indexColumn.ts, customColumn.ts     one pure evaluator per new step kind
  pivotIdentity.ts                    canonicalPivotKey/pivotDisplayName/
                                        pivotOutputColumnId — the deterministic-
                                        hash identity strategy for Pivot's
                                        data-dependent output columns
  scalarMatch.ts                       matchesOperator/matchesCondition/
                                        compareScalars/isBlank, extracted out
                                        of filterRows.ts so Conditional Column
                                        reuses Filter Rows' comparison
                                        semantics instead of a second copy
  inferOutputType.ts                   shared by Conditional Column and
                                        Custom Column: infers an output
                                        DataType from values actually
                                        produced, with a small integer+
                                        decimal→decimal promotion lattice

runtime/query/expression/             NEW — the Custom Column expression
                                        subsystem, deliberately not reusing
                                        expression/* (the DAX engine) or
                                        implementing M (docs/
                                        POWER_QUERY_EXPRESSIONS.md)
  lexer.ts, parser.ts, ast.ts, binder.ts, functions.ts, evaluator.ts,
  evalError.ts

runtime/validation/queryValidation.ts  evaluators for the 6 new
                                        'query-*' ValidationRule types —
                                        never touch SemanticModel
                                        (docs/QUERY_VALIDATION.md)

data/lessons/powerQueryLesson.ts               4th built-in lesson (all
                                                 workspace-scoped checkpoints)
data/exercises/powerQueryLessonValidation.ts   its 4 ValidationSpecs
lib/sample/generateMonthlyTargetsDataset.ts    NEW small wide-format fixture
                                                 purpose-built for Unpivot

docs/QUERY_VALIDATION.md, docs/POWER_QUERY_EXPRESSIONS.md
```

Modified files, and exactly what changed:

```text
domain/query.ts                    + PivotColumnStep/UnpivotColumnsStep/
                                       ConditionalColumnStep/IndexColumnStep/
                                       CustomColumnStep in the QueryStep
                                       union; + 10 new QueryDiagnosticCode
                                       members
runtime/query/queryStepFactory.ts    + a factory case per new step kind
runtime/query/queryEvaluator.ts      + a runStep dispatch case per new kind
components/notebook/query/
  queryStepForms.tsx, QueryCellCard.tsx   + a form/toolbar entry per new
                                            step kind, including
                                            CustomColumnForm's live inline
                                            parse+bind diagnostic preview
                                            (never authoritative — the real
                                            evaluation happens again in
                                            steps/customColumn.ts)

domain/notebook.ts                 TestCell.modelId: string → TestCell.scope:
                                       TestCellScope = { kind: 'model';
                                       modelId } | { kind: 'workspace' } — a
                                       full breaking migration with no
                                       compat shim (no persistence schema-
                                       versioning exists anywhere in this
                                       codebase; a local dev tool, no
                                       deployed users) — see
                                       docs/VALIDATION_ENGINE.md "TestCell
                                       scope"
domain/validation.ts               + QuerySelector/QueryColumnSelector + 6
                                       new ValidationRuleType members/
                                       interfaces (docs/QUERY_VALIDATION.md)
runtime/validation/validationEngine.ts   ValidationSnapshot + queries/
                                            queryEvaluations; evaluateRule()
                                            dispatches the 8 pre-existing
                                            rule types through a
                                            `model ? evaluateX(...) :
                                            modelConfigError(rule)` ternary
                                            (zero changes to the 5 existing
                                            per-rule evaluator files) and the
                                            6 new query rule types to
                                            queryValidation.ts, which never
                                            receives `model` at all
runtime/validation/selectorResolver.ts   + resolveQuerySelector/
                                            resolveQueryColumnSelector/
                                            classifyQuerySelectorFailure —
                                            deliberately separate from
                                            classifySelectorFailure: a
                                            missing query-output column is
                                            'failed', not 'error' (docs/
                                            QUERY_VALIDATION.md)
runtime/validation/fingerprint.ts    computeValidationFingerprint(snapshot,
                                        testCell) (was (model, datasets,
                                        spec)); model payload only computed
                                        for scope.kind === 'model'; +
                                        referencedQuerySelectors(spec) folds
                                        in every referenced query's own
                                        queryFingerprint.ts-computed
                                        fingerprint — zero new query-side
                                        fingerprint logic needed
runtime/notebook/notebookRuntime.ts   createTestCell(scope, validation,
                                         title?, prompt?) (was
                                         (modelId, ...))
components/notebook/
  AddTestCellPanel.tsx, TestCellCard.tsx, NotebookCell.tsx   updated for
                                                                `scope`;
                                                                TestCellCard's
                                                                missing-model
                                                                placeholder
                                                                now guards on
                                                                `scope.kind
                                                                === 'model'`
                                                                (a real bug
                                                                found during
                                                                browser
                                                                verification
                                                                — it
                                                                previously
                                                                showed for
                                                                every
                                                                workspace-
                                                                scoped
                                                                checkpoint)
data/lessons/{retailFoundations,filterContext,timeIntelligence}Lesson.ts
                                    pass { kind: 'model', modelId: ... }

runtime/learning/lessonProgress.ts   isLessonComplete(stages,
                                        runsByValidationId,
                                        staleByValidationId) (was (stages,
                                        run, isStale)) — every checkpoint
                                        stage's own map entry must satisfy
                                        isStageComplete (unchanged per-stage
                                        logic); createLessonAttemptFromValidationRun
                                        renamed createLessonAttemptFromCheckpointRuns
                                        (sums points/passed across every
                                        checkpoint run, one composite
                                        fingerprint hashed over every run's
                                        own {testCellId, fingerprint})
runtime/learning/useLessonWorkspace.ts   singular checkpointStage/
                                            checkpointTestCell/checkpointRun/
                                            checkpointStale → per-checkpoint
                                            Record<validationId, ...> maps;
                                            checkCheckpoint(stageId) (was
                                            zero-arg) checks exactly the one
                                            checkpoint belonging to that
                                            stage; a LessonAttempt is
                                            recorded only on the exact check
                                            that flips wasComplete→
                                            isCompleteNow, computed
                                            synchronously from the pre-/
                                            post-update run maps
components/learning/LessonWorkspace.tsx   reads the current stage's own
                                             checkpoint run/stale from the
                                             maps; + handleRunValidation(cellId)
                                             routing a TestCellCard's "Run"
                                             click to the stage that owns
                                             that cell's validation.id
data/lessons/lessonRegistry.ts       + powerQueryLesson (4th built-in lesson)
```

`SemanticModel`, `CalculatedColumn`, `Measure`, every `expression/*` file
(the DAX engine), and every `runtime/measure/*`/`runtime/dateTable/*`/
`runtime/context/*`/`runtime/visual/*` file are **untouched** — proof that
Direct Query Validation and the new Applied Step kinds stayed inside the
Power Query/Validation boundary rather than growing a second path through
the model layer. See
[`docs/POWER_QUERY_RUNTIME.md`](./docs/POWER_QUERY_RUNTIME.md),
[`docs/APPLIED_STEPS.md`](./docs/APPLIED_STEPS.md),
[`docs/POWER_QUERY_EXPRESSIONS.md`](./docs/POWER_QUERY_EXPRESSIONS.md),
[`docs/QUERY_VALIDATION.md`](./docs/QUERY_VALIDATION.md) and
[`docs/LEARNING_SYSTEM.md`](./docs/LEARNING_SYSTEM.md) for the full design.

## Sprint 15 implementation (Workspace Referential Integrity, Essential DAX Closure & Semantic Conformance Suite)

New files:

```text
runtime/integrity/
  types.ts                    WorkspaceRef, WorkspaceIntegrityIssue,
                                 WorkspaceIntegrityReport — mirrors the
                                 {severity, code, message, details?} shape
                                 RelationshipDiagnostic/QueryDiagnostic/
                                 ExpressionDiagnostic already use
  workspaceReferences.ts      cellReferenceIssues/modelReferenceIssues/
                                 queryReferenceIssues — pure enumerators,
                                 one per source-object family
  workspaceIntegrity.ts       validateWorkspaceIntegrity(snapshot): the
                                 canonical structural-integrity check,
                                 running all three enumerators above
  expressionDependents.ts     findColumnReferencesInExpression() (parses via
                                 the real parseExpression, walks the AST for
                                 ColumnReferenceNodes — never the binder,
                                 never regex) + findCalculatedColumnDependents()
                                 — a deliberate, documented conservative
                                 over-approximation (see docs/WORKSPACE_INTEGRITY.md)
  mutationImpact.ts           one pure, read-only analyze* function per
                                 mutation kind (analyzeDeleteModel,
                                 analyzeDeleteDataset, analyzeDeleteQuery,
                                 analyzeDisableQueryLoad,
                                 analyzeRemoveModelTable, analyzeDeleteMeasure,
                                 analyzeDeleteCalculatedColumn) — RESTRICT
                                 (blockers) or CASCADE (cascaded ids), never
                                 mutating the snapshot itself

conformance/
  types.ts                    DaxConformanceCase — fixture, expression,
                                 evaluationMode, expected, provenance
                                 ('hand-calculated' | 'documented-dax-semantics'
                                 | 'power-bi-verified'), knownDivergence?
  runCase.ts                  runConformanceCase() — runs a case through the
                                 real public createMeasure/evaluateMeasure or
                                 createCalculatedColumn APIs, comparing via
                                 the pre-existing compareScalar
                                 (runtime/validation/scalarComparison.ts)
  report.ts                   summarizeConformance/formatConformanceReport —
                                 generated from the actual case list

tests/conformance/fixtures/   sharedFixture.ts + one file per family
                                 (scalar, blanks, variables, aggregations,
                                 filterContext, calculate, iterators,
                                 relationships, timeIntelligence,
                                 advancedRelationships) — 83 cases total,
                                 aggregated in fixtures/index.ts

tests/support/expectWorkspaceIntegrity.ts   expectWorkspaceIntegrity(
                                               snapshot).toBeValid() — used
                                               after every destructive-
                                               mutation test across the suite

docs/WORKSPACE_INTEGRITY.md, docs/SEMANTIC_CONFORMANCE.md
```

Modified files, and exactly what changed:

```text
runtime/notebook/notebookRuntime.ts   removeDataset/removeMeasureCell/
                                         removeCalculatedColumnCell/
                                         setQueryLoadEnabled now return
                                         { removed/updated: boolean;
                                         blockers?: WorkspaceIntegrityIssue[] }
                                         instead of void; removeModel returns
                                         { removed: boolean; cascadedCellIds };
                                         removeTableFromModel returns
                                         { removed; cascadedCalculatedColumnIds;
                                         cascadedMeasureIds; cascadedCellIds };
                                         deleteQuery keeps its existing
                                         { deleted, blockedByQueries,
                                         referencedByModels } shape, but
                                         referencedByModels.length > 0 now also
                                         sets deleted: false (was
                                         informational-only) — every one of
                                         these methods calls the matching
                                         analyze* function internally before
                                         mutating, the single enforcement point
runtime/model/modelRuntime.ts         removeTable() now also filters
                                         measures whose homeModelTableId
                                         matches the removed table (previously
                                         only relationships/calculatedColumns/
                                         dateTables were cleaned up — a
                                         confirmed pre-Sprint-15 gap, now closed)
runtime/notebook/useNotebookRuntime.ts   action wrappers propagate the
                                            richer return types and only
                                            persist (save/delete in IndexedDB)
                                            when the mutation actually succeeded
components/notebook/
  DataCellCard.tsx, CalculatedColumnCellCard.tsx, MeasureCellCard.tsx,
  QueryCellCard.tsx                   show a role="alert" warning with the
                                         blocker reason when a mutation is
                                         blocked; QueryCellCard.tsx also gained
                                         handleSetLoadEnabled

expression/
  ast.ts                       + VarReturnExpressionNode { variables,
                                  body, span } — no dedicated "variable
                                  reference" node; a bare name (`Revenue`)
                                  already parses as the pre-existing
                                  TableReferenceNode, and the binder decides
                                  whether it's a variable, exactly mirroring
                                  how TableReferenceNode already worked for
                                  bare-table arguments
  parser.ts                    + parseVarReturn(), hooked at the very top of
                                  parseExpression() (detects VAR/RETURN via
                                  token.text.toUpperCase(), the same
                                  technique already used for TRUE/FALSE) —
                                  VAR/RETURN nests for free anywhere an
                                  expression is accepted
  binder.ts, measureBinder.ts  + variables: Map/pendingVariables: Set/
                                  inVariableScope threaded through the bind
                                  context; parallel BoundVariableReference/
                                  BoundVarReturn (calculated columns) and
                                  BoundMeasureVariableReference/
                                  BoundMeasureVarReturn (measures);
                                  measureBinder.ts also pre-checks each VAR
                                  value against TABLE_PRODUCING_FUNCTION_NAMES
                                  and rejects a bare table name, both with
                                  TABLE_VARIABLE_NOT_SUPPORTED (scalar-only,
                                  explicitly enforced); + BoundIsBlank
                                  (both binders); measureBinder.ts also gains
                                  BoundHasOneValue and a keepFilters case
                                  inside bindCalculateFilterArgument's dispatch
  diagnostics.ts                + DUPLICATE_VARIABLE/UNKNOWN_VARIABLE/
                                  FORWARD_VARIABLE_REFERENCE/
                                  INVALID_VARIABLE_NAME/
                                  TABLE_VARIABLE_NOT_SUPPORTED/
                                  UNSUPPORTED_KEEPFILTERS_SHAPE
  evaluator.ts, measureEvaluator.ts   + variables: Map<string, NodeResult>
                                  on EvalContext/MeasureEvalContext; a
                                  VarReturn node builds a locally-extended
                                  copy of the map per declaration (never
                                  mutating the shared context) for correct
                                  lexical scoping; measureEvaluator.ts's
                                  evaluateCalculate carries variables through
                                  a nested CALCULATE call unchanged (a
                                  DAX variable is captured once, immune to a
                                  later context transition), while
                                  evaluateMeasureById evaluates a *different*
                                  referenced measure's own tree under a
                                  fresh, empty variables map so no VAR
                                  leaks across measure boundaries; +
                                  distinctVisibleValues() helper (factored
                                  out of the pre-existing
                                  evaluateSelectedValue, now shared with
                                  HASONEVALUE)
  trace.ts                      + 'var-return' | 'variable-declaration' |
                                  'variable-reference' trace node kinds

runtime/measure/contextModifier.ts   + optional keepFilters?: boolean on
                                        ReplaceColumnFilterModifier (mirrors
                                        the pre-existing PredicateFilterModifier
                                        .tableWide flag precedent); when set,
                                        intersects with any existing
                                        ColumnFilter on that column instead of
                                        unconditionally replacing, reusing the
                                        same same-column intersection
                                        arithmetic mergeFilterContexts already
                                        implements in filterContext.ts
```

No visual-specific or validation-specific code changed for Part B: every
`KPI`/`Table`/`Bar`/`Line`, the Context Explorer, and every existing
validation rule already consume `evaluateMeasure`'s output generically, so a
`VAR`/`RETURN`, `ISBLANK`, `HASONEVALUE` or `KEEPFILTERS` measure "just
works" the moment it's created. `SemanticModel`, `CalculatedColumn`,
`Measure`, and every `runtime/dateTable/*`/`runtime/query/*`/
`runtime/visual/*` file are untouched by Part A — workspace integrity is
enforced entirely inside `NotebookRuntime`'s own mutation methods, never a
second BI engine. See [`docs/WORKSPACE_INTEGRITY.md`](./docs/WORKSPACE_INTEGRITY.md),
[`docs/SEMANTIC_CONFORMANCE.md`](./docs/SEMANTIC_CONFORMANCE.md),
[`docs/EXPRESSION_ENGINE.md`](./docs/EXPRESSION_ENGINE.md) "Variables
(VAR/RETURN)", [`docs/MEASURES.md`](./docs/MEASURES.md) and
[`docs/CALCULATE.md`](./docs/CALCULATE.md) for the full design. 113 test
files / 1005 tests (1004 passed + 1 skipped known-divergence) passing.

## Expression strategy

Do not implement full DAX.

Sprint 3 implements a constrained scalar grammar: numeric/string/boolean
literals, parentheses, `+ - * /`, unary `-`, `Table[Column]`/`[Column]`
references, and `RELATED(Table[Column])` — see
[`docs/EXPRESSION_ENGINE.md`](./docs/EXPRESSION_ENGINE.md) for the exact
grammar ("BI Notebook DAX Subset — Sprint 3").

Sprint 4 (Measures) extends the *same* parser/AST/diagnostics/trace
modules with aggregation and filter-context semantics (`SUM`,
`COUNTROWS`, `DISTINCTCOUNT`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `DIVIDE`,
measure references) via a second binder and a new measure-evaluation
runtime, rather than a second expression system — Sprint 3's abstraction
held up. Sprint 8 (`CALCULATE`) proves that abstraction held up a second
time: comparison/logical operators are a pure grammar addition, `CALCULATE`/
`FILTER`/`REMOVEFILTERS`/`ALL` parse as ordinary function calls with no new
parser grammar, and CALCULATE's context modification plugs into the exact
Sprint 4 `FilterContext`/relationship-propagation/aggregation architecture
predicted back then — see [`docs/CALCULATE.md`](./docs/CALCULATE.md).

Sprint 9 (Iterators/Table Expressions/Conditional Logic) proves it a third
time, at real scale: `SUMX`/`AVERAGEX`/`MINX`/`MAXX`/`COUNTX`, `VALUES`,
`DISTINCT`, `IF`, `SWITCH`, `BLANK` and `SELECTEDVALUE` are all still
ordinary `FunctionCallNode`s parsed with **zero grammar changes** (the one
exception — `TRUE()`/`FALSE()` as a literal call — is a single parser
addition, not a rewrite). The genuinely new architecture is two small,
focused layers (`runtime/tableExpression/`, `runtime/iterator/`) that plug
into the *existing* `FilterContext`/relationship-propagation/
`MeasureEvalContext` machinery rather than replacing any of it — `FILTER`
went from a CALCULATE-only side effect to a reusable table-expression
primitive that CALCULATE itself now consumes, and iterator measure
references reuse `CALCULATE`'s own context-safe nested-scope pattern for
their row-level context transition. No parallel DAX engine was built — see
[`docs/ITERATORS.md`](./docs/ITERATORS.md) and
[`docs/TABLE_EXPRESSIONS.md`](./docs/TABLE_EXPRESSIONS.md).

The language may look DAX-like, but semantics and supported functions must be explicit.
