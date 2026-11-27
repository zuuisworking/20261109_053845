# Canonical Data Dictionary — SIGAP ULP Labuhan

This dictionary maps the supplied sources and runtime inputs to the canonical representation. `.temp/sigap/` is read-only ground truth and is never changed by runtime, migration, tests, or deployment.

The complete field/index contract is normative in the [implemented schema](../database/schema.md). API response fields are normative in the [REST API contract](../api/overview.md).

## 1. Verified source profiles

| Source | Verified profile | Authority |
|---|---|---|
| `Manajemen Trafo (SupaBase).csv` | UTF-8 with BOM; semicolon; CRLF; 1,238 data rows | Transformer master |
| `Data Pelanggan (SupaBase).csv` | CP1252-compatible; semicolon; CRLF; 68,742 data rows | Customer canonical import path |
| `Data Pelanggan.xlsx` | 68,742 equivalent records; numeric power agrees after declared normalization | Customer cross-check |
| `SIGAP ULP LABUHAN.html` | 53 transformer names containing 106 period objects | Measurement source and UI reference |

The measurement source contains **53 transformer names**, not 53 independent measurement records. Forty-six names reconcile to canonical transformer IDs and yield 92 eligible period records; seven unresolved names yield 14 unresolved period records.

## 2. Transformer

| Source/runtime input | Storage field | Type | Nullable | Validation/transformation | Authority |
|---|---|---|---|---|---|
| `nama_trafo` / operator name | `name` | String | No | Trim + Unicode NFC; maximum 200 characters | Transformer CSV / operator |
| Derived from `name` | `nameKey` | String | No | NFC + trim + Unicode full case folding; unique; maximum 600 characters after case expansion | Transformer CSV / operator |
| `penyulang` / operator feeder | `feeder` | String | Yes | Trim; no default; maximum 200 characters | Transformer CSV / operator |
| `kapasitas` / operator label | `capacity` | String | Yes | Preserve one label; compound labels remain raw; maximum 200 characters | Transformer CSV / operator |
| One unambiguous numeric kVA | `capacityKva` | Number | Yes | Finite, strictly positive, and at most 1,000,000 kVA; null for compound/ambiguous labels | Transformer CSV / approved operator mapping |
| operator brand | `brand` | String | Yes | Trim; no default | Operator |
| operator grounding | `grounding` | String | Yes | Trim; no default | Operator |
| `titik_koordinat` / operator point | `location` | GeoJSON `Point` | Yes | Coordinates exactly `[longitude, latitude]`; both finite and valid | Transformer CSV / operator |
| coordinate source text | `rawCoordinates` | String | Yes | Preserve trimmed source text; when location exists it shall parse to the same pair | Transformer CSV / operator |
| provenance kind | `source` | String | Yes | Trimmed; no enum in the current model | Runtime |
| provenance file/row | `sourceFile`, `sourceRow` | String, Number | Yes | File maximum 255 characters; row is one-based | Runtime |
| structured provenance | `sourceMetadata` | Mixed | Yes | For example `importJobId` | Runtime |

### Identity and coordinate rules

- Display identity: `name` = trim + NFC.
- Business identity: `nameKey` = NFC + trim + Unicode full case folding.
- Canonical unique index: `transformer_name_key_unique` on `{nameKey: 1}`.
- Exact migration CLI: `npm run migrate:transformer-name-keys` (dry-run by default; `--apply` and `--report` supported).
- Startup error codes: `TRANSFORMER_NAME_KEY_BACKFILL_REQUIRED` and `TRANSFORMER_IDENTITY_DUPLICATE_KEYS`.
- The canonical CSV is longitude-first. Only the HTML-specific adapter converts the HTML's latitude-first representation.
- Audited coordinate envelope: longitude `98.631590–98.731016`, latitude `3.639622–3.735425`.

## 3. Measurement

