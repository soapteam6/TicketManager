---
name: platform-compatibility-review
description: Conditional static review for an explicitly scoped Power Apps Code App integration or migration; not applicable to routine TicketManager work.
---

# Platform Compatibility Review (Conditional)

**Not applicable to the current application architecture.** TicketManager is a standalone React 18.3.1/Vite SPA with React Router and an Express/Drizzle/SQLite backend; it is not a Power Apps Code App. This skill must not cause Power Apps SDK imports, platform configuration, generated Power Platform boundaries, or false claims about TicketManager.

Use only when a task explicitly requests a separate Code Apps integration or migration and scope it independently. Consult pinned sources and limitations in [source.json](source.json); retain the [CC BY 4.0 license](LICENSE). Distinguish platform-sourced facts from inferences and date-sensitive limits.

For routine TicketManager tasks, inspect installed dependencies and existing browser/API boundaries. Do not initialize environments, authenticate, call connectors, edit credentials or generated schemas, deploy, or infer production compatibility from a local build. Do not follow upstream platform setup/publishing workflows.
