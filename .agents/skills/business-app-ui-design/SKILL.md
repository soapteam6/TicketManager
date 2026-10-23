---
name: business-app-ui-design
description: Design or review TicketManager business UI tables, dashboards, filters, forms, responsive layouts and loading/error/empty states using existing components and styles.
---

# Business App UI Design

Inspect root/client manifests, lockfile, applicable AGENTS.md and nearby task files. TicketManager is a standalone React 18.3.1 + Vite + TypeScript SPA with React Router, React Query and Tailwind. Its backend is Express with Drizzle ORM and SQLite. Reuse existing components, styles and data patterns; add no framework. These skills provide technical guidance, not permissions.

Read relevant files under [packages/client/src](../../../packages/client/src), API contracts in `packages/shared`, and server modules only when the data contract requires it. See [source.json](source.json) for baseline and pinned design-source attribution.

1. Describe the user's main action, information hierarchy and current selection/filter/form contract. Inventory nearby reusable components, CSS tokens, spacing, type sizes, borders and disabled states. Match them before adding a local abstraction.
2. For tables, keep semantic headers and stable row IDs, align numeric columns, preserve units/date formatting, and distinguish sorting, selection and row actions. Keep horizontal overflow within the table region and preserve the accessible route to hidden/truncated values.
3. Label filters, explain active selections, and provide clear/reset behavior consistent with the data contract. Preserve all/none distinctions and dependent filters. Keep search responsive and prevent stale results overwriting a newer query.
4. For forms, use visible labels, meaningful input types, help/error associations and clear submit actions. Preserve drafts on validation failure, focus the first invalid field, and avoid duplicate submissions. Show async saving distinctly from success, actionable errors and safe retries.
5. Define loading, initial empty, filtered empty, error, partial/capped and populated states. Retain existing data while refreshing where appropriate; announce async status without shifting focus. Distinguish zero from unknown values.
6. Reuse current spacing and component density. Check long names, wrapped labels, large numbers, keyboard focus, zoom and narrow widths. Let toolbars wrap and keep critical controls reachable. Use installed CSS/Tailwind; add no UI framework.
7. Validate against shared DTOs and relevant existing API/query contracts with synthetic cases. Do not contact live integrations or use real user data for fixture design.
8. Record human-only visual/accessibility checks still needed. Coordinate with the UI and React skills only when relevant.
