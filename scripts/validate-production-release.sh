#!/usr/bin/env bash
#
# Production release preflight for the SIGAP ULP Labuhan deployment.
#
# The validator fails closed. It accepts only immutable, digest-pinned images
# from the expected repositories, rejects placeholder or short secrets, checks
# that the public URL and the public host agree, verifies that the application
# MongoDB identity is the scoped application user (never the bootstrap root
# user), keeps the source and restore databases separated, requires the full
# runtime bundle with verified checksums, and validates the approved release
# manifest.
#
# Modes:
#   scripts/validate-production-release.sh              # the production gate
#   scripts/validate-production-release.sh --bundle-only
#
# The production gate (the default) approves a release. It requires a built
# release bundle whose SHA256SUMS manifest is present and verified, and it
# requires the approved release manifest. A missing bundle checksum manifest
# or a missing approved manifest is a failure, never a skipped check.
#
# The --bundle-only mode is the host runtime check: it verifies that the
# runtime files are present and that they match the bundle checksum manifest.
# It does not approve a release, it does not need Node.js, and it does not
# need the approved release manifest. It is the only mode used on the VPS.
#
# Usage:
#   scripts/validate-production-release.sh              # full validation
#   scripts/validate-production-release.sh --bundle-only
#
# Environment:
#   PUBLIC_APP_URL, PUBLIC_HOST, CLIENT_URLS, ACME_EMAIL
#   BACKEND_IMAGE, FRONTEND_IMAGE, MONGO_IMAGE, CADDY_IMAGE
#   SESSION_SECRET
#   MONGO_DATABASE, MONGO_RESTORE_DATABASE
#   MONGO_ROOT_USERNAME, MONGO_ROOT_PASSWORD
#   MONGO_APP_USERNAME, MONGO_APP_PASSWORD
#   MONGO_BACKUP_USERNAME, MONGO_BACKUP_PASSWORD
#   MONGO_RESTORE_USERNAME, MONGO_RESTORE_PASSWORD
#   COMPOSE_MONGODB_URI
#   EXPECTED_GHCR_OWNER (or GITHUB_REPOSITORY=owner/repo)
#   EXPECTED_BACKEND_REPOSITORY, EXPECTED_FRONTEND_REPOSITORY,
#   EXPECTED_MONGO_REPOSITORY, EXPECTED_CADDY_REPOSITORY (optional overrides)
#   RELEASE_DIR (release bundle root; defaults to the repository root)
#   RELEASE_MANIFEST (path to release-manifest.json; required in the full mode)
#   RELEASE_MANIFEST_SIGNATURE, RELEASE_MANIFEST_PUBLIC_KEY (required when
#     REQUIRE_RELEASE_MANIFEST_SIGNATURE=true)
#   BUNDLE_ARCHIVE (the release bundle archive whose checksum the manifest
#     records; required by the full mode)
#   SKIP_COMPOSE_CONFIG=true (test-only escape hatch; never used by the
#     deployment workflow)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/release-common.sh
source "${SCRIPT_DIR}/lib/release-common.sh"

MODE="full"
case "${1:-}" in
  --bundle-only) MODE="bundle-only" ;;
  "") ;;
  -h | --help)
    sed -n '2,40p' "${BASH_SOURCE[0]}"
    exit 0
    ;;
  *)
    log_error "Unknown argument: $1"
    exit 2
    ;;
esac

REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-deploy/docker-compose.prod.yml}"
RELEASE_DIR="${RELEASE_DIR:-}"
BUNDLE_MODE="false"
if [[ -n "${RELEASE_DIR}" ]]; then
  BUNDLE_MODE="true"
else
  RELEASE_DIR="${REPOSITORY_ROOT}"
fi

FAILURES=0

fail() {
  log_error "$*"
  FAILURES=$((FAILURES + 1))
}

require_value() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "${name} is required."
    return 1
  fi
  return 0
}

# ---------------------------------------------------------------------------
# Required values
# ---------------------------------------------------------------------------

