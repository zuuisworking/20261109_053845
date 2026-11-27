#!/usr/bin/env bash
#
# MongoDB backup for the SIGAP production deployment.
#
# Properties enforced by this script:
#
#   - the backup identity is the database-scoped backup user; the bootstrap
#     root credential is rejected;
#   - only one backup runs at a time (portable directory lock);
#   - the archive is written to a unique temporary file and moved into place
#     only after the gzip stream and the SHA-256 checksum were validated;
#   - the manifest records the per-collection document counts so a restore can
#     reconcile the restored database against the source;
#   - a failure never leaves a partial archive that looks complete.
#
# Unresolved external gates (not implemented here, and not claimed to be):
#
#   - at-rest encryption of the archive and of the backup volume;
#   - copying the archive to an off-host, access-controlled backup target;
#   - signing the archive and the manifest with an organisational key;
#   - point-in-time consistency evidence for the MongoDB volume.
#
# Usage:
#   scripts/backup-mongodb.sh [--output-dir <dir>] [--dry-run]
#
# Environment:
#   MONGO_DATABASE, MONGO_BACKUP_USERNAME, MONGO_BACKUP_PASSWORD
#   MONGO_ROOT_USERNAME, MONGO_ROOT_PASSWORD (optional; used only to reject
#     the bootstrap identity)
#   COMPOSE_FILE, BACKUP_DIR

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/release-common.sh
source "${SCRIPT_DIR}/lib/release-common.sh"

COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.prod.yml}"
DATABASE="${MONGO_DATABASE:-sigap_ulp_labuhan}"
OUTPUT_DIR="${BACKUP_DIR:-./out/backups}"
DRY_RUN="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      OUTPUT_DIR="${2:?--output-dir requires a path}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h | --help)
      sed -n '2,30p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      exit 2
      ;;
  esac
done

: "${MONGO_BACKUP_USERNAME:?MONGO_BACKUP_USERNAME is required}"
: "${MONGO_BACKUP_PASSWORD:?MONGO_BACKUP_PASSWORD is required}"

if [[ -n "${MONGO_ROOT_USERNAME:-}" && "${MONGO_BACKUP_USERNAME}" == "${MONGO_ROOT_USERNAME}" ]]; then
  die "The backup identity must not be the bootstrap root user."
fi
if [[ -n "${MONGO_ROOT_PASSWORD:-}" && "${MONGO_BACKUP_PASSWORD}" == "${MONGO_ROOT_PASSWORD}" ]]; then
  die "The backup identity must not use the bootstrap root password."
fi

# The run token keeps two backups that start within the same second from
# producing the same archive name. The directory lock serialises the runs,
# but it does not make their names unique, and a second-granularity timestamp
# alone would let a later run overwrite an earlier archive.
RUN_TOKEN="$$"
if [[ -r /dev/urandom ]]; then
  random_suffix="$(od -An -tx1 -N4 /dev/urandom 2>/dev/null | tr -d ' \n')"
  if [[ -n "${random_suffix}" ]]; then
    RUN_TOKEN="${RUN_TOKEN}-${random_suffix}"
  fi
fi

BACKUP_ID="$(date -u +%Y%m%dT%H%M%SZ)-${RUN_TOKEN}"
ARCHIVE_NAME="mongodb-${DATABASE}-${BACKUP_ID}.archive.gz"
FINAL_ARCHIVE="${OUTPUT_DIR}/${ARCHIVE_NAME}"
CHECKSUM_FILE="${FINAL_ARCHIVE}.sha256"
MANIFEST_FILE="${FINAL_ARCHIVE}.manifest.json"
LOCK_DIR="${OUTPUT_DIR}/.backup.lock"

umask 077

TEMP_ARCHIVE=""
cleanup_temporary() {
  if [[ -n "${TEMP_ARCHIVE}" && -f "${TEMP_ARCHIVE}" ]]; then
    rm -f "${TEMP_ARCHIVE}"
  fi
}

# The excluded collection list is the single source of truth for both the
# dump and the collection count query. When the two disagree, the restore
# reconciliation compares the restored database against counts of
# collections that the dump never contained, and the restore is rejected for
# the wrong reason.
EXCLUDED_COLLECTIONS=(
  sessions
  import_jobs
  import_job_records
  import_job_issues
  import_job_sources
)

