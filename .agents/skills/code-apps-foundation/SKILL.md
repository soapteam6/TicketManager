---
name: code-apps-foundation
description: Conditional guidance for a future task that explicitly involves migrating TicketManager to or integrating it with a Power Apps Code App. Not applicable to routine TicketManager development.
---

# Code Apps Foundation (Conditional)

**Not applicable to routine TicketManager work.** TicketManager is a standalone React 18.3.1/TypeScript/Vite SPA with an Express/Drizzle/SQLite backend; it is not a Power Apps Code App. This skill must not be used to relabel its architecture, introduce Power Platform dependencies, initialize environments, or change runtime behavior.

Use only when a task explicitly concerns a separately scoped Code Apps migration or integration. First distinguish proposed platform work from the existing app architecture and consult the pinned sources in [source.json](source.json), retaining [LICENSE](LICENSE). Any platform-specific recommendations are conditional and do not supersede TicketManager's existing tooling unless a migration is explicitly in scope.

For normal implementation, use repository manifests and instructions, existing npm scripts, React Query/API boundaries, shared TypeScript contracts, and Express/Drizzle/SQLite architecture. Do not follow upstream authentication, connection discovery, environment initialization, CLI publishing/deployment, template download, overwrite, or persistent permission workflows.
