#!/usr/bin/env bash
#
# Builds the production release bundle.
#
# The bundle contains every runtime file the deployment host needs, plus a
# SHA256SUMS manifest that covers each file:
#
#   docker-compose.prod.yml              production compose definition
#   Caddyfile                            reverse proxy configuration
#   mongo/init/01-create-users.js        MongoDB initialisation script
#   mongo/README.md                      MongoDB operations notes
#   scripts/validate-production-release.sh  release preflight
#   scripts/validate-release-manifest.js    manifest validator
#   scripts/backup-mongodb.sh            database backup
#   scripts/restore-mongodb.sh           database restore
#   scripts/verify-host-image-set.sh     effective host image set check
#   scripts/prepare-release-env.sh       release environment and rollback reference
#   scripts/lib/release-common.sh       shared shell helpers
#   release-manifest.schema.json         manifest format definition
#   security/*.json                      approved exception registries
#
# Usage:
#   scripts/build-release-bundle.sh --output <directory> [--source-sha <sha>]
#                                   [--archive]
#
# The script never touches the database, the registry, or the deployment host.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/release-common.sh
source "${SCRIPT_DIR}/lib/release-common.sh"

REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUTPUT_DIR=""
SOURCE_SHA="${SOURCE_SHA:-}"
CREATE_ARCHIVE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT_DIR="${2:?--output requires a directory}"
      shift 2
      ;;
    --source-sha)
      SOURCE_SHA="${2:?--source-sha requires a commit SHA}"
      shift 2
      ;;
    --archive)
      CREATE_ARCHIVE="true"
      shift
      ;;
    -h | --help)
      sed -n '2,25p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      exit 2
      ;;
  esac
done

[[ -n "${OUTPUT_DIR}" ]] || die "--output <directory> is required."
if [[ -n "${SOURCE_SHA}" && ! "${SOURCE_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  die "The source SHA must be an exact 40 character lowercase commit SHA."
fi

BUNDLE_DIR="${OUTPUT_DIR%/}/bundle"
rm -rf "${BUNDLE_DIR}"
mkdir -p "${BUNDLE_DIR}/mongo/init" "${BUNDLE_DIR}/scripts/lib" "${BUNDLE_DIR}/security"

copy_file() {
  local source_relative_path="$1"
  local bundle_relative_path="$2"
  local source_path="${REPOSITORY_ROOT}/${source_relative_path}"
  [[ -f "${source_path}" ]] || die "Required release file is missing: ${source_relative_path}"
  mkdir -p "$(dirname "${BUNDLE_DIR}/${bundle_relative_path}")"
  cp "${source_path}" "${BUNDLE_DIR}/${bundle_relative_path}"
}

copy_file "deploy/docker-compose.prod.yml" "docker-compose.prod.yml"
copy_file "deploy/Caddyfile" "Caddyfile"
copy_file "deploy/mongo/init/01-create-users.js" "mongo/init/01-create-users.js"
copy_file "deploy/mongo/README.md" "mongo/README.md"
copy_file "deploy/release-manifest.schema.json" "release-manifest.schema.json"
copy_file "scripts/validate-production-release.sh" "scripts/validate-production-release.sh"
copy_file "scripts/validate-release-manifest.js" "scripts/validate-release-manifest.js"
copy_file "scripts/backup-mongodb.sh" "scripts/backup-mongodb.sh"
copy_file "scripts/restore-mongodb.sh" "scripts/restore-mongodb.sh"
copy_file "scripts/verify-host-image-set.sh" "scripts/verify-host-image-set.sh"
copy_file "scripts/prepare-release-env.sh" "scripts/prepare-release-env.sh"
copy_file "scripts/lib/release-common.sh" "scripts/lib/release-common.sh"
copy_file "security/vulnerability-exceptions.json" "security/vulnerability-exceptions.json"
copy_file "security/license-exceptions.json" "security/license-exceptions.json"
copy_file "security/contract-gate-exceptions.json" "security/contract-gate-exceptions.json"

chmod 0755 \
  "${BUNDLE_DIR}/scripts/validate-production-release.sh" \
  "${BUNDLE_DIR}/scripts/backup-mongodb.sh" \
  "${BUNDLE_DIR}/scripts/restore-mongodb.sh" \
  "${BUNDLE_DIR}/scripts/verify-host-image-set.sh" \
  "${BUNDLE_DIR}/scripts/prepare-release-env.sh"

{
  printf 'bundleCreatedAt=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'sourceSha=%s\n' "${SOURCE_SHA:-unknown}"
  printf 'repositoryRoot=%s\n' "${REPOSITORY_ROOT}"
} > "${BUNDLE_DIR}/bundle-info.txt"

(
  cd "${BUNDLE_DIR}"
  find . -type f ! -name SHA256SUMS -print | LC_ALL=C sort | while read -r file_path; do
    # Some MSYS/Cygwin coreutils builds prefix the digest with a backslash to
    # mark binary mode. The marker is removed so the file stays portable.
    sha256sum "${file_path}" | sed 's/^\\//'
  done > SHA256SUMS
)

log_info "Release bundle created in ${BUNDLE_DIR}."
log_info "Bundle checksum manifest: ${BUNDLE_DIR}/SHA256SUMS"

if [[ "${CREATE_ARCHIVE}" == "true" ]]; then
  ARCHIVE_PATH="${OUTPUT_DIR%/}/sigap-release-${SOURCE_SHA:-unversioned}.tar.gz"
  rm -f "${ARCHIVE_PATH}"
  # --force-local keeps tar from treating a Windows drive letter as a remote host.
  tar --force-local -czf "${ARCHIVE_PATH}" -C "${OUTPUT_DIR%/}" bundle
  log_info "Release bundle archive: ${ARCHIVE_PATH}"
  log_info "Release bundle archive checksum: $(sha256_of_file "${ARCHIVE_PATH}")"
fi
