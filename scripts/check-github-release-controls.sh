#!/usr/bin/env bash
#
# Verifies that the remote GitHub release controls are actually configured.
#
# The repository cannot configure GitHub environments, branch protection, or
# rulesets from inside a workflow. This script therefore *verifies* them and
# fails closed when a control is missing or cannot be verified. It is the
# executable part of docs/operations/operator-setup-checklist.md.
#
# Requirements:
#   - the GitHub CLI (`gh`) with an authenticated token;
#   - for the secret inventory: a token that may read repository secrets
#     (a classic or fine-grained personal access token with repository
#     administration access). The built-in GITHUB_TOKEN cannot list secrets,
#     so the inventory check is skipped by the CI job and must be run by an
#     operator.
#
# Usage:
#   scripts/check-github-release-controls.sh [--repository <owner/repo>]
#       [--skip <check>[,<check>]]
#
# Checks:
#   environment         the `production` environment exists and is protected
#   rulesets           an active ruleset or branch protection covers `main`
#   variables          the required repository variables exist
#   secrets            the required repository secrets exist
#
# Exit codes:
#   0  every requested control is present
#   1  a control is missing, misconfigured, or could not be verified

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/lib/release-common.sh
source "${SCRIPT_DIR}/lib/release-common.sh"

REPOSITORY="${GITHUB_REPOSITORY:-}"
SKIPPED_CHECKS=""
ENVIRONMENT_NAME="${RELEASE_ENVIRONMENT_NAME:-production}"
PROTECTED_BRANCH="${RELEASE_PROTECTED_BRANCH:-main}"

REQUIRED_VARIABLES=(
  PUBLIC_APP_URL
  PUBLIC_HOST
)

REQUIRED_SECRETS=(
  VPS_HOST
  VPS_USER
  VPS_SSH_PORT
  VPS_SSH_KEY
  VPS_SSH_HOST_KEY
  VPS_DEPLOY_PATH
  VPS_GHCR_USERNAME
  VPS_GHCR_TOKEN
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repository)
      REPOSITORY="${2:?--repository requires owner/repo}"
      shift 2
      ;;
    --skip)
      SKIPPED_CHECKS="${2:?--skip requires a comma separated list of checks}"
      shift 2
      ;;
    -h | --help)
      sed -n '2,35p' "${BASH_SOURCE[0]}"
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      exit 2
      ;;
  esac
done

[[ -n "${REPOSITORY}" ]] || die "The repository must be supplied with --repository owner/repo."

command -v gh >/dev/null 2>&1 || die "The GitHub CLI (gh) is required to verify the remote release controls."

is_skipped() {
  local check_name="$1"
  [[ ",${SKIPPED_CHECKS}," == *",${check_name},"* ]]
}

FAILURES=0
fail() {
  log_error "$*"
  FAILURES=$((FAILURES + 1))
}

api() {
  gh api "$@"
}

# ---------------------------------------------------------------------------
# Environment protection
# ---------------------------------------------------------------------------

if is_skipped environment; then
  log_warn "Skipping the '${ENVIRONMENT_NAME}' environment check."
else
  environment_json="$(api "repos/${REPOSITORY}/environments/${ENVIRONMENT_NAME}" 2>&1)" || {
    fail "The '${ENVIRONMENT_NAME}' environment could not be read: ${environment_json}"
    environment_json=""
  }
  if [[ -n "${environment_json}" ]]; then
    reviewer_count="$(printf '%s' "${environment_json}" | node -e '
      let input = "";
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        try {
          const parsed = JSON.parse(input);
          const rules = Array.isArray(parsed.protection_rules) ? parsed.protection_rules : [];
          const reviewers = rules.filter((rule) => rule.type === "required_reviewers");
          const reviewersCount = reviewers.reduce(
            (total, rule) => total + ((rule.required_reviewers && rule.required_reviewers.length) || 0),
            0
          );
          process.stdout.write(String(reviewersCount));
        } catch (error) {
          process.stdout.write("0");
        }
      });
    ')"
    if [[ "${reviewer_count}" == "0" ]]; then
      fail "The '${ENVIRONMENT_NAME}' environment has no required reviewer. A deployment approval must be enforced before a rollout."
    else
      log_info "The '${ENVIRONMENT_NAME}' environment requires ${reviewer_count} reviewer(s)."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Branch protection or rulesets for the protected branch
# ---------------------------------------------------------------------------

if is_skipped rulesets; then
  log_warn "Skipping the branch protection and ruleset check."
else
  ruleset_count="$(api "repos/${REPOSITORY}/rulesets" --jq '[.[] | select(.enforcement == "active")] | length' 2>/dev/null || echo "unavailable")"
  if [[ "${ruleset_count}" == "unavailable" ]]; then
    fail "The repository rulesets could not be read; the protected branch state is not verifiable."
  else
    protection_status="$(api "repos/${REPOSITORY}/branches/${PROTECTED_BRANCH}/protection" --jq '.required_status_checks' 2>/dev/null || echo "unavailable")"
    if [[ "${ruleset_count}" == "0" && "${protection_status}" == "unavailable" ]]; then
      fail "Neither an active ruleset nor branch protection was found for '${PROTECTED_BRANCH}'."
    else
      log_info "Protected branch state for '${PROTECTED_BRANCH}': ${ruleset_count} active rule set(s), status checks: ${protection_status}."
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Repository variables
# ---------------------------------------------------------------------------

if is_skipped variables; then
  log_warn "Skipping the repository variable check."
else
  variables_json="$(api "repos/${REPOSITORY}/actions/variables" 2>&1)" || {
    fail "The repository variables could not be read: ${variables_json}"
    variables_json=""
  }
  if [[ -n "${variables_json}" ]]; then
    for variable_name in "${REQUIRED_VARIABLES[@]}"; do
      if ! printf '%s' "${variables_json}" | grep -q "\"${variable_name}\""; then
        fail "The required repository variable '${variable_name}' is missing."
      fi
    done
  fi
fi

# ---------------------------------------------------------------------------
# Repository secrets
# ---------------------------------------------------------------------------

if is_skipped secrets; then
  log_warn "Skipping the repository secret inventory. The built-in GITHUB_TOKEN cannot list secrets; run this script with an administration token."
else
  secrets_json="$(api "repos/${REPOSITORY}/actions/secrets" 2>&1)" || {
    fail "The repository secrets could not be read: ${secrets_json}"
    secrets_json=""
  }
  if [[ -n "${secrets_json}" ]]; then
    for secret_name in "${REQUIRED_SECRETS[@]}"; do
      if ! printf '%s' "${secrets_json}" | grep -q "\"${secret_name}\""; then
        fail "The required repository secret '${secret_name}' is missing."
      fi
    done
  fi
fi

if [[ "${FAILURES}" -gt 0 ]]; then
  die "The remote release controls are incomplete (${FAILURES} failed check(s)). See docs/operations/operator-setup-checklist.md."
fi

log_info "The remote release controls for ${REPOSITORY} are present."
