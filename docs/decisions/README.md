# Architecture Decision Records (ADR) — SIGAP ULP Labuhan

These records describe the normative architecture implemented in the repository. **Accepted** means the decision is implemented as the repository contract; it does **not** mean that production migration, external synchronization, deployment, or release approval has succeeded.

The records were reconciled against the current backend, frontend, schema, migration, and test code on 27 November 2026. The historical pre-implementation baseline remains in the [Phase 0 audit](../audit/phase-0-audit.md).

| ADR ID | Decision | Status | Original date | Reconciled |
|---|---|---|---|---|
| [ADR-0001](ADR-0001-react-vite-frontend.md) | React, Vite, TypeScript, and Tailwind CSS frontend | Accepted / implemented | 2026-11-26 | 2026-11-27 |
| [ADR-0002](ADR-0002-modular-backend-express-mongoose.md) | Modular Express/Mongoose backend with CommonJS | Accepted / implemented | 2026-11-26 | 2026-11-27 |
| [ADR-0003](ADR-0003-mongodb-data-modeling.md) | Data authority, canonicalization, and MongoDB modeling | Accepted / implemented | 2026-11-26 | 2026-11-27 |
| [ADR-0004](ADR-0004-leaflet-openstreetmap-migration.md) | Leaflet/OpenStreetMap with canonical GeoJSON | Accepted / implemented | 2026-11-26 | 2026-11-27 |
| [ADR-0005](ADR-0005-secure-cookie-session-auth.md) | Revocable opaque sessions and session-bound CSRF | Accepted / implemented | 2026-11-26 | 2026-11-27 |
| [ADR-0006](ADR-0006-import-preview-and-upsert.md) | Persisted import preview and validated upsert | Accepted / implemented | 2026-11-26 | 2026-11-27 |
| [ADR-0007](ADR-0007-google-form-sync-integration.md) | Server-only Google guest synchronization with fingerprint idempotency | Accepted / implemented; external contract open | 2026-11-26 | 2026-11-27 |
| [ADR-0008](ADR-0008-docker-compose-vps-deployment.md) | Containerized Docker-host VPS deployment | Accepted / artifacts implemented; runtime evidence open | 2026-11-26 | 2026-11-27 |

## Decision lifecycle

| Status | Meaning |
|---|---|
| Proposed | The decision is still under discussion and has no implemented gate |
| Accepted | The decision is implemented as the repository contract; production release may still be blocked |
| Superseded | The decision was replaced by another ADR recorded in the superseding decision |
| Rejected | The alternative was not selected; the reason is recorded in the related ADR |

A material decision change requires a new ADR or an explicit `Superseded` status, not an undocumented prose change.
