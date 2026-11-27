#!/usr/bin/env bash
#
# Records the release environment of a production rollout and the rollback
# reference that points at the revision that was live before it.
#
# The release environment file (<deploy-path>/.release.env) names the exact
# image digests that the Compose project is started with. The rollback
# reference (<deploy-path>/rollback/<source_sha>.env) names the exact image
# digests of the revision that was live **before** the rollout.
#
# Both files contain the complete approved four-image set:
#
#   BACKEND_IMAGE, FRONTEND_IMAGE, MONGO_IMAGE, CADDY_IMAGE, SOURCE_SHA
#
# The MongoDB and Caddy references are part of the rollback reference on
# purpose. A rollback that only restored the application images would leave a
# newly approved MongoDB or Caddy image in place, so the rolled-back stack
# would not be the stack that was approved and tested before.
#
# The previous image set is resolved in this order:
#
#   1. the live <deploy-path>/.release.env, when it declares the complete
#      four-image set;
#   2. the release manifest of the revision that the live .release.env names
#      (<deploy-path>/releases/<source_sha>/release-manifest.json);
#   3. the most recent other release manifest under <deploy-path>/releases/.
#
# When none of them yields a complete four-image set, the script fails
# closed: an incomplete rollback reference is worse than no rollout. The
# initial installation is the only exception: a host that never ran a
# release has nothing to roll back to, and that is recorded explicitly.
#
# Usage:
#   scripts/prepare-release-env.sh \
#     --deploy-path <directory> --source-sha <40 hex> \
#     --backend-image <reference> --frontend-image <reference> \
#     --mongo-image <reference> --caddy-image <reference>
#
#   scripts/prepare-release-env.sh --verify <environment file>
#
# Exit codes:
#   0  the release environment was recorded, or the verified file is complete
#   1  the previous image set could not be resolved, or a file is incomplete

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/release-common.sh
source "${SCRIPT_DIR}/lib/release-common.sh"

IMAGE_KEYS=(BACKEND_IMAGE FRONTEND_IMAGE MONGO_IMAGE CADDY_IMAGE)

DEPLOY_PATH=""
SOURCE_SHA=""
VERIFY_FILE=""
BACKEND_IMAGE_ARG=""
FRONTEND_IMAGE_ARG=""
MONGO_IMAGE_ARG=""
CADDY_IMAGE_ARG=""

# The image references may be supplied as arguments or as environment
# variables. The arguments win.
BACKEND_IMAGE_ARG="${BACKEND_IMAGE:-${BACKEND_IMAGE_ARG:-}}"
FRONTEND_IMAGE_ARG="${FRONTEND_IMAGE:-${FRONTEND_IMAGE_ARG:-}}"
MONGO_IMAGE_ARG="${MONGO_IMAGE:-${MONGO_IMAGE_ARG:-}}"
CADDY_IMAGE_ARG="${CADDY_IMAGE:-${CADDY_IMAGE_ARG:-}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy-path)
      DEPLOY_PATH="${2:?--deploy-path requires a directory}"
      shift 2
      ;;
    --source-sha)
      SOURCE_SHA="${2:?--source-sha requires a commit SHA}"
      shift 2
      ;;
    --backend-image)
      BACKEND_IMAGE_ARG="${2:?--backend-image requires an image reference}"
      shift 2
      ;;
    --frontend-image)
      FRONTEND_IMAGE_ARG="${2:?--frontend-image requires an image reference}"
      shift 2
      ;;
    --mongo-image)
      MONGO_IMAGE_ARG="${2:?--mongo-image requires an image reference}"
      shift 2
      ;;
    --caddy-image)
      CADDY_IMAGE_ARG="${2:?--caddy-image requires an image reference}"
      shift 2
      ;;
    --verify)
      VERIFY_FILE="${2:?--verify requires an environment file}"
      shift 2
      ;;
    -h | --help)
      sed -n '2,40p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      exit 2
      ;;
  esac
done

is_digest_reference() {
  [[ "$1" =~ ^[^[:space:]@]+@sha256:[0-9a-f]{64}$ ]]
}

