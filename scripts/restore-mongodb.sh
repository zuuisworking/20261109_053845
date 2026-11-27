#!/usr/bin/env bash
#
# MongoDB restore for the SIGAP production deployment.
#
# The default target of this script is the isolated restore database. A
# production restore is never the default and is only possible when the
# operator passes --allow-production-restore, sets ALLOW_PRODUCTION_RESTORE=true
# in the environment, and confirms the operation interactively.
#
# The script:
#
#   - refuses a target outside the approved set (isolated restore database,
#     operator-provisioned isolated database, or the break-glass production
#     database);
#   - verifies the archive checksum and the gzip stream before restoring;
#   - restores from a unique temporary copy so a concurrent overwrite of the
#     source archive cannot corrupt the restore;
#   - reconciles the restored collection counts against the counts recorded in
#     the backup manifest and fails closed on any mismatch;
#   - removes a failed isolated restore so a partial database cannot be
#     mistaken for a usable one;
#   - supports an explicitly isolated restore rehearsal that cleans up after
#     itself.
#
# Unresolved external gates (not implemented here, and not claimed to be):
#
#   - encrypted backup storage and encrypted transport to the restore host;
#   - an off-host backup target that is independent of the production host;
#   - archive and manifest signing with an organisational key;
#   - point-in-time consistency evidence between the MongoDB volume snapshot
#     and the logical dump.
#
# Usage:
#   scripts/restore-mongodb.sh <backup.archive.gz> [--target <database>]
#       [--drop] [--rehearsal] [--keep-rehearsal]
#       [--allow-production-restore] [--dry-run]
#
# Environment:
#   MONGO_DATABASE, MONGO_RESTORE_DATABASE, MONGO_RESTORE_USERNAME,
#   MONGO_RESTORE_PASSWORD, MONGO_RESTORE_AUTH_DATABASE, COMPOSE_FILE

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/release-common.sh
source "${SCRIPT_DIR}/lib/release-common.sh"

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.prod.yml}"
SOURCE_DATABASE="${MONGO_DATABASE:-sigap_ulp_labuhan}"
RESTORE_DATABASE="${MONGO_RESTORE_DATABASE:-${SOURCE_DATABASE}_restore}"
AUTH_DATABASE="${MONGO_RESTORE_AUTH_DATABASE:-${RESTORE_DATABASE}}"
LOCK_DIR="${RESTORE_LOCK_DIR:-${TMPDIR:-/tmp}/sigap-restore.lock}"

ARCHIVE=""
TARGET_DATABASE="${RESTORE_DATABASE}"
DROP_EXISTING="false"
REHEARSAL="false"
KEEP_REHEARSAL="false"
ALLOW_PRODUCTION_RESTORE_FLAG="false"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      TARGET_DATABASE="${2:?--target requires a database name}"
      shift 2
      ;;
    --drop)
      DROP_EXISTING="true"
      shift
      ;;
    --rehearsal)
      REHEARSAL="true"
      shift
      ;;
    --keep-rehearsal)
      KEEP_REHEARSAL="true"
      REHEARSAL="true"
      shift
      ;;
    --allow-production-restore)
      ALLOW_PRODUCTION_RESTORE_FLAG="true"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h | --help)
      sed -n '2,40p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    -*)
      log_error "Unknown option: $1"
      exit 2
      ;;
    *)
      if [[ -n "${ARCHIVE}" ]]; then
        log_error "Only one archive may be restored at a time."
        exit 2
      fi
      ARCHIVE="$1"
      shift
      ;;
  esac
done

if [[ -z "${ARCHIVE}" || ! -f "${ARCHIVE}" ]]; then
  log_error "Usage: $0 <backup.archive.gz> [--target <database>] [--drop] [--rehearsal] [--keep-rehearsal] [--allow-production-restore] [--dry-run]"
  exit 2
fi

: "${MONGO_RESTORE_USERNAME:?MONGO_RESTORE_USERNAME is required}"
: "${MONGO_RESTORE_PASSWORD:?MONGO_RESTORE_PASSWORD is required}"

CHECKSUM_FILE="${ARCHIVE}.sha256"
MANIFEST_FILE="${ARCHIVE}.manifest.json"
if [[ ! -f "${CHECKSUM_FILE}" || ! -f "${MANIFEST_FILE}" ]]; then
  die "Backup integrity metadata is missing; restore refused."
fi

if [[ "${RESTORE_DATABASE}" == "${SOURCE_DATABASE}" ]]; then
  die "MONGO_RESTORE_DATABASE must differ from MONGO_DATABASE ('${SOURCE_DATABASE}')."
fi

# ---------------------------------------------------------------------------
# Target guards
# ---------------------------------------------------------------------------

