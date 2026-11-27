# Functional Requirements — SIGAP ULP Labuhan

These requirements describe the implemented repository contract. The exact request/response shape is normative in the [REST API contract](../api/overview.md); collection fields and indexes are normative in the [implemented schema](../database/schema.md).

## FR-01: Authentication and account management

- **FR-01.1**: The system shall authenticate an active administrator by administrator ID and password, using a bcrypt password hash with work factor 10.
- **FR-01.2**: The system shall use a random 32-byte opaque session token in an `HttpOnly`, `SameSite=Lax`, path-scoped cookie. The database shall store only its HMAC-SHA-256 hash keyed by `SESSION_SECRET`.
- **FR-01.3**: The system shall expire sessions server-side, revoke them on logout/password change/account deactivation, and never return raw session or CSRF tokens in JSON.
- **FR-01.4**: The system shall issue an independent random 32-byte CSRF token, store only its SHA-256 hash, expose it through the SPA-readable `sigap_csrf` cookie, and require the cookie value to equal `X-CSRF-Token` for unsafe methods.
- **FR-01.5**: Unsafe methods shall require an authenticated session, a session-bound CSRF token, and an exact configured `Origin`. Credentialed CORS shall allow only configured exact origins.
- **FR-01.6**: Public registration shall be disabled. Initial administrator provisioning shall use a controlled server-side CLI with explicit input; creating another administrator shall require an authenticated `superadmin`.
- **FR-01.7**: `PUT /auth/profile` shall accept only `fullName` and `email`. Avatar upload shall use the separate multipart `POST /auth/profile/avatar` endpoint, and avatar retrieval shall use `GET /auth/avatar/:userId` with the documented ownership/superadmin rule.
- **FR-01.8**: Production shall not start with a usable default administrator credential or a predictable secret fallback.

## FR-02: Dashboard and GIS

- **FR-02.1**: The system shall summarize total, analyzable, not-analyzable, pincang, and overload transformer counts for the selected WBP/LWBP period, plus customer and guest totals.
- **FR-02.2**: `notAnalyzableTotal` shall count records that lack valid electrical-analysis eligibility for the selected period.
- **FR-02.3**: The dashboard shall retain summaries for both periods while using the selected period for anomaly counts, previews, and map statuses.
- **FR-02.4**: The map shall consume backend GeoJSON `FeatureCollection` data with `Point` coordinates ordered `[longitude, latitude]` and shall render only valid point features.
- **FR-02.5**: The map popup shall show available transformer name, feeder, capacity, and analysis status and shall provide a detail action.
- **FR-02.6**: Tile/API failure shall not fabricate a marker, coordinate, transformer, or canonical record.

## FR-03: Transformer management and electrical analysis

- **FR-03.1**: Transformer list queries shall use server-side pagination, bounded search, feeder filtering, and a selected `wbp`/`lwbp` period. Implemented list endpoints do not expose a `sort` parameter.
- **FR-03.2**: The all-transformer list shall return top-level `counts` containing `total`, `analyzable`, `notAnalyzable`, `pincang`, and `overload`; `meta.total` shall be the filtered total.
- **FR-03.3**: Anomaly views shall use `GET /transformers/anomalies` with category `unbalanced` or `overloaded`, not client-side filtering of the full population.
- **FR-03.4**: The system shall calculate average current, maximum phase deviation/unbalance percentage, nominal current from numeric kVA, and loading percentage using the formulas in the API contract.
- **FR-03.5**: Electrical eligibility shall require complete R/S/T incoming currents, nonnegative values, positive average current, and positive `capacityKva`. Otherwise numeric results shall be `null` and the operational status shall be `not_applicable`.
- **FR-03.6**: Pincang shall be strictly greater than 10%; overload shall be strictly greater than 80%.
- **FR-03.7**: Recommendation critical shall be unbalance greater than 15% or neutral current greater than 40 A; visual unbalance shall be warning above 10% and critical above 20%. Overload shall take priority.
- **FR-03.8**: Backend operational statuses shall be `normal`, `warning`, `critical`, `overload`, or `not_applicable`; an unavailable visual/map/recommendation status shall be `unknown`.
- **FR-03.9**: Transformer create/update shall use full replacement for writable fields: `name` is required, and omitted `feeder`, `capacity`, `capacityKva`, `brand`, `grounding`, `location`, and `rawCoordinates` shall clear their previous values.
- **FR-03.10**: Transformer display names shall be trim + Unicode NFC, and `nameKey` shall be NFC + trim + Unicode full case folding with a unique `transformer_name_key_unique` index.
- **FR-03.11**: Operator-created provenance shall use `source: "operator"`; an update shall preserve existing provenance. Capacity shall hold one numeric kVA value; a compound label shall remain raw for review.
- **FR-03.12**: Canonical location shall be GeoJSON `Point` `[longitude, latitude]`. When raw coordinates accompany a location, they shall parse to the same longitude/latitude pair.

## FR-04: Measurement management

- **FR-04.1**: The system shall store at most one current measurement per `(transformerId, period)`, with `period` equal to `wbp` or `lwbp`.
- **FR-04.2**: Measurements shall support `GET` and `PUT`; `POST /measurements/:transformerId` shall return `405` with `Allow: GET, PUT`.
- **FR-04.3**: A manual `PUT` shall require the selected period, complete R/S/T voltage, and complete incoming R/S/T/N values; it shall replace the period document, clear omitted date/time/branches, set `source: "manual"`, and clear `sourceRecordKey`.
- **FR-04.4**: Measurement date shall use `YYYY-MM-DD`, measurement time shall use `HH:mm`, and absent source date/time shall remain null rather than being copied from server timestamps.
- **FR-04.5**: Embedded transformer measurements shall expose canonical string IDs and the fields defined by the API contract, without MongoDB `_id`.

