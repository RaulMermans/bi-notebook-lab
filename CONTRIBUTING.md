# Contributing

Issues and pull requests are welcome. Before opening a PR:

1. Read [`AGENTS.md`](./AGENTS.md) for the architectural guardrails. The most important one: BI semantics live in framework-free TypeScript that runs headlessly, never in React components.
2. Run the same checks as CI:

   ```bash
   npm run typecheck
   npm test
   npm run build
   ```

3. When you change DAX or Power Query behaviour, add or update a conformance case in `tests/conformance/` and state where the expected value comes from.

Keep changes within the documented scope. See the scope guardrail in the [README](./README.md#scope-guardrail).