read_env_value() {
  local file="$1"
  local key="$2"
  [[ -f "${file}" ]] || return 0
  sed -n "s/^${key}=//p" "${file}" | head -n 1
}

# Writes the four image references and the source SHA into an environment
# file. The file is written atomically and is only readable by the deployment
# user.
write_release_env() {
  local target="$1"
  local sha="$2"
  local backend="$3"
  local frontend="$4"
  local mongo="$5"
  local caddy="$6"
  local temporary="${target}.tmp.$$"

  umask 077
  {
    printf 'BACKEND_IMAGE=%s\n' "${backend}"
    printf 'FRONTEND_IMAGE=%s\n' "${frontend}"
    printf 'MONGO_IMAGE=%s\n' "${mongo}"
    printf 'CADDY_IMAGE=%s\n' "${caddy}"
    printf 'SOURCE_SHA=%s\n' "${sha}"
  } > "${temporary}"
  chmod 600 "${temporary}"
  mv -f "${temporary}" "${target}"
}

# Returns 0 when the file declares the complete four-image set.
is_complete_release_env() {
  local file="$1"
  local key
  [[ -f "${file}" ]] || return 1
  for key in "${IMAGE_KEYS[@]}"; do
    local value
    value="$(read_env_value "${file}" "${key}")"
    if [[ -z "${value}" ]] || ! is_digest_reference "${value}"; then
      return 1
    fi
  done
  return 0
}

# ---------------------------------------------------------------------------
# --verify: check an existing environment file
# ---------------------------------------------------------------------------

if [[ -n "${VERIFY_FILE}" ]]; then
  if [[ ! -f "${VERIFY_FILE}" ]]; then
    die "The environment file '${VERIFY_FILE}' does not exist."
  fi
  missing=""
  for key in "${IMAGE_KEYS[@]}"; do
    value="$(read_env_value "${VERIFY_FILE}" "${key}")"
    if [[ -z "${value}" ]]; then
      missing="${missing} ${key}"
    elif ! is_digest_reference "${value}"; then
      die "The environment file '${VERIFY_FILE}' declares ${key}='${value}', which is not an exact <repository>@sha256:<64 hex> reference."
    fi
  done
  if [[ -n "${missing}" ]]; then
    die "The environment file '${VERIFY_FILE}' does not declare the complete approved image set; missing:${missing}."
  fi
  log_info "The environment file ${VERIFY_FILE} declares the complete approved four-image set."
  exit 0
fi

# ---------------------------------------------------------------------------
# Record the release environment and the rollback reference
# ---------------------------------------------------------------------------

[[ -n "${DEPLOY_PATH}" ]] || die "--deploy-path <directory> is required."
[[ -n "${SOURCE_SHA}" ]] || die "--source-sha <40 hex> is required."
if [[ ! "${SOURCE_SHA}" =~ ^[0-9a-f]{40}$ ]]; then
  die "The source SHA must be an exact 40 character lowercase commit SHA."
fi

check_image_argument() {
  local name="$1"
  local value="$2"
  if [[ -z "${value}" ]]; then
    die "${name} is required."
  fi
  if ! is_digest_reference "${value}"; then
    die "${name}='${value}' is not an exact <repository>@sha256:<64 hex> reference."
  fi
}

check_image_argument BACKEND_IMAGE "${BACKEND_IMAGE_ARG}"
check_image_argument FRONTEND_IMAGE "${FRONTEND_IMAGE_ARG}"
check_image_argument MONGO_IMAGE "${MONGO_IMAGE_ARG}"
check_image_argument CADDY_IMAGE "${CADDY_IMAGE_ARG}"

RELEASE_ENV="${DEPLOY_PATH%/}/.release.env"
ROLLBACK_DIR="${DEPLOY_PATH%/}/rollback"
ROLLBACK_ENV="${ROLLBACK_DIR}/${SOURCE_SHA}.env"

# --- resolve the previous image set ----------------------------------------

PREVIOUS_BACKEND=""
PREVIOUS_FRONTEND=""
PREVIOUS_MONGO=""
PREVIOUS_CADDY=""
PREVIOUS_SHA=""
PREVIOUS_SOURCE=""

