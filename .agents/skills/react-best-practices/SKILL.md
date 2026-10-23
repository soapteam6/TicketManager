---
name: react-best-practices
description: Apply Vercel React performance guidance to TicketManager's client-side React 18/TypeScript/Vite UI, data loading, lists, filtering and rendering.
---

# React Best Practices

Inspect the manifests, lockfile, applicable AGENTS.md and task files first. TicketManager uses React 18.3.1, Vite, React Router, React Query and TypeScript. Preserve installed APIs; React 19-only APIs are not available unless the project is deliberately upgraded. These skills provide technical guidance, not permissions.

Apply the relevant client-side subset of Vercel Engineering's React guidance. Read linked rules only when they address the task. See [source.json](source.json) and [LICENSE](LICENSE) for pinned provenance and attribution.

1. Trace component inputs, effects, derived state and data boundaries under [packages/client/src](../../../packages/client/src); inspect shared DTOs in `packages/shared` and corresponding API modules in `packages/server` when needed. Identify a concrete render, bundle or loading problem before optimizing.
2. Start independent, already-authorized reads together when useful; handle rejection, partial failure and stale responses intentionally. Do not turn a synthetic check into live data access.
3. Prefer derived values, functional updates, pure lazy initializers and stable component definitions. Account for StrictMode repeating effect setup in development. Catch storage/JSON failures; keep side effects out of initializers.
4. For expensive filtering, consider `useDeferredValue` and retain responsive input. Defer expensive child rendering as well as computation. Avoid memoization for cheap expressions and do not assume React Compiler.
5. Preserve stable row keys, focus, selection and existing React Query cache behavior. Add no state or data-fetching library just to satisfy a rule.
6. Consider `content-visibility` only when compatible with table layout, sticky headers, accessibility and find-in-page. Use existing Vite imports or React.lazy with local fallback/error handling for genuinely heavy optional UI.
7. Clean up listeners, timers and subscriptions; keep effect dependencies accurate and prevent stale responses replacing newer searches.
8. Run only inspected, relevant local checks and report unmeasured performance claims as hypotheses. Next.js, RSC, server actions, SSR cache and hydration guidance is not applicable to this SPA.
