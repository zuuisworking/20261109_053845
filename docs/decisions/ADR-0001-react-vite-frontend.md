# ADR-0001: React, Vite, TypeScript, and Tailwind CSS Frontend

## Status

Accepted — implemented in the repository and reconciled on 27 November 2026. Production release remains subject to the gates in the [implementation plan](../implementation-plan.md).

## Date

Originally 2026-11-26; implementation reconciliation 2026-11-27.

## Context

The supplied `SIGAP ULP LABUHAN.html` was a single-file application with inline Tailwind, CDN assets, manual DOM mutation, and client-side simulated data. The operational system requires a modular browser application that can consume a secured API, preserve the PLN identity, and be tested without making browser state a second data authority.

## Decision

1. Use React in `frontend/`, with the repository currently pinned to React 19.
2. Use Vite 8 for development and production builds.
3. Use TypeScript 7 with strict type checking and relative imports.
4. Configure Tailwind CSS 4 locally with the PLN palette: `plnBlue (#00A2E9)`, `plnDark (#005b82)`, `plnTeal (#00B4CB)`, `plnYellow (#FFF000)`, and `plnRed (#ED1C24)`.
5. Preserve Plus Jakarta Sans and the supplied PLN visual assets.
6. Organize the application by responsibility: `components/ui`, `components/tables`, `components/modals`, `components/layout`, `features/`, `context/`, `hooks/`, `services/`, and `types/`.
7. Use one typed API client and one contract-normalization module. Components do not build backend URLs or raw response shapes.
8. Use Leaflet/OpenStreetMap for the canonical transformer map.
9. Keep canonical master data in API-backed view state rather than `localStorage`/`sessionStorage`; session/CSRF remain server-controlled cookies.
10. Use Vitest/React Testing Library for unit/component tests and Playwright for end-to-end/visual evidence.

## Consequences

### Positive

- TypeScript checks API/resource boundaries before runtime.
- Domain views remain separable and testable.
- The supplied identity and workflows can be evolved without retaining the monolith's simulated data path.
- Build output is reproducible from the checked-in frontend manifest/lockfile.

### Negative and operational

- React 19/Vite 8/TypeScript 7 require deliberate dependency and configuration review.
- The frontend must support both the backend's canonical `{data, meta?, counts?}` envelopes and defensive normalization of legacy-shaped payloads.
- Visual preservation is accepted only through supported-state screenshot/e2e evidence, not an unconditional pixel-identity claim.

## Alternatives considered and rejected

| Alternative | Reason rejected |
|---|---|
| Keep the single-file HTML application | Cannot provide the required API/security boundaries or maintainable tests. |
| Use a different component framework | Adds migration cost without a demonstrated requirement. |
| Adopt Next.js/SSR | Adds server-runtime complexity not needed for the current browser/API application. |
| Persist canonical records in browser storage | Creates a stale/divergent second authority and increases PII exposure. |
| Build map points in the client from unvalidated data | Risks coordinate-order errors and fake map positions. |

## Related documents

- [Frontend architecture](../architecture/frontend.md)
- [API contract](../api/overview.md)
- [ADR-0004](ADR-0004-leaflet-openstreetmap-migration.md)