PRODUCTION_RESTORE="false"
if [[ "${TARGET_DATABASE}" == "${SOURCE_DATABASE}" ]]; then
  PRODUCTION_RESTORE="true"
elif [[ "${TARGET_DATABASE}" != "${RESTORE_DATABASE}" ]]; then
  # Outside-target guard: the restore identity is only provisioned for the
  # isolated restore database and for the break-glass production database.
  die "Restore target '${TARGET_DATABASE}' is outside the approved targets ('${RESTORE_DATABASE}', '${SOURCE_DATABASE}'). Provision an isolated restore identity before restoring into another database."
fi

if [[ "${REHEARSAL}" == "true" && "${TARGET_DATABASE}" == "${SOURCE_DATABASE}" ]]; then
  die "A restore rehearsal must never target the production database."
fi

if [[ "${PRODUCTION_RESTORE}" == "true" ]]; then
  if [[ "${ALLOW_PRODUCTION_RESTORE_FLAG}" != "true" || "${ALLOW_PRODUCTION_RESTORE:-false}" != "true" ]]; then
    die "Production restore refused. It requires --allow-production-restore and ALLOW_PRODUCTION_RESTORE=true from the break-glass runbook."
  fi
fi

if [[ "${REHEARSAL}" == "true" && "${DROP_EXISTING}" != "true" ]]; then
  # The rehearsal target must start empty so the rehearsal cannot mix with
  # previously restored data.
  DROP_EXISTING="true"
fi

# ---------------------------------------------------------------------------
# Integrity verification
# ---------------------------------------------------------------------------

require_command sha256sum
require_command gzip

EXPECTED_HASH="$(awk 'NR==1 {print $1}' "${CHECKSUM_FILE}")"
ACTUAL_HASH="$(sha256_of_file "${ARCHIVE}")"
if [[ -z "${EXPECTED_HASH}" || ! "${EXPECTED_HASH}" =~ ^[0-9a-f]{64}$ ]]; then
  die "The checksum file does not contain a valid sha256 digest; restore refused."
fi
if [[ "${EXPECTED_HASH}" != "${ACTUAL_HASH}" ]]; then
  die "Archive checksum verification failed; restore refused."
fi
if ! gzip --test "${ARCHIVE}" >/dev/null 2>&1; then
  die "The archive is not a valid gzip stream; restore refused."
fi

MANIFEST_DATABASE="$(sed -n 's/.*"database"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${MANIFEST_FILE}" | head -n 1)"
MANIFEST_HASH="$(sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "${MANIFEST_FILE}" | head -n 1)"
if [[ "${MANIFEST_DATABASE}" != "${SOURCE_DATABASE}" ]]; then
  die "Manifest database '${MANIFEST_DATABASE}' does not match the configured source database '${SOURCE_DATABASE}'."
fi
if [[ "${MANIFEST_HASH}" != "${EXPECTED_HASH}" ]]; then
  die "Manifest hash does not match the checksum file."
fi

