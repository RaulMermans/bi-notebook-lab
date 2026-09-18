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
│                      Local Data Layer                      │
│            CSV / XLSX / bundled exercise datasets         │
└────────────────────────────────────────────────────────────┘
```

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

### `semantic-core`
Represents tables, relationships, row context, filter context and expression evaluation.

### `validation`
Compares learner work against lesson expectations without relying on string equality.

### `lessons`
Portable lesson definitions: datasets, prompts, expected semantics and tests.

### `ui`
Notebook editor and visual explanations. It consumes domain/runtime contracts; it does not implement BI logic.

## Persistence

V1 should be local-first:

- lesson definitions: JSON/TypeScript fixtures
- learner notebooks: browser storage / local files
- datasets: bundled CSV/XLSX or user-imported files

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

The language may look DAX-like, but semantics and supported functions must be explicit.