| Source/runtime input | Storage field | Type | Nullable | Validation/transformation | Authority |
|---|---|---|---|---|---|
| transformer relation | `transformerId` | ObjectId | No | Existing canonical transformer | Runtime / HTML reconciliation |
| period | `period` | String | No | Enum `wbp`, `lwbp` | HTML / operator |
| `tegangan.r/s/t` | `voltage.r/s/t` | Number | Yes | 0–500 V when present; migrated null remains null | HTML / operator |
| `incoming.r/s/t/n` | `incoming.r/s/t/n` | Number | Yes | 0–100,000 A when present; migrated null remains null | HTML / operator |
| `jurusan` | `branches` | Array of Object | Yes | Manual API write uses `[]` when omitted; no synthetic branch | HTML / operator |
| branch name | `branches[].name` | String | Yes | Trim when present; maximum 300 characters | HTML / operator |
| branch currents | `branches[].r/s/t/n` | Number | Yes | 0–100,000 A when present | HTML / operator |
| branch protection | `branches[].fuse` | String | Yes | No default; maximum 300 characters | HTML / operator |
| branch note | `branches[].note` | String | Yes | No default; maximum 300 characters | HTML / operator |
| `updatedAt` | `measurementDate` | Date | Yes | `YYYY-MM-DD` at the API boundary; HTML null remains null | HTML / operator |
| `updatedTime` | `measurementTime` | String | Yes | `HH:mm`; HTML null remains null | HTML / operator |
| provenance kind | `source` | String | No | Enum `html_snapshot`, `operator_import`, `manual` | Runtime |
| source record key | `sourceRecordKey` | String | Yes | Maximum 300 characters; cleared by manual replacement | Runtime |

Unique constraint: `{transformerId: 1, period: 1}`. The collection holds one current period document per transformer/period. It is not a measurement-history store.

The API representation exposes string `id` and `transformerId`, not MongoDB `_id`.

## 4. Customer

| Source/runtime input | Storage field | API field | Type | Nullable | Validation/transformation | Authority |
|---|---|---|---|---|---|---|
| `id_pelanggan` / `IDPEL` | `customerId` | `customerId` | String | No | Exactly 12 ASCII digits; preserve leading zeros; unique | Customer CSV / operator |
| `nama` / `NAMA` | `name` | `name` | String | No | Trim; nonempty; not unique; maximum 300 characters | Customer CSV / operator |
| `tarif` / `TARIF` | `tariff` | `tariff` | String | Yes | Trim; no default tariff; maximum 100 characters | Customer CSV / operator |
| `daya` / `DAYA` | `powerRaw` | `power` | String | Yes | Preserve source representation; maximum 100 characters | Customer CSV / operator |
| `daya` / `DAYA` | `powerVa` | `powerVa` | Number | Yes | Nonnegative safe-integer VA; `1.300` → `1300`, `900` → `900` | Customer CSV / operator |
| `alamat` / `ALAMAT` | `address` | `address` | String | Yes | Preserve internal semicolon/punctuation; maximum 1,000 characters | Customer CSV / operator |
| operator feeder | `feeder` | `feeder` | String | Yes | Trim; no default | Operator |
| operator status | `status` | `status` | String | Yes | Trim; no default | Operator |
| provenance kind | `source` | `source` | String | Yes | Trimmed; no enum in the current model | Runtime |
| provenance file/row | `sourceFile`, `sourceRow` | Same | String, Number | Yes | File maximum 255 characters; row is one-based | Runtime |
| structured provenance | `sourceMetadata` | `sourceMetadata` | Mixed | Yes | For example `importJobId` | Runtime |

`powerRaw` is the storage name and `power` is its Mongoose alias/API representation. The API does not expose a field named `powerRaw`.

CSV and XLSX shall reconcile for all 68,742 rows after the declared encoding/type normalization. Missing or ambiguous power does not become zero.

## 5. Guest visit

The real Google Apps Script payload contract remains an external release gate. The current implementation accepts the documented compatibility aliases but does not prove compatibility with an approved production deployment.

| Source/runtime input | Storage/API field | Type | Nullable | Validation/transformation |
|---|---|---|---|---|
| upstream identifier | `sourceRecordId` | String | Yes | Trimmed when supplied; bounded by the payload contract |
| source timestamp text | `timestampRaw` | String | Yes | Preserve bounded upstream text |
| parseable source timestamp | `timestamp` | Date | Yes | Parse independently; never copy `syncedAt` |
| `Nama Tamu` / `nama` | `guestName` | String | No | Trim; nonempty; maximum 200 characters |
| `No HP` / `hp` | `phone` | String | No | Preserve text; 9–15 digits after removing non-digits |
| `ID Pelanggan` | `customerId` | String | Yes | Never fabricate; upstream-bounded reference |
| `Keperluan` | `purpose` | String | No | Trim; nonempty; maximum 1,000 characters |
| provenance kind | `source` | String | No | Enum `google_form`, `manual` |
| synchronization time | `syncedAt` | Date | Yes in model | Set by the sync service; distinct from visit time |
| canonical idempotency key | `syncFingerprint` | String | No | Version-2 SHA-256; unique |

