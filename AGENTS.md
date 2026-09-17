# AGENTS.md

## Mission

Build a notebook-based BI learning environment, not a Power BI clone.

## Non-negotiable product direction

The notebook is the primary interface and unit of work.

A learner progresses through executable cells that expose data modeling and analytical semantics.

## Engineering guardrails

1. Keep BI semantics outside React components.
2. Prefer pure deterministic functions for model/expression logic.
3. Every execution result should be testable headlessly.
4. Validation must compare meaning/results, not only raw expression strings.
5. Do not add enterprise BI features unless a roadmap phase explicitly requires them.
6. Do not build visual polish before runtime correctness.
7. New cell types require a domain contract and execution contract first.
8. Lessons must be portable data/config, not hardcoded UI flows.

## Initial supported scope

Focus on:

- local datasets
- one-to-many relationships
- calculated columns
- foundational measures
- row/filter context
- validation
- explanation traces

Avoid:

- full DAX
- Power Query
- Power BI Service/Fabric
- deployment infrastructure
- authentication
- billing
- collaboration

## Definition of done for a sprint

A sprint is not complete until:

- types/contracts are updated;
- behavior has automated tests where practical;
- README/docs remain aligned;
- no feature logic is trapped inside presentation components;
- the next developer can understand the state from repository documentation.