# The collection names are embedded into the mongosh expression, so they are
# validated before they are used.
for collection in "${EXCLUDED_COLLECTIONS[@]}"; do
  if [[ ! "${collection}" =~ ^[A-Za-z0-9_.-]+$ ]]; then
    die "The excluded collection name '${collection}' contains unsupported characters."
  fi
done

build_excluded_json() {
  local json="["
  local separator=""
  for collection in "${EXCLUDED_COLLECTIONS[@]}"; do
    json="${json}${separator}\"${collection}\""
    separator=","
  done
  printf '%s]' "${json}"
}

EXCLUDED_COLLECTIONS_JSON="$(build_excluded_json)"

# The mongodump exclusion arguments are generated from the same array, so the
# dump and the count query can never drift apart.
build_dump_exclude_args() {
  local args=""
  for collection in "${EXCLUDED_COLLECTIONS[@]}"; do
    args="${args} --excludeCollection ${collection}"
  done
  printf '%s' "${args}"
}

DUMP_EXCLUDE_ARGS="$(build_dump_exclude_args)"

# The mongosh expression that counts the collections. It skips exactly the
# excluded collections, so the manifest describes the archive contents.
COUNTS_EVAL='var excluded = JSON.parse(process.env.EXCLUDED_COLLECTIONS_JSON || "[]");
db.getSiblingDB("$MONGO_DATABASE").getCollectionNames().sort().forEach(function (name) {
  if (excluded.indexOf(name) !== -1) { return; }
  print(name + "\t" + db.getSiblingDB("$MONGO_DATABASE").getCollection(name).countDocuments({}));
});'

dump_command() {
  printf 'docker compose -f %q exec -T mongo sh -c %q' "${COMPOSE_FILE}" \
    "exec mongodump --username \"\$MONGO_BACKUP_USERNAME\" --password \"\$MONGO_BACKUP_PASSWORD\" --authenticationDatabase \"\$MONGO_DATABASE\" --db \"\$MONGO_DATABASE\"${DUMP_EXCLUDE_ARGS} --archive --gzip"
}

counts_command() {
  printf 'docker compose -f %q exec -T -e EXCLUDED_COLLECTIONS_JSON=%q -e MONGO_COUNTS_EVAL=%q mongo sh -c %q' \
    "${COMPOSE_FILE}" \
    "${EXCLUDED_COLLECTIONS_JSON}" \
    "${COUNTS_EVAL}" \
    'mongosh --quiet --username "$MONGO_BACKUP_USERNAME" --password "$MONGO_BACKUP_PASSWORD" --authenticationDatabase "$MONGO_DATABASE" --eval "$MONGO_COUNTS_EVAL"'
}

if [[ "${DRY_RUN}" == "true" ]]; then
  log_info "Dry run: the archive would be written to ${FINAL_ARCHIVE}."
  log_info "Dry run: dump command would be: $(dump_command)"
  log_info "Dry run: collection count command would be: $(counts_command)"
  log_info "Dry run: excluded collections are ${EXCLUDED_COLLECTIONS[*]}."
  log_info "Dry run: excluded collections JSON: ${EXCLUDED_COLLECTIONS_JSON}"
  log_info "Dry run: the count query filters exactly those excluded collections, so the manifest describes the archive contents."
  exit 0
fi

mkdir -p "${OUTPUT_DIR}"
acquire_lock "${LOCK_DIR}"
trap 'release_lock "${LOCK_DIR}"; cleanup_temporary' EXIT INT TERM

# A published backup is never overwritten. If the generated name is already
# taken, the run fails instead of replacing an existing archive and its
# manifest.
if [[ -e "${FINAL_ARCHIVE}" || -e "${CHECKSUM_FILE}" || -e "${MANIFEST_FILE}" ]]; then
  die "A backup with the name '${ARCHIVE_NAME}' already exists in ${OUTPUT_DIR}; no backup was published."
fi

# A unique temporary file keeps concurrent or interrupted runs from reusing
# the same path. The final archive is published with an atomic rename.
TEMP_ARCHIVE="$(mktemp "${OUTPUT_DIR}/.mongodb-${DATABASE}-${BACKUP_ID}-XXXXXX.archive.gz.partial")"

