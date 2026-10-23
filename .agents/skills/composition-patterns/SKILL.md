---
name: composition-patterns
description: Apply React composition patterns to reusable TicketManager components, prop APIs, variants and shared UI state.
---

# React Composition Patterns

Inspect manifests, lockfile, applicable AGENTS.md and task files. TicketManager uses React 18.3.1 with TypeScript, Vite and React Router. Preserve current web component, context and ref conventions; do not adopt React 19-only syntax. Provenance and license are in [source.json](source.json) and [LICENSE](LICENSE).

Use Vercel's selected composition rules with existing UI under [packages/client/src](../../../packages/client/src) and typed API contracts under `packages/shared`.

1. Identify the concrete state owner, consumers and invalid prop combinations. Prefer a small explicit API before introducing abstractions.
2. Replace proliferating mode booleans with [explicit variants](rules/patterns-explicit-variants.md) and [composition](rules/architecture-avoid-boolean-props.md) when that removes invalid states. Keep independent booleans such as `disabled` or `selected`.
3. Prefer [children for structure](rules/patterns-children-over-render-props.md); retain render callbacks when a table/grid API supplies row data. Use [compound components](rules/architecture-compound-components.md) only when parts truly share behavior.
4. [Lift shared state](rules/state-lift-state.md) to the nearest common owner, [define a typed interface](rules/state-context-interface.md), and [isolate its implementation](rules/state-decouple-implementation.md). Keep API access in existing client data/service boundaries, not view components.
5. Translate upstream framework examples to installed web APIs and CSS patterns. Examples are guidance, not a reason to add dependencies.
6. Preserve React 18 `useContext`, `Context.Provider` and `forwardRef` conventions as needed; do not rewrite working code to React 19 syntax.
7. Verify keyboard/focus behavior, form submission, controlled values and loading/error/empty states with typed synthetic scenarios and static checks. Refactor only requested scope.
