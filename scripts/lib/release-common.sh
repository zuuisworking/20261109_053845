#!/usr/bin/env bash
# Shared helpers for the SIGAP production release scripts.
#
# The helpers are intentionally dependency-light: only POSIX shell builtins,
# coreutils, and sed/awk are used, so the scripts run on the deployment host
# without a Node.js runtime and without a Docker daemon for the guard checks.

# shellcheck shell=bash

set -euo pipefail

log_info() {
  printf '[info] %s\n' "$*"
}

log_warn() {
  printf '[warn] %s\n' "$*" >&2
}

log_error() {
  printf '[error] %s\n' "$*" >&2
}

die() {
  log_error "$*"
  exit 1
}

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || die "Required command '${command_name}' is not available."
}

# Prints the lowercase SHA-256 digest of a file.
#
# Some MSYS/Cygwin builds of coreutils prefix the digest with a backslash to
# mark binary mode. The marker is removed so the value can be compared with a
# digest recorded by another tool or by another platform.
sha256_of_file() {
  local file_path="$1"
  local digest
  digest="$(sha256sum "${file_path}" | awk '{print $1}')"
  digest="${digest#\\}"
  printf '%s\n' "${digest,,}"
}

# Prints 1 when the value is an exact sha256 digest reference of the form
# <repository>@sha256:<64 lowercase hex characters>.
is_sha256_digest_reference() {
  local value="$1"
  [[ "${value}" =~ @sha256:[0-9a-f]{64}$ ]]
}

# Percent-decodes a URI component. "+" is decoded as a space, matching the
# application/x-www-form-urlencoded convention used by MongoDB URIs.
url_decode() {
  local value="$1"
  value="${value//+/ }"
  printf '%b' "${value//%/\\x}"
}

# Creates a directory-based lock. The lock is portable to hosts without
# flock(1) and is released automatically when the owning process exits.
acquire_lock() {
  local lock_dir="$1"
  if ! mkdir "${lock_dir}" 2>/dev/null; then
    if [[ -f "${lock_dir}/owner.pid" ]]; then
      local owner_pid
      owner_pid="$(cat "${lock_dir}/owner.pid" 2>/dev/null || true)"
      if [[ -n "${owner_pid}" ]] && kill -0 "${owner_pid}" 2>/dev/null; then
        die "Another run (pid ${owner_pid}) holds the lock ${lock_dir}."
      fi
      log_warn "Removing stale lock ${lock_dir} (owner pid ${owner_pid:-unknown} is gone)."
    fi
    rm -rf "${lock_dir}"
    mkdir -p "${lock_dir}" || die "Cannot create lock directory ${lock_dir}."
  fi
  printf '%s\n' "$$" > "${lock_dir}/owner.pid"
  LOCK_DIR="${lock_dir}"
}

release_lock() {
  local lock_dir="${1:-${LOCK_DIR:-}}"
  [[ -n "${lock_dir}" ]] || return 0
  rm -rf "${lock_dir}"
}

# Verifies a SHA256SUMS file inside a directory. Fails closed on any mismatch.
verify_sha256_manifest() {
  local manifest_path="$1"
  local base_dir="$2"

  [[ -f "${manifest_path}" ]] || die "Checksum manifest ${manifest_path} is missing."
  require_command sha256sum

  local output
  if ! output="$(cd "${base_dir}" && sha256sum --check --strict "$(basename "${manifest_path}")" 2>&1)"; then
    log_error "${output}"
    die "Checksum verification failed for ${manifest_path}."
  fi
  log_info "Checksum verification passed for ${manifest_path}."
}
