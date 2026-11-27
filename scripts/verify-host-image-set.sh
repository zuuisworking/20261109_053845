#!/usr/bin/env bash
#
# Verifies that the effective image set of the production Compose project on
# the deployment host is exactly the approved set of image digests.
#
# The release validator checks the images on the runner. The host, however,
# resolves the images again from its own environment files. A stale
# MONGO_IMAGE or CADDY_IMAGE in the host `.env` would therefore deploy a
# different image than the one that was validated and recorded in the
# approved release manifest.
#
# This script asks Compose what the effective image set actually is and
# compares it with the approved digests. It fails closed on any difference.
#
# Usage:
#   scripts/verify-host-image-set.sh \
#     --compose-file <file> --env-file <file> [--env-file <file>]... \
#     --expected <image> [--expected <image>]...
#
# The --expected values are the exact digest references that the approved
# release manifest records. They are compared as a set, so the order does not
# matter.
#
# The effective image set is resolved from the declared environment files
# only. Docker Compose gives the process environment a higher precedence than
# an --env-file value, so an ambient BACKEND_IMAGE, FRONTEND_IMAGE,
# MONGO_IMAGE, or CADDY_IMAGE in the host shell profile would otherwise
# silently override the approved references. The script removes those four
# variables from its own environment before it asks Compose, so the check and
# the rollout resolve the same set from the same files.
#
# Exit codes:
#   0  the effective image set is exactly the approved set
#   1  the effective image set differs, or the check could not be performed

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/release-common.sh
source "${SCRIPT_DIR}/lib/release-common.sh"

COMPOSE_FILE=""
ENV_FILES=()
EXPECTED_IMAGES=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose-file)
      COMPOSE_FILE="${2:?--compose-file requires a file}"
      shift 2
      ;;
    --env-file)
      ENV_FILES+=("${2:?--env-file requires a file}")
      shift 2
      ;;
    --expected)
      EXPECTED_IMAGES+=("${2:?--expected requires an image reference}")
      shift 2
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

[[ -n "${COMPOSE_FILE}" ]] || die "--compose-file <file> is required."
[[ -f "${COMPOSE_FILE}" ]] || die "The compose file '${COMPOSE_FILE}' does not exist."
[[ "${#ENV_FILES[@]}" -gt 0 ]] || die "At least one --env-file <file> is required: the effective image set is resolved from the host environment files, not from the ambient process environment."
[[ "${#EXPECTED_IMAGES[@]}" -gt 0 ]] || die "At least one --expected <image> is required."

for image in "${EXPECTED_IMAGES[@]}"; do
  if [[ ! "${image}" =~ @sha256:[0-9a-f]{64}$ ]]; then
    die "The expected image '${image}' is not an exact <repository>@sha256:<64 hex> reference."
  fi
done

require_command docker

COMPOSE_ARGS=(compose)
for env_file in "${ENV_FILES[@]}"; do
  if [[ ! -f "${env_file}" ]]; then
    die "The environment file '${env_file}' does not exist on this host."
  fi
  COMPOSE_ARGS+=(--env-file "${env_file}")
done
COMPOSE_ARGS+=(-f "${COMPOSE_FILE}")

# The effective image set must come from the declared environment files and
# from nothing else. An ambient variable in the host shell profile would
# otherwise outrank the --env-file value and could deploy an image that was
# never approved.
unset BACKEND_IMAGE FRONTEND_IMAGE MONGO_IMAGE CADDY_IMAGE

log_info "Resolving the effective image set of ${COMPOSE_FILE} from the declared environment files."
ACTUAL_IMAGES="$(docker "${COMPOSE_ARGS[@]}" config --images 2>/dev/null | sed '/^[[:space:]]*$/d')" || {
  die "docker compose config --images failed; the effective image set could not be resolved."
}

if [[ -z "${ACTUAL_IMAGES}" ]]; then
  die "docker compose config --images returned no image; the effective image set could not be verified."
fi

EXPECTED_SORTED="$(printf '%s\n' "${EXPECTED_IMAGES[@]}" | sed '/^[[:space:]]*$/d' | LC_ALL=C sort)"
ACTUAL_SORTED="$(printf '%s\n' "${ACTUAL_IMAGES}" | LC_ALL=C sort)"

if [[ "${ACTUAL_SORTED}" != "${EXPECTED_SORTED}" ]]; then
  log_error "The effective image set on this host differs from the approved image set."
  log_error "Approved image set:"
  while IFS= read -r image; do
    [[ -n "${image}" ]] && log_error "  ${image}"
  done <<< "${EXPECTED_SORTED}"
  log_error "Effective image set on this host:"
  while IFS= read -r image; do
    [[ -n "${image}" ]] && log_error "  ${image}"
  done <<< "${ACTUAL_SORTED}"
  log_error "Only the approved image set may be deployed. The rollout is refused."
  exit 1
fi

log_info "The effective image set on this host is exactly the approved image set:"
while IFS= read -r image; do
  [[ -n "${image}" ]] && log_info "  ${image}"
done <<< "${ACTUAL_SORTED}"
