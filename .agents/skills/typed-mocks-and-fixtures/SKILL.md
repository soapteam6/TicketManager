---
name: typed-mocks-and-fixtures
description: Create deterministic synthetic fixtures and typed mock adapters matching TicketManager's shared DTOs and existing client/server contracts.
---

# Typed Mocks and Fixtures

Inspect the root/client/server manifests, lockfile, applicable AGENTS.md and task files. TicketManager is a standalone React 18.3.1 + Vite client and Express/Drizzle/SQLite server. See shared contracts in [packages/shared](../../../packages/shared), client data access in `packages/client/src`, and server modules/tests in `packages/server/src`. Preserve existing APIs and injection seams. These skills provide technical guidance, not permissions.

Microsoft Code Apps architecture content in the pinned provenance is conditional background only: TicketManager is not a Code App and must not gain Power Platform dependencies or host assumptions. Review [source.json](source.json) and retain [LICENSE](LICENSE).

1. Trace exact input/output types, nullable fields, enums, dates, identifiers, errors and pagination from shared DTOs and consumers. Prefer existing interfaces; avoid invented generic JSON envelopes.
2. Implement existing interfaces or use `satisfies` against real types. Do not conceal mismatches with `any`, double casts or ignored type errors. Keep fixture view models separate from API DTOs and preserve mapping layers.
3. Place mock behavior behind an existing injection seam. If none exists, propose a narrow typed seam rather than changing runtime defaults. Keep writes in-memory/resettable and ensure no fallback to live services when mocks fail.
4. Use invented people/organizations, `.invalid` email addresses, fixed timestamps and stable fixture IDs. Preserve relations, enum values, null-vs-undefined semantics and domain invariants. Never seed from production exports, credentials or actual user identifiers.
5. Cover success, empty/single/multiple rows, pending, errors, retries, partial results and pagination where supported. Use finite delays and deterministic failures; preserve cancellation, stale-response behavior and stable ordering.
6. Keep fixtures separate from presentation and select them only through an established provider/configuration seam. No environment edits merely to preview.
7. Validate using installed compilers or reviewed local contract checks against synthetic inputs. Inspect imports for accidental live API, AI, upload, or integration calls. Report compile evidence separately from unperformed service/integration tests; do not install tools or call real services.