## FR-05: Customer and guest management

- **FR-05.1**: Customer list queries shall use server-side pagination and bounded search by customer ID, name, and address.
- **FR-05.2**: `customerId` shall be a string containing exactly 12 ASCII digits and shall preserve leading zeros.
- **FR-05.3**: Customer responses shall expose raw power text as `power` and the derived nonnegative integer as `powerVa`. Missing or malformed power shall not become zero.
- **FR-05.4**: Customer `PUT` shall require `customerId` and `name`; omitted writable optional fields shall clear rather than preserve their previous values.
- **FR-05.5**: The backend shall fetch guest data only from the server-configured Google Apps Script endpoint. The frontend shall send only `{}` and shall not expose an Apps Script URL.
- **FR-05.6**: Each guest record shall be validated independently. Malformed records shall be counted as rejected and shall not create fallback rows.
- **FR-05.7**: A versioned SHA-256 fingerprint and unique `syncFingerprint` index shall make repeated synchronization idempotent.
- **FR-05.8**: Guest responses shall expose parsed `timestamp`, original `timestampRaw`, `syncedAt`, `source`, and `sourceRecordId`; `syncedAt` shall never replace the source visit time.

## FR-06: Import and export

- **FR-06.1**: The system shall support transformer/customer CSV and customer XLSX import with encoding-aware parsing and the semicolon delimiter used by the canonical customer source.
- **FR-06.2**: The canonical customer CSV shall be parseable as CP1252 with RFC 4180 quoting, including addresses containing internal semicolons.
- **FR-06.3**: Preview shall compare every source row and report total, valid, insert, update, unchanged, rejected, and field-level issues.
- **FR-06.4**: Preview state shall be persisted as a 24-hour `ImportJob`; source and diff artifacts shall be stored in GridFS and bound by SHA-256.
- **FR-06.5**: Commit shall be bound to the original owner, opaque preview token, expiry, status, and source hash. It shall use a renewable 15-minute lease and 1,000-row batches.
- **FR-06.6**: Commit shall write only validated insert/update rows, shall not delete records, shall detect changed target records with `409 IMPORT_TARGET_CONFLICT`, and shall return the stored result for a repeated successful commit.
- **FR-06.7**: Committed transformer/customer provenance shall be `source: "operator_import"`, source file/row, and `sourceMetadata.importJobId`.
- **FR-06.8**: Missing source values shall remain null; import shall not invent tariff, power, capacity, alias, date, or time values.
- **FR-06.9**: Rows and issues shall be owner-scoped; `superadmin` may inspect another job, while commit remains bound to the original owner.
- **FR-06.10**: The system shall export transformer, customer, and guest data to CSV/XLSX. CSV shall use semicolon delimiters, UTF-8 BOM, and spreadsheet-safe quoting/formula neutralization.
- **FR-06.11**: Export shall enforce a 100,000-row maximum and return an explicit error for a larger population instead of silently truncating or returning a partial file.
- **FR-06.12**: Export shall enforce a maximum output-byte ceiling in addition to the row ceiling, shall not hold the complete export in memory, and shall reject exports above the configured concurrent-export limit with an explicit error.

## FR-07: Canonical data and migration

- **FR-07.1**: `.temp/sigap/` shall remain read-only for runtime, migration, tests, and deployment.
- **FR-07.2**: The transformer CSV shall be canonical master data with 1,238 records.
- **FR-07.3**: The customer CSV shall be the canonical import path with 68,742 records; the XLSX shall be an equivalent row-for-row cross-check.
- **FR-07.4**: The HTML source shall be interpreted as 53 transformer names containing 106 period objects. Forty-six reconciled names shall produce 92 eligible period records; seven unresolved names shall produce 14 unresolved period records until explicit aliases are approved.
- **FR-07.5**: Migration shall be dry-run capable, encoding-aware, schema-validated, idempotent, progress-reporting, and mismatch-reporting.
- **FR-07.6**: Migration/import shall not fabricate a missing source value, date, time, alias, or transformer.
- **FR-07.7**: Transformer identity shall be backfilled with `npm run migrate:transformer-name-keys`. Missing/mismatched keys shall fail with `TRANSFORMER_NAME_KEY_BACKFILL_REQUIRED`; duplicate keys shall fail with `TRANSFORMER_IDENTITY_DUPLICATE_KEYS` without merging or deleting records.

## FR-08: Auditability and operational feedback

- **FR-08.1**: Every API response shall include `X-Request-ID`; a valid inbound request ID shall be reused and an invalid one shall be replaced with a UUID.
- **FR-08.2**: Success bodies shall use `{data: ...}`; lists shall use top-level `meta`, and transformer/anomaly lists shall also use top-level `counts`. Errors shall use `{error: {code, message, details?}}`.
- **FR-08.3**: Import jobs shall persist actor, source hash, summary, expiry, lease/progress, and commit result, and shall expose at most 100 inline issues with pagination for the complete set.
- **FR-08.4**: Session and import-job state shall be revocable/expirable on the server and shall have TTL cleanup.
- **FR-08.5**: Dashboard, export, health, and operational feedback shall distinguish source timestamps from server processing timestamps.

## Implementation status

The behaviors above are present in the current repository contract and test suite. Production migration approval, the seven aliases, the real Google Apps Script contract, production image scan/publication, and operational deployment remain release gates; see the [implementation plan](../implementation-plan.md) and [testing strategy](../testing/strategy.md).