The guest list response exposes `id`, `timestamp`, `timestampRaw`, `syncedAt`, `source`, and `sourceRecordId` as applicable.

## 6. User and session

| Storage field | Type | Nullable | Rule |
|---|---|---|---|
| `users.adminId` | String | No | Lowercase, trim, unique |
| `users.username` | String | No | Trim, unique |
| `users.passwordHash` | String | No | Bcrypt work factor 10 |
| `users.fullName` | String | Yes in API semantics | Model default empty; API emits null for empty |
| `users.email` | String | Yes | Lowercase when present; unique and sparse |
| `users.avatar` | String | Yes | Avatar URL/path, normally authenticated |
| `users.avatarMetadata` | Object | Yes | Stored upload metadata |
| `users.role` | String | No | Enum `superadmin`, `admin` |
| `users.isActive` | Boolean | No | Model default true |
| `sessions.userId` | ObjectId | No | Existing user |
| `sessions.tokenHash` | String | No | HMAC-SHA-256 of the raw opaque token, keyed by `SESSION_SECRET`; unique |
| `sessions.csrfTokenHash` | String | No | SHA-256 of the independent CSRF token |
| `sessions.expiresAt` | Date | No | Absolute expiry; TTL index |
| `sessions.revokedAt` | Date | Yes | Null while active |

Raw session and CSRF tokens are never stored. The session model stores no IP address, user-agent text, IP hash, or user-agent hash.

## 7. Import job, issue, and alias

| Storage field | Type | Nullable | Rule |
|---|---|---|---|
| `import_jobs.jobId` | String | No | UUID; unique public identifier |
| `import_jobs.previewTokenHash` | String | No | SHA-256; raw token returned once and never stored |
| `import_jobs.sourceSha256` | String | No | Binds commit to reviewed source |
| `import_jobs.actorUserId` | ObjectId | No | Owner boundary |
| `import_jobs.status` | String | No | `previewed`, `committing`, `committed`, `failed`, `expired` |
| `import_jobs.commitLeaseUntil` | Date | Yes | Renewable 15-minute lease |
| `import_jobs.expiresAt` | Date | No | 24-hour horizon; TTL index |
| `import_job_issues.jobId` | ObjectId | No | Owning job |
| `import_job_issues.rowNumber` | Number | No | One-based physical source row |
| `import_job_issues.code` | String | No | Stable validation code |
| `transformer_aliases.aliasName` | String | No | Trimmed source alias text |
| `transformer_aliases.aliasKey` | String | No | Canonical lookup key (shared Unicode full case folding); unique; maximum 600 characters |
| `transformer_aliases.transformerId` | ObjectId | No | Existing canonical transformer |
| `transformer_aliases.reason` | String | No | Operator explanation |
| `transformer_aliases.approvedBy` | ObjectId | No | Approving user |
| `transformer_aliases.approvedAt` | Date | No | Approval time |
| `transformer_aliases.source` | String | No | Provenance kind; default `static-html` |
| `transformer_aliases.sourceVersion` | String | No | Trimmed source/version label; maximum 100 characters |

The current alias API uses `aliasKey`, `approvedBy`, `approvedAt`, `source`, and `sourceVersion`; it does not use the obsolete `aliasNameKey` or `approvedByUserId` names.

## 8. Global rules

1. A source value that is absent remains `null`; an absent optional column does not fabricate a business value.
2. `createdAt`/`updatedAt` are server processing timestamps and shall not be presented as source measurement dates.
3. Business-key uniqueness is enforced by MongoDB unique indexes.
4. The API may show an empty-state label, but that shall not turn canonical data into an empty string, zero, or invented default.
5. Source, transformation, and authority detail are defined in [ADR-0003](../decisions/ADR-0003-mongodb-data-modeling.md).