live_sha="$(read_env_value "${RELEASE_ENV}" SOURCE_SHA)"

# Whether the host ever ran a release other than this one. When it did, the
# previous image set must be resolvable; when it did not, this is the initial
# installation. The manifest of the release that is being installed does not
# count: the deployment workflow copies it to the host before this script
# runs, and it is not a previous release.
previous_release_evidence() {
  if [[ -f "${RELEASE_ENV}" ]]; then
    return 0
  fi
  local candidate
  local candidate_sha=""
  while IFS= read -r candidate; do
    [[ -n "${candidate}" && -f "${candidate}" ]] || continue
    candidate_sha="$(sed -n 's/.*"sourceSha"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p' "${candidate}" | head -n 1)"
    if [[ -n "${candidate_sha}" && "${candidate_sha}" != "${SOURCE_SHA}" ]]; then
      return 0
    fi
  done < <(ls -t "${DEPLOY_PATH%/}/releases/"*/release-manifest.json 2>/dev/null || true)
  return 1
}

# 1. The live release environment, when it is complete.
if is_complete_release_env "${RELEASE_ENV}"; then
  PREVIOUS_BACKEND="$(read_env_value "${RELEASE_ENV}" BACKEND_IMAGE)"
  PREVIOUS_FRONTEND="$(read_env_value "${RELEASE_ENV}" FRONTEND_IMAGE)"
  PREVIOUS_MONGO="$(read_env_value "${RELEASE_ENV}" MONGO_IMAGE)"
  PREVIOUS_CADDY="$(read_env_value "${RELEASE_ENV}" CADDY_IMAGE)"
  PREVIOUS_SHA="${live_sha}"
  PREVIOUS_SOURCE="the live ${RELEASE_ENV}"
elif [[ -f "${RELEASE_ENV}" ]]; then
  log_warn "The live ${RELEASE_ENV} does not declare the complete four-image set; the previous release manifest is used instead."
fi

