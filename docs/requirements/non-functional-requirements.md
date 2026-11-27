# Non-Functional Requirements — SIGAP ULP Labuhan

These requirements distinguish implemented repository controls from production evidence that is still required. A green repository gate does not by itself approve production deployment.

## 1. Performance and scalability

- **NFR-01**: Customer search against the canonical 68,742-record population shall use indexed, bounded, database-side predicates. The initial operational latency target is below 500 ms on an approved profile/environment; repository tests do not prove that production target.
- **NFR-02**: Transformer/customer pagination shall occur in the database; the browser and API shall not load the full population merely to filter it.
- **NFR-03**: The Leaflet map shall remain usable with the 1,238-transformer target population. Clustering or viewport filtering may optimize rendering, but counts and exports shall not silently omit records.
- **NFR-04**: Export shall not use an implicit 20,000-row cut-off. The implemented safe maximum is 100,000 rows; a larger set shall produce an explicit error and no partial file. The row ceiling alone does not bound the produced bytes, so export shall also enforce a 64 MiB output-byte ceiling, shall never buffer the complete export in memory, and shall cap the number of exports generated concurrently.
- **NFR-05**: Import preview shall compare every source row. A performance optimization shall not reduce the checked population to a sample.
- **NFR-06**: Import commit shall use bounded 1,000-row batches. A 15-minute renewable lease and persisted progress shall make retry/recovery bounded.

## 2. Security and compliance

- **NFR-07**: Passwords shall be stored only as bcrypt hashes with work factor at least 10.
- **NFR-08**: Sessions shall use an opaque random token, `HttpOnly`/`SameSite=Lax`/production-secure cookie, HMAC-SHA-256 server-side hash storage, absolute expiry, and revocation.
- **NFR-09**: Unsafe requests shall require a session-bound CSRF token and an exact allowed `Origin`; `SameSite` shall not be the only control.
- **NFR-10**: Credentialed CORS shall allow only exact configured origins. Arbitrary-origin reflection and wildcard credentials are prohibited.
- **NFR-11**: Login shall be rate limited. The guest-sync route shall have its own dedicated rate limit scoped to the authenticated user and the trusted client address, and concurrent guest-sync requests shall be coalesced into one active upstream fetch and database upsert.
- **NFR-12**: Request, upload, avatar, import, upstream-response, and export sizes shall be explicitly bounded.
- **NFR-13**: CSV/XLSX export shall neutralize spreadsheet formulas and quote unsafe content.
- **NFR-14**: MongoDB shall not be exposed to the public network in the approved deployment topology.
- **NFR-15**: Production shall not start with a default administrator password, reusable secret, or predictable secret fallback.
- **NFR-16**: Dependency/container/secret scan results shall be release evidence; a critical/high finding shall block release unless an approved, dated exception exists.
- **NFR-17**: The Google endpoint and credential shall remain server-side, and the outbound request shall use HTTPS, host/path validation, bounded redirects, a timeout, and a response-size limit.
- **NFR-18**: The Google request-authentication strategy is not implemented and remains a production release gate.

## 3. Reliability and data integrity

- **NFR-19**: `.temp/sigap/` shall not be modified, moved, or deleted by runtime, migration, tests, or deployment.
- **NFR-20**: Missing source values and dates shall remain null; no quiet default shall change source facts.
- **NFR-21**: Transformer `nameKey`, customer ID, guest fingerprint, import token/job ID, alias key, and `(transformerId, period)` shall be protected by unique indexes.
- **NFR-22**: Migration and import shall be dry-run capable, encoding-aware, schema-validated, idempotent, progress-reporting, and mismatch-reporting.
- **NFR-23**: Customer CSV/XLSX shall be reconciled for all 68,742 rows; a mismatch shall block the migration.
- **NFR-24**: Import preview/commit shall be bound to owner, token, expiry, status, and source hash. An expired, tampered, foreign-owner, or replayed job shall not write.
- **NFR-25**: Export shall not silently truncate; a result above the maximum shall produce an explicit error and no partial file.
- **NFR-26**: Google synchronization shall fail closed and shall not insert fallback/static records.
- **NFR-27**: Sessions and import jobs shall have server-side expiry/revocation and TTL cleanup. TTL deletion is asynchronous and shall not replace the authorization check.
- **NFR-28**: Backup and restore shall be rehearsed in an isolated environment. Production migration shall have an approved snapshot and rollback procedure.
- **NFR-29**: Health/readiness shall be available without disclosing a secret. The repository does not claim a complete production metrics/trace pipeline.

## 4. Privacy and auditability

- **NFR-30**: Customer PII access, export, audit, and retention shall follow an approved policy before production.
- **NFR-31**: Normal logs shall not contain raw session/CSRF tokens, passwords, MongoDB URI, Google endpoint/credential, upstream bodies, or unnecessary PII.
- **NFR-32**: `X-Request-ID` shall connect responses and internal handling without exposing internal exception details.
- **NFR-33**: Import actor, source hash, diff summary, commit result, and alias approval shall be auditable.
- **NFR-34**: Source visit time, source date/time, and server processing/synchronization time shall remain distinguishable.

## 5. Usability and visual fidelity

- **NFR-35**: The frontend shall preserve the supplied identity and workflow states: Plus Jakarta Sans, the PLN palette/assets, sidebar/header, tables/filters, modals, and notifications.
- **NFR-36**: Preservation shall be demonstrated through visual regression and end-to-end evidence for supported states, not an unsupported unconditional pixel-identity claim.
- **NFR-37**: The UI shall be responsive from the approved laptop/tablet baseline.
- **NFR-38**: Error states shall distinguish validation, authentication/session, authorization/CSRF, rate limit, dependency, and upstream failure without revealing internal errors.
- **NFR-39**: Interactive controls shall be keyboard operable, have accessible names, and maintain visible focus states.
- **NFR-40**: No UI state shall present fallback/placeholder data as canonical data.
- **NFR-41**: The frontend shall consume the anomaly endpoint for anomaly views, consume backend GeoJSON without reversing coordinates, and preserve nullable values.

## 6. Maintainability and observability

- **NFR-42**: API, schema, migration, ADR, requirements, and frontend types shall change together when a representation or validation contract changes.
- **NFR-43**: Errors shall have stable machine-readable codes and safe field-level details.
- **NFR-44**: Dependency/runtime/container versions shall be pinned and supported. The production support matrix remains an unresolved release decision.
- **NFR-45**: CI shall run relevant lint, typecheck, unit, integration, contract, build, end-to-end/visual, security, license, and ground-truth gates and retain evidence.
- **NFR-46**: Transformer identity shall be enforced consistently by migration, import matching, model hooks, and the production startup gate.
- **NFR-47**: A duplicate canonical transformer key shall abort without merging or deleting records; canonical migration/import matching shall use the same `nameKey` rule.

## 7. Current evidence boundary

The 27 November 2026 repository evidence covers unit/integration/script/frontend tests, typecheck, build, API-contract, security/license, action-pin, actionlint, shell-syntax, Gitleaks, Trivy filesystem and container-image, Mermaid-parse, Markdown-link, and ground-truth checks. Playwright end-to-end/visual evidence covers desktop/mobile Chromium in an isolated database. The disposable local Docker image build, Compose runtime health check, and scoped MongoDB backup/restore identity smoke rehearsal passed on the current tree. Production migration, a production-approved backup/restore rehearsal, external Google smoke testing, production image publication, and deployment remain open.
