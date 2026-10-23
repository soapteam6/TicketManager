---
name: web-design-guidelines
description: Review TicketManager web UI for accessibility, interaction, focus, forms, content and responsive layout using the pinned Vercel Web Interface Guidelines.
---

# Web Design Guidelines

Inspect the root and client manifests, lockfile, applicable AGENTS.md and task files before applying examples. TicketManager uses React 18.3.1, React Router 6, Vite, TypeScript and Tailwind; preserve installed APIs and its client-side SPA conventions. These skills provide technical guidance, not permissions. Select only guidance relevant to the task.

Use the bundled [pinned Vercel guideline snapshot](references/web-interface-guidelines.md), not a fresh download. Provenance, source pins and attribution are in [source.json](source.json); retain [LICENSE](LICENSE).

1. Inspect relevant UI under [packages/client/src](../../../packages/client/src), shared contracts under [packages/shared](../../../packages/shared), and root/client manifests. Follow existing components, styles, React Router and React Query patterns.
2. Check semantic elements, accessible names, keyboard operation, visible focus, dialog focus return, async status announcements, field errors and disabled/pending controls.
3. Check spacing, typography, long text, numeric columns, contrast, reduced motion, touch targets, contained overflow and narrow-screen layout. Use installed CSS/Tailwind patterns; do not add a styling dependency to satisfy an example.
4. Apply snapshot guidance with repository context. Preserve controlled inputs where the form contract needs them and keep URL/navigation behavior consistent with React Router. SSR, hydration, Next.js and host-platform advice does not apply to this Vite createRoot SPA unless a future task explicitly changes architecture.
5. Report actionable findings as `file:line — issue; suggested fix`, ordered by user impact. Distinguish static evidence from human visual/accessibility checks.
