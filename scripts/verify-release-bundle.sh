#!/usr/bin/env bash
#
# Verifies a production release bundle.
#
# The verification covers the file inventory and the SHA256SUMS manifest. It
# runs on the deployment host before a rollout and fails closed when a file is
# missing, unexpected, or modified.
#
# Usage:
#   scripts/verify-release-bundle.sh --bundle <directory>
#
# Exit codes:
#   0  the bundle is complete and every checksum matches
#   1  the bundle is incomplete or a checksum does not match

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/release-common.sh
source "${SCRIPT_DIR}/lib/release-common.sh"

BUNDLE_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --bundle)
      BUNDLE_DIR="${2:?--bundle requires a directory}"
      shift 2
      ;;
    -h | --help)
      sed -n '2,12p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      exit 2
      ;;
  esac
done

[[ -n "${BUNDLE_DIR}" ]] || die "--bundle <directory> is required."
[[ -d "${BUNDLE_DIR}" ]] || die "The release bundle directory '${BUNDLE_DIR}' does not exist."

REQUIRED_FILES=(
  bundle-info.txt
  docker-compose.prod.yml
  Caddyfile
  mongo/init/01-create-users.js
  mongo/README.md
  release-manifest.schema.json
  scripts/validate-production-release.sh
  scripts/validate-release-manifest.js
  scripts/backup-mongodb.sh
  scripts/restore-mongodb.sh
  scripts/verify-host-image-set.sh
  scripts/prepare-release-env.sh
  scripts/lib/release-common.sh
  security/vulnerability-exceptions.json
  security/license-exceptions.json
  security/contract-gate-exceptions.json
)

for relative_path in "${REQUIRED_FILES[@]}"; do
  [[ -f "${BUNDLE_DIR}/${relative_path}" ]] || die "The release bundle is missing ${relative_path}."
done

verify_sha256_manifest "${BUNDLE_DIR}/SHA256SUMS" "${BUNDLE_DIR}"

log_info "Release bundle verified: ${BUNDLE_DIR}"