# 2. The release manifest of the revision that the live environment names.
if [[ -z "${PREVIOUS_BACKEND}" && -n "${live_sha}" && "${live_sha}" =~ ^[0-9a-f]{40}$ ]]; then
  manifest="${DEPLOY_PATH%/}/releases/${live_sha}/release-manifest.json"
  if [[ -f "${manifest}" ]]; then
    block="$(awk '
      /"images"[[:space:]]*:[[:space:]]*\{/ { inside = 1; next }
      inside && /^[[:space:]]*\}/ { inside = 0; next }
      inside { print }
    ' "${manifest}")"
    candidate_backend="$(printf '%s\n' "${block}" | sed -n 's/.*"backend"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    candidate_frontend="$(printf '%s\n' "${block}" | sed -n 's/.*"frontend"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    candidate_mongo="$(printf '%s\n' "${block}" | sed -n 's/.*"mongo"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    candidate_caddy="$(printf '%s\n' "${block}" | sed -n 's/.*"caddy"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    if is_digest_reference "${candidate_backend}" &&
      is_digest_reference "${candidate_frontend}" &&
      is_digest_reference "${candidate_mongo}" &&
      is_digest_reference "${candidate_caddy}"; then
      PREVIOUS_BACKEND="${candidate_backend}"
      PREVIOUS_FRONTEND="${candidate_frontend}"
      PREVIOUS_MONGO="${candidate_mongo}"
      PREVIOUS_CADDY="${candidate_caddy}"
      PREVIOUS_SHA="${live_sha}"
      PREVIOUS_SOURCE="the release manifest of ${live_sha}"
    fi
  fi
fi

# 3. The most recent other release manifest.
if [[ -z "${PREVIOUS_BACKEND}" ]]; then
  while IFS= read -r manifest; do
    [[ -n "${manifest}" && -f "${manifest}" ]] || continue
    manifest_sha="$(sed -n 's/.*"sourceSha"[[:space:]]*:[[:space:]]*"\([0-9a-f]*\)".*/\1/p' "${manifest}" | head -n 1)"
    [[ "${manifest_sha}" == "${SOURCE_SHA}" ]] && continue
    block="$(awk '
      /"images"[[:space:]]*:[[:space:]]*\{/ { inside = 1; next }
      inside && /^[[:space:]]*\}/ { inside = 0; next }
      inside { print }
    ' "${manifest}")"
    candidate_backend="$(printf '%s\n' "${block}" | sed -n 's/.*"backend"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    candidate_frontend="$(printf '%s\n' "${block}" | sed -n 's/.*"frontend"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    candidate_mongo="$(printf '%s\n' "${block}" | sed -n 's/.*"mongo"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    candidate_caddy="$(printf '%s\n' "${block}" | sed -n 's/.*"caddy"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    if is_digest_reference "${candidate_backend}" &&
      is_digest_reference "${candidate_frontend}" &&
      is_digest_reference "${candidate_mongo}" &&
      is_digest_reference "${candidate_caddy}"; then
      PREVIOUS_BACKEND="${candidate_backend}"
      PREVIOUS_FRONTEND="${candidate_frontend}"
      PREVIOUS_MONGO="${candidate_mongo}"
      PREVIOUS_CADDY="${candidate_caddy}"
      PREVIOUS_SHA="${manifest_sha}"
      PREVIOUS_SOURCE="${manifest}"
      break
    fi
  done < <(ls -t "${DEPLOY_PATH%/}/releases/"*/release-manifest.json 2>/dev/null || true)
fi

if [[ -z "${PREVIOUS_BACKEND}" ]]; then
  # A host that never ran a release has nothing to roll back to. That is the
  # initial installation, and it is recorded explicitly. A host that *did*
  # run a release but whose previous image set cannot be resolved is refused:
  # an incomplete rollback reference is worse than no rollout.
  if previous_release_evidence; then
    die "The previous approved four-image set could not be resolved under ${DEPLOY_PATH}. The rollback reference would be incomplete, so the rollout is refused. Record the complete image set in ${RELEASE_ENV} before the next rollout."
  fi

  write_release_env "${RELEASE_ENV}" "${SOURCE_SHA}" \
    "${BACKEND_IMAGE_ARG}" "${FRONTEND_IMAGE_ARG}" "${MONGO_IMAGE_ARG}" "${CADDY_IMAGE_ARG}"

  mkdir -p "${ROLLBACK_DIR}"
  chmod 700 "${ROLLBACK_DIR}"
  printf 'The host had no previous release; this is the initial installation and there is no rollback reference.\n' \
    > "${ROLLBACK_DIR}/${SOURCE_SHA}.no-previous-release"
  chmod 600 "${ROLLBACK_DIR}/${SOURCE_SHA}.no-previous-release"

  log_info "Release environment written to ${RELEASE_ENV}."
  log_warn "The host had no previous release; this is the initial installation and there is no rollback reference."
  exit 0
fi

mkdir -p "${ROLLBACK_DIR}"
chmod 700 "${ROLLBACK_DIR}"
write_release_env "${ROLLBACK_ENV}" "${PREVIOUS_SHA}" \
  "${PREVIOUS_BACKEND}" "${PREVIOUS_FRONTEND}" "${PREVIOUS_MONGO}" "${PREVIOUS_CADDY}"

write_release_env "${RELEASE_ENV}" "${SOURCE_SHA}" \
  "${BACKEND_IMAGE_ARG}" "${FRONTEND_IMAGE_ARG}" "${MONGO_IMAGE_ARG}" "${CADDY_IMAGE_ARG}"

log_info "Release environment written to ${RELEASE_ENV}."
log_info "Rollback reference written to ${ROLLBACK_ENV} (previous revision ${PREVIOUS_SHA:-unknown}, resolved from ${PREVIOUS_SOURCE})."
log_info "The rollback reference restores the complete approved four-image set:"
log_info "  BACKEND_IMAGE=${PREVIOUS_BACKEND}"
log_info "  FRONTEND_IMAGE=${PREVIOUS_FRONTEND}"
log_info "  MONGO_IMAGE=${PREVIOUS_MONGO}"
log_info "  CADDY_IMAGE=${PREVIOUS_CADDY}"