manifest_counts() {
  awk '
    /"collectionCounts"[[:space:]]*:[[:space:]]*\{/ { inside = 1; next }
    inside && /^[[:space:]]*\}[[:space:]]*,?[[:space:]]*$/ { inside = 0; next }
    inside {
      if (match($0, /"[^"]+"[[:space:]]*:[[:space:]]*[0-9]+/)) {
        text = substr($0, RSTART, RLENGTH)
        gsub(/[":[:space:]]/, " ", text)
        print text
      }
    }
  ' "${MANIFEST_FILE}"
}

EXPECTED_COUNTS="$(manifest_counts)"

# Returns 0 when the collection name is recorded in the backup manifest.
# The manifest counts are emitted as "<collection> <count>" separated by
# whitespace, so the field separator here is the default one.
is_expected_collection() {
  local candidate="$1"
  local collection
  while read -r collection _; do
    [[ -n "${collection}" ]] || continue
    if [[ "${collection}" == "${candidate}" ]]; then
      return 0
    fi
  done <<< "${EXPECTED_COUNTS}"
  return 1
}

# ---------------------------------------------------------------------------
# Confirmation
# ---------------------------------------------------------------------------

if [[ "${DROP_EXISTING}" == "true" ]]; then
  if [[ "${PRODUCTION_RESTORE}" == "true" ]]; then
    printf 'WARNING: the production database %s will be replaced.\n' "${TARGET_DATABASE}" >&2
    if [[ "${DRY_RUN}" == "true" ]]; then
      log_info "Dry run: an interactive 'RESTORE-PRODUCTION' confirmation would be required."
    else
      read -r -p 'Type RESTORE-PRODUCTION to continue: ' confirmation
      [[ "${confirmation}" == "RESTORE-PRODUCTION" ]] || {
        printf 'Restore cancelled.\n' >&2
        exit 1
      }
    fi
  else
    printf 'WARNING: existing MongoDB collections in %s will be replaced.\n' "${TARGET_DATABASE}" >&2
    if [[ "${DRY_RUN}" == "true" ]]; then
      log_info "Dry run: an interactive 'RESTORE' confirmation would be required."
    else
      read -r -p 'Type RESTORE to continue: ' confirmation
      [[ "${confirmation}" == "RESTORE" ]] || {
        printf 'Restore cancelled.\n' >&2
        exit 1
      }
    fi
  fi
fi

if [[ "${DRY_RUN}" == "true" ]]; then
  log_info "Dry run: archive ${ARCHIVE} would be restored into ${TARGET_DATABASE}."
  log_info "Dry run: source database ${SOURCE_DATABASE}, authentication database ${AUTH_DATABASE}."
  log_info "Dry run: drop existing collections: ${DROP_EXISTING}; rehearsal: ${REHEARSAL}; production restore: ${PRODUCTION_RESTORE}."
  log_info "Dry run: expected collection counts from the manifest:"
  if [[ -n "${EXPECTED_COUNTS}" ]]; then
    while read -r collection count; do
      log_info "Dry run:   ${collection} = ${count}"
    done <<< "${EXPECTED_COUNTS}"
  fi
  exit 0
fi

require_command docker

TEMP_ARCHIVE=""
cleanup_temporary() {
  if [[ -n "${TEMP_ARCHIVE}" && -f "${TEMP_ARCHIVE}" ]]; then
    rm -f "${TEMP_ARCHIVE}"
  fi
}

acquire_lock "${LOCK_DIR}"
trap 'release_lock "${LOCK_DIR}"; cleanup_temporary' EXIT INT TERM

# A unique temporary copy keeps the restore stable even if the source archive
# is replaced while the restore is running.
TEMP_ARCHIVE="$(mktemp "${TMPDIR:-/tmp}/sigap-restore-XXXXXX.archive.gz")"
cp "${ARCHIVE}" "${TEMP_ARCHIVE}"
if [[ "$(sha256_of_file "${TEMP_ARCHIVE}")" != "${EXPECTED_HASH}" ]]; then
  die "The temporary archive copy does not match the recorded checksum."
fi

RESTORE_SUCCEEDED="false"

cleanup_failed_restore() {
  if [[ "${RESTORE_SUCCEEDED}" == "true" ]]; then
    return
  fi
  if [[ "${PRODUCTION_RESTORE}" == "true" ]]; then
    log_error "The production restore failed. The cleanup routine does not drop the production database, but the production database may already have been modified: a --drop restore removes or replaces the existing collections before it writes the archive, so a failure can leave the production database partially restored. Treat the production database as modified and follow the break-glass runbook."
    return
  fi
  log_warn "Removing the failed isolated restore in ${TARGET_DATABASE}."
  if ! docker compose -f "${COMPOSE_FILE}" exec -T \
    -e MONGO_RESTORE_AUTH_DATABASE="${AUTH_DATABASE}" \
    -e RESTORE_TARGET_DATABASE="${TARGET_DATABASE}" \
    mongo sh -c '
    mongosh --quiet \
      --username "$MONGO_RESTORE_USERNAME" \
      --password "$MONGO_RESTORE_PASSWORD" \
      --authenticationDatabase "$MONGO_RESTORE_AUTH_DATABASE" \
      --eval "db.getSiblingDB(process.env.RESTORE_TARGET_DATABASE).dropDatabase().ok"
  ' >/dev/null 2>&1; then
    log_error "The isolated restore could not be removed automatically. Remove it with an administrative identity: mongosh --eval \"db.getSiblingDB('${TARGET_DATABASE}').dropDatabase()\""
  fi
}

restore_counts() {
  docker compose -f "${COMPOSE_FILE}" exec -T \
    -e MONGO_RESTORE_AUTH_DATABASE="${AUTH_DATABASE}" \
    -e RESTORE_TARGET_DATABASE="${TARGET_DATABASE}" \
    mongo sh -c '
    mongosh --quiet \
      --username "$MONGO_RESTORE_USERNAME" \
      --password "$MONGO_RESTORE_PASSWORD" \
      --authenticationDatabase "$MONGO_RESTORE_AUTH_DATABASE" \
      --eval "db.getSiblingDB(process.env.RESTORE_TARGET_DATABASE).getCollectionNames().sort().forEach(function (name) { print(name + \"\\t\" + db.getSiblingDB(process.env.RESTORE_TARGET_DATABASE).getCollection(name).countDocuments({})); })"
  '
}

log_info "Restoring ${ARCHIVE} into database ${TARGET_DATABASE}."
EXTRA_ARGS=()
if [[ "${DROP_EXISTING}" == "true" ]]; then
  EXTRA_ARGS=(--drop)
fi

if ! docker compose -f "${COMPOSE_FILE}" exec -T \
  -e MONGO_RESTORE_AUTH_DATABASE="${AUTH_DATABASE}" \
  -e RESTORE_TARGET_DATABASE="${TARGET_DATABASE}" \
  mongo sh -c '
  exec mongorestore \
    --username "$MONGO_RESTORE_USERNAME" \
    --password "$MONGO_RESTORE_PASSWORD" \
    --authenticationDatabase "$MONGO_RESTORE_AUTH_DATABASE" \
    --nsFrom="$MONGO_DATABASE.*" \
    --nsTo="$RESTORE_TARGET_DATABASE.*" \
    --archive \
    --gzip \
    "$@"
' sh "${EXTRA_ARGS[@]}" < "${TEMP_ARCHIVE}"; then
  cleanup_failed_restore
  die "mongorestore failed; the restore did not complete."
fi

ACTUAL_COUNTS="$(restore_counts)" || {
  cleanup_failed_restore
  die "The restored collection counts could not be read; the restore is treated as failed."
}

if [[ -z "${ACTUAL_COUNTS}" ]]; then
  cleanup_failed_restore
  die "The restored database is empty; the restore is treated as failed."
fi

# Reconciliation: every collection recorded in the manifest must exist in the
# restored database with the same document count, and the restored database
# must not contain any collection that the manifest does not record. Any
# mismatch fails closed.
MISMATCHES=0
while read -r collection count; do
  [[ -n "${collection}" ]] || continue
  restored_count="$(printf '%s\n' "${ACTUAL_COUNTS}" | awk -F'\t' -v name="${collection}" '$1 == name { print $2; exit }')"
  if [[ -z "${restored_count}" ]]; then
    log_error "Collection '${collection}' is missing from the restored database (expected ${count} documents)."
    MISMATCHES=$((MISMATCHES + 1))
    continue
  fi
  if [[ "${restored_count}" != "${count}" ]]; then
    log_error "Collection '${collection}' has ${restored_count} documents but the manifest recorded ${count}."
    MISMATCHES=$((MISMATCHES + 1))
  fi
done <<< "${EXPECTED_COUNTS}"

# A restore that does not drop the target must not leave stale collections
# behind. Any collection in the restored database that the manifest does not
# record is rejected, because it means the target contains data that the
# archive does not describe.
while IFS=$'\t' read -r collection count; do
  [[ -n "${collection}" ]] || continue
  if ! is_expected_collection "${collection}"; then
    log_error "Collection '${collection}' exists in the restored database but is not recorded in the backup manifest."
    MISMATCHES=$((MISMATCHES + 1))
  fi
done <<< "${ACTUAL_COUNTS}"

if [[ "${MISMATCHES}" -gt 0 ]]; then
  cleanup_failed_restore
  die "Collection reconciliation failed with ${MISMATCHES} mismatch(es); the restore is rejected."
fi

RESTORE_SUCCEEDED="true"

if [[ "${REHEARSAL}" == "true" && "${KEEP_REHEARSAL}" != "true" ]]; then
  log_info "Rehearsal succeeded; removing the isolated rehearsal database ${TARGET_DATABASE}."
  if ! docker compose -f "${COMPOSE_FILE}" exec -T \
    -e MONGO_RESTORE_AUTH_DATABASE="${AUTH_DATABASE}" \
    -e RESTORE_TARGET_DATABASE="${TARGET_DATABASE}" \
    mongo sh -c '
    mongosh --quiet \
      --username "$MONGO_RESTORE_USERNAME" \
      --password "$MONGO_RESTORE_PASSWORD" \
      --authenticationDatabase "$MONGO_RESTORE_AUTH_DATABASE" \
      --eval "db.getSiblingDB(process.env.RESTORE_TARGET_DATABASE).dropDatabase().ok"
  ' >/dev/null 2>&1; then
    log_warn "The rehearsal database could not be removed automatically. Remove it with an administrative identity: mongosh --eval \"db.getSiblingDB('${TARGET_DATABASE}').dropDatabase()\""
  fi
fi

cleanup_temporary
trap - EXIT INT TERM
release_lock "${LOCK_DIR}"

log_info "Restore completed from ${ARCHIVE} into ${TARGET_DATABASE}."
log_warn "Encryption, off-host copy, archive signing, and point-in-time consistency evidence are external gates and are not performed by this script."