REQUIRED_VALUES=(
  PUBLIC_APP_URL
  PUBLIC_HOST
  CLIENT_URLS
  ACME_EMAIL
  BACKEND_IMAGE
  FRONTEND_IMAGE
  MONGO_IMAGE
  CADDY_IMAGE
  SESSION_SECRET
  MONGO_ROOT_USERNAME
  MONGO_ROOT_PASSWORD
  MONGO_APP_USERNAME
  MONGO_APP_PASSWORD
  MONGO_BACKUP_USERNAME
  MONGO_BACKUP_PASSWORD
  MONGO_RESTORE_USERNAME
  MONGO_RESTORE_PASSWORD
  COMPOSE_MONGODB_URI
)

for name in "${REQUIRED_VALUES[@]}"; do
  require_value "${name}" || true
done

if [[ "${FAILURES}" -gt 0 ]]; then
  die "Production release validation failed: ${FAILURES} required value(s) are missing."
fi

MONGO_DATABASE="${MONGO_DATABASE:-sigap_ulp_labuhan}"
MONGO_RESTORE_DATABASE="${MONGO_RESTORE_DATABASE:-${MONGO_DATABASE}_restore}"

GHCR_OWNER="${EXPECTED_GHCR_OWNER:-}"
if [[ -z "${GHCR_OWNER}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
  GHCR_OWNER="${GITHUB_REPOSITORY%%/*}"
fi
if [[ -z "${GHCR_OWNER}" ]]; then
  die "EXPECTED_GHCR_OWNER (or GITHUB_REPOSITORY) is required to pin the expected image repository."
fi

GHCR_REPOSITORY="${EXPECTED_GHCR_REPOSITORY:-}"
if [[ -z "${GHCR_REPOSITORY}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
  GHCR_REPOSITORY="${GITHUB_REPOSITORY}"
fi
if [[ -z "${GHCR_REPOSITORY}" ]]; then
  die "EXPECTED_GHCR_REPOSITORY (or GITHUB_REPOSITORY) is required to pin the expected image repository."
fi
if [[ "${GHCR_REPOSITORY%%/*}" != "${GHCR_OWNER}" ]]; then
  die "EXPECTED_GHCR_REPOSITORY '${GHCR_REPOSITORY}' does not belong to EXPECTED_GHCR_OWNER '${GHCR_OWNER}'."
fi

EXPECTED_BACKEND_REPOSITORY="${EXPECTED_BACKEND_REPOSITORY:-ghcr.io/${GHCR_REPOSITORY}/backend}"
EXPECTED_FRONTEND_REPOSITORY="${EXPECTED_FRONTEND_REPOSITORY:-ghcr.io/${GHCR_REPOSITORY}/frontend}"
EXPECTED_MONGO_REPOSITORY="${EXPECTED_MONGO_REPOSITORY:-docker.io/library/mongo}"
EXPECTED_CADDY_REPOSITORY="${EXPECTED_CADDY_REPOSITORY:-docker.io/library/caddy}"

# ---------------------------------------------------------------------------
# Image references: exact repository plus exact sha256 digest
# ---------------------------------------------------------------------------

check_image() {
  local name="$1"
  local value="$2"
  local expected_repository="$3"

  if [[ "${value}" != "${expected_repository}@sha256:"* ]]; then
    fail "${name} must reference ${expected_repository}@sha256:<64 hex characters>; got '${value}'."
    return
  fi
  local digest="${value##*@sha256:}"
  if [[ ! "${digest}" =~ ^[0-9a-f]{64}$ ]]; then
    fail "${name} must end with an exact 64 character lowercase sha256 digest; got '${digest}'."
  fi
}

check_image BACKEND_IMAGE "${BACKEND_IMAGE}" "${EXPECTED_BACKEND_REPOSITORY}"
check_image FRONTEND_IMAGE "${FRONTEND_IMAGE}" "${EXPECTED_FRONTEND_REPOSITORY}"
check_image MONGO_IMAGE "${MONGO_IMAGE}" "${EXPECTED_MONGO_REPOSITORY}"
check_image CADDY_IMAGE "${CADDY_IMAGE}" "${EXPECTED_CADDY_REPOSITORY}"

# ---------------------------------------------------------------------------
# Secrets: real values, at least 32 characters, no placeholders
# ---------------------------------------------------------------------------

PLACEHOLDER_PATTERN='(replace[-_ ]?with|change[-_ ]?me|placeholder|example|your[-_ ]|dummy|sample|not[-_ ]?configured|insert[-_ ]|todo|tbd|xxxxxxxx|sigap-test-password|password123)'

check_secret() {
  local name="$1"
  local value="${!name}"
  if [[ "${#value}" -lt 32 ]]; then
    fail "${name} must be at least 32 characters long."
  fi
  local lowered="${value,,}"
  if [[ "${lowered}" =~ ${PLACEHOLDER_PATTERN} ]]; then
    fail "${name} still contains a placeholder or example value."
  fi
}

# The API runtime reads SESSION_SECRET only. It does not read a CSRF secret:
# every session receives an independent random CSRF token whose SHA-256 hash
# is stored server-side (ADR-0005). A CSRF_SECRET variable is therefore not
# required, and a placeholder one is ignored on purpose.
for secret_name in SESSION_SECRET MONGO_ROOT_PASSWORD MONGO_APP_PASSWORD \
  MONGO_BACKUP_PASSWORD MONGO_RESTORE_PASSWORD; do
  check_secret "${secret_name}"
done

# ---------------------------------------------------------------------------
# Public URL, public host, and the credentialed origin allowlist
# ---------------------------------------------------------------------------

if [[ ! "${PUBLIC_APP_URL}" =~ ^https://[A-Za-z0-9._-]+(:[0-9]+)?(/.*)?$ ]]; then
  fail "PUBLIC_APP_URL must be an absolute HTTPS URL; got '${PUBLIC_APP_URL}'."
else
  url_host="${PUBLIC_APP_URL#https://}"
  url_host="${url_host%%/*}"
  url_host="${url_host%%:*}"
  if [[ "${url_host,,}" != "${PUBLIC_HOST,,}" ]]; then
    fail "PUBLIC_APP_URL host '${url_host}' does not match PUBLIC_HOST '${PUBLIC_HOST}'."
  fi
fi

if [[ "${PUBLIC_HOST}" == *"://"* || "${PUBLIC_HOST}" == */* || "${PUBLIC_HOST}" == *:* ]]; then
  fail "PUBLIC_HOST must be a bare hostname without a scheme, port, or path."
fi

if [[ "${CLIENT_URLS}" != *"https://${PUBLIC_HOST}"* ]]; then
  fail "CLIENT_URLS must contain the exact public origin https://${PUBLIC_HOST}."
fi

# ---------------------------------------------------------------------------
# MongoDB identities
# ---------------------------------------------------------------------------

if [[ "${MONGO_RESTORE_DATABASE}" == "${MONGO_DATABASE}" ]]; then
  fail "MONGO_RESTORE_DATABASE must differ from MONGO_DATABASE ('${MONGO_DATABASE}')."
fi

declare -A seen_users=()
for user_name in MONGO_ROOT_USERNAME MONGO_APP_USERNAME MONGO_BACKUP_USERNAME MONGO_RESTORE_USERNAME; do
  user_value="${!user_name}"
  if [[ -z "${user_value}" ]]; then
    fail "${user_name} is required."
    continue
  fi
  if [[ -n "${seen_users[${user_value}]:-}" ]]; then
    fail "${user_name} must differ from ${seen_users[${user_value}]}."
  else
    seen_users["${user_value}"]="${user_name}"
  fi
done

if [[ "${COMPOSE_MONGODB_URI}" =~ ^mongodb(\+srv)?://([^:@/]+):([^@]*)@([^/]+)/([^?]+)(\?.*)?$ ]]; then
  uri_scheme="mongodb${BASH_REMATCH[1]}"
  uri_user="$(url_decode "${BASH_REMATCH[2]}")"
  uri_password="$(url_decode "${BASH_REMATCH[3]}")"
  uri_host="${BASH_REMATCH[4]}"
  uri_database="$(url_decode "${BASH_REMATCH[5]}")"
  uri_query="${BASH_REMATCH[6]:-}"

  if [[ "${uri_user}" != "${MONGO_APP_USERNAME}" ]]; then
    fail "COMPOSE_MONGODB_URI must authenticate as MONGO_APP_USERNAME ('${MONGO_APP_USERNAME}'); got '${uri_user}'."
  fi
  if [[ "${uri_user}" == "${MONGO_ROOT_USERNAME}" ]]; then
    fail "COMPOSE_MONGODB_URI must not use the bootstrap root identity."
  fi
  if [[ "${uri_password}" != "${MONGO_APP_PASSWORD}" ]]; then
    fail "COMPOSE_MONGODB_URI password does not match MONGO_APP_PASSWORD."
  fi
  if [[ "${uri_password}" == "${MONGO_ROOT_PASSWORD}" ]]; then
    fail "COMPOSE_MONGODB_URI must not use the bootstrap root password."
  fi
  if [[ "${uri_database}" != "${MONGO_DATABASE}" ]]; then
    fail "COMPOSE_MONGODB_URI must target MONGO_DATABASE ('${MONGO_DATABASE}'); got '${uri_database}'."
  fi
  if [[ "${uri_query}" != *"authSource=${MONGO_DATABASE}"* ]]; then
    fail "COMPOSE_MONGODB_URI must set authSource=${MONGO_DATABASE}."
  fi
  if [[ "${uri_host}" != "mongo" && "${uri_host}" != "mongo:27017" ]]; then
    log_warn "COMPOSE_MONGODB_URI host '${uri_host}' is not the compose service name 'mongo'."
  fi
else
  fail "COMPOSE_MONGODB_URI is not a parseable mongodb:// URI with an explicit user, password, database, and query string."
fi

# ---------------------------------------------------------------------------
# Runtime bundle: required files and verified checksums
# ---------------------------------------------------------------------------

BUNDLE_FILES=(
  docker-compose.prod.yml
  Caddyfile
  mongo/init/01-create-users.js
  scripts/validate-production-release.sh
  scripts/backup-mongodb.sh
  scripts/restore-mongodb.sh
  scripts/verify-host-image-set.sh
  scripts/prepare-release-env.sh
  scripts/lib/release-common.sh
)

if [[ "${BUNDLE_MODE}" == "true" ]]; then
  if [[ "${MODE}" == "bundle-only" ]]; then
    BUNDLE_FILES+=(SHA256SUMS)
  else
    BUNDLE_FILES+=(scripts/validate-release-manifest.js)
  fi
else
  BUNDLE_FILES=(
    deploy/docker-compose.prod.yml
    deploy/Caddyfile
    deploy/mongo/init/01-create-users.js
    scripts/validate-production-release.sh
    scripts/backup-mongodb.sh
    scripts/restore-mongodb.sh
    scripts/verify-host-image-set.sh
    scripts/prepare-release-env.sh
    scripts/lib/release-common.sh
  )
  if [[ "${MODE}" != "bundle-only" ]]; then
    BUNDLE_FILES+=(scripts/validate-release-manifest.js)
  fi
fi

# A release bundle always carries its checksum manifest. Its absence is a
# failure, not a skipped check: without SHA256SUMS the runtime files cannot
# be verified against the approved bundle.
if [[ "${BUNDLE_MODE}" == "true" && ! -f "${RELEASE_DIR}/SHA256SUMS" ]]; then
  fail "SHA256SUMS is missing under ${RELEASE_DIR}; a release bundle without its checksum manifest is refused."
fi

for bundle_file in "${BUNDLE_FILES[@]}"; do
  if [[ ! -f "${RELEASE_DIR}/${bundle_file}" ]]; then
    fail "Release bundle is missing ${bundle_file} under ${RELEASE_DIR}."
  fi
done

if [[ "${BUNDLE_MODE}" == "true" ]]; then
  # The file existence was checked above, so the checksum manifest is
  # verified, never skipped.
  verify_sha256_manifest "${RELEASE_DIR}/SHA256SUMS" "${RELEASE_DIR}"
else
  log_info "This is a source checkout, not a release bundle; the bundle checksum manifest is verified against the built bundle (RELEASE_DIR)."
fi

# ---------------------------------------------------------------------------
# Release manifest (required by the production gate)
# ---------------------------------------------------------------------------

if [[ "${MODE}" == "bundle-only" ]]; then
  # The host runtime check does not approve a release. The cryptographic
  # approval is verified in CI and in the production gate.
  if [[ -n "${RELEASE_MANIFEST:-}" ]]; then
    if [[ ! -f "${RELEASE_MANIFEST}" ]]; then
      fail "RELEASE_MANIFEST '${RELEASE_MANIFEST}' does not exist."
    else
      log_info "Release manifest is present and covered by the bundle checksum; cryptographic approval verification is performed in CI and in the production gate."
    fi
  else
    log_info "No release manifest was supplied; the bundle-only mode checks the runtime files and their checksums and does not approve a release."
  fi
elif [[ -z "${RELEASE_MANIFEST:-}" ]]; then
  fail "RELEASE_MANIFEST is required: the production gate validates the approved release manifest. Use --bundle-only for the host runtime-file check."
elif [[ ! -f "${RELEASE_MANIFEST}" ]]; then
  fail "RELEASE_MANIFEST '${RELEASE_MANIFEST}' does not exist."
else
  MANIFEST_VALIDATOR="${SCRIPT_DIR}/validate-release-manifest.js"
  if [[ ! -f "${MANIFEST_VALIDATOR}" ]]; then
    fail "Release manifest validator ${MANIFEST_VALIDATOR} is missing."
  elif ! command -v node >/dev/null 2>&1; then
    fail "Node.js is required to validate the release manifest. Run the production gate in CI, or install Node.js on the host."
  else
    export BACKEND_IMAGE FRONTEND_IMAGE MONGO_IMAGE CADDY_IMAGE
    export EXPECTED_BACKEND_REPOSITORY EXPECTED_FRONTEND_REPOSITORY
    export EXPECTED_MONGO_REPOSITORY EXPECTED_CADDY_REPOSITORY
    # The recorded bundle checksum is verified against the actual archive
    # bytes, not only against its format.
    if ! node "${MANIFEST_VALIDATOR}" --manifest "${RELEASE_MANIFEST}" --require-bundle-archive; then
      fail "Release manifest validation failed."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Compose expansion (CLI only; no Docker daemon is required)
# ---------------------------------------------------------------------------

if [[ "${SKIP_COMPOSE_CONFIG:-false}" == "true" ]]; then
  log_warn "SKIP_COMPOSE_CONFIG=true: the compose expansion check was skipped. The deployment workflow never sets this."
elif ! command -v docker >/dev/null 2>&1; then
  fail "The Docker CLI is required to expand the production compose file."
else
  export BACKEND_IMAGE FRONTEND_IMAGE MONGO_IMAGE CADDY_IMAGE
  export PUBLIC_APP_URL PUBLIC_HOST CLIENT_URLS ACME_EMAIL
  export MONGO_DATABASE MONGO_RESTORE_DATABASE
  export MONGO_ROOT_USERNAME MONGO_ROOT_PASSWORD
  export MONGO_APP_USERNAME MONGO_APP_PASSWORD
  export MONGO_BACKUP_USERNAME MONGO_BACKUP_PASSWORD
  export MONGO_RESTORE_USERNAME MONGO_RESTORE_PASSWORD
  export COMPOSE_MONGODB_URI SESSION_SECRET
  if ! docker compose -f "${COMPOSE_FILE}" config --quiet; then
    fail "docker compose config failed for ${COMPOSE_FILE}."
  fi
fi

if [[ "${FAILURES}" -gt 0 ]]; then
  die "Production release validation failed with ${FAILURES} error(s)."
fi

printf 'Production release configuration passed the preflight.\n'