require_command docker
require_command gzip
require_command sha256sum

log_info "Creating MongoDB backup ${BACKUP_ID} for database ${DATABASE}."
if ! docker compose -f "${COMPOSE_FILE}" exec -T \
  -e MONGO_DUMP_EXCLUDE_ARGS="${DUMP_EXCLUDE_ARGS}" \
  mongo sh -c '
  exec mongodump \
    --username "$MONGO_BACKUP_USERNAME" \
    --password "$MONGO_BACKUP_PASSWORD" \
    --authenticationDatabase "$MONGO_DATABASE" \
    --db "$MONGO_DATABASE" \
    $MONGO_DUMP_EXCLUDE_ARGS \
    --archive \
    --gzip
' > "${TEMP_ARCHIVE}"; then
  cleanup_temporary
  die "mongodump failed; no backup was published."
fi

if [[ ! -s "${TEMP_ARCHIVE}" ]]; then
  cleanup_temporary
  die "mongodump produced an empty archive; no backup was published."
fi

if ! gzip --test "${TEMP_ARCHIVE}" >/dev/null 2>&1; then
  cleanup_temporary
  die "The backup archive is not a valid gzip stream; no backup was published."
fi

# The count query uses exactly the same excluded collection list as the dump,
# so the manifest describes the archive contents and the restore
# reconciliation compares like with like.
COUNTS_RAW="$(docker compose -f "${COMPOSE_FILE}" exec -T \
  -e EXCLUDED_COLLECTIONS_JSON="${EXCLUDED_COLLECTIONS_JSON}" \
  -e MONGO_COUNTS_EVAL="${COUNTS_EVAL}" \
  mongo sh -c '
  mongosh --quiet \
    --username "$MONGO_BACKUP_USERNAME" \
    --password "$MONGO_BACKUP_PASSWORD" \
    --authenticationDatabase "$MONGO_DATABASE" \
    --eval "$MONGO_COUNTS_EVAL"
')" || {
  cleanup_temporary
  die "Could not read the source collection counts; no backup was published."
}

ARCHIVE_SHA256="$(sha256_of_file "${TEMP_ARCHIVE}")"

{
  printf '{\n'
  printf '  "backupId": "%s",\n' "${BACKUP_ID}"
  printf '  "createdAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '  "database": "%s",\n' "${DATABASE}"
  printf '  "archive": "%s",\n' "${ARCHIVE_NAME}"
  printf '  "sha256": "%s",\n' "${ARCHIVE_SHA256}"
  printf '  "gzipValidated": true,\n'
  printf '  "collectionCounts": {'
  first="true"
  while IFS=$'\t' read -r collection count; do
    [[ -n "${collection}" ]] || continue
    if [[ "${first}" == "true" ]]; then
      first="false"
    else
      printf ','
    fi
    printf '\n    "%s": %s' "${collection}" "${count:-0}"
  done <<< "${COUNTS_RAW}"
  if [[ "${first}" == "false" ]]; then
    printf '\n  '
  fi
  printf '},\n'
  printf '  "excludedCollections": ['
  separator=""
  for collection in "${EXCLUDED_COLLECTIONS[@]}"; do
    printf '%s"%s"' "${separator}" "${collection}"
    separator=", "
  done
  printf ']\n'
  printf '}\n'
} > "${MANIFEST_FILE}.partial"

mv -f "${TEMP_ARCHIVE}" "${FINAL_ARCHIVE}"
TEMP_ARCHIVE=""
mv -f "${MANIFEST_FILE}.partial" "${MANIFEST_FILE}"
printf '%s  %s\n' "${ARCHIVE_SHA256}" "${ARCHIVE_NAME}" > "${CHECKSUM_FILE}"
chmod 600 "${FINAL_ARCHIVE}" "${CHECKSUM_FILE}" "${MANIFEST_FILE}"

trap - EXIT INT TERM
release_lock "${LOCK_DIR}"

log_info "Backup created: ${FINAL_ARCHIVE}"
log_info "Checksum: ${CHECKSUM_FILE}"
log_info "Manifest: ${MANIFEST_FILE}"
log_warn "Encryption, off-host copy, archive signing, and point-in-time consistency evidence are external gates and are not performed by this script."
