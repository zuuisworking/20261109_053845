# Operator setup checklist — SIGAP ULP Labuhan

Nothing in this repository configures GitHub, the deployment host, the DNS
zone, or the certificate authority. This checklist is the executable form of
those obligations.

The repository does **not** claim that any of the items below are already
configured. `scripts/check-github-release-controls.sh` verifies the GitHub
items and fails closed when one is missing or cannot be verified; the host
items are verified by the release preflight and by the deployment smoke
checks.

## 0. Verified state of the remote repository

The remote repository `zuuisworking/20261109_053845` was inspected on
**2026-11-27** with read-only, authenticated GitHub API calls. The observed
state is recorded here exactly as observed.

| Control | Observed result | Conclusion |
|---|---|---|
| Published workflows | The workflow list is **empty** | **Not established.** The CI and deploy workflows in this repository are not published on the remote, because the change set is uncommitted. No CI run can therefore exist for any revision. |
| Rulesets | The rulesets API returned a list of length **0** | **Not established.** No ruleset protects `main`. |
| Environments | The environments API returned `total_count: 0` | **Not established.** There is no `production` environment, and therefore no environment reviewer and no deployment approval. |
| Branch protection for `main` | The branch protection endpoint returned **404 / unavailable** | **Not established.** `main` has no branch protection. |
| Repository variables | The variables list endpoint returned **403** for the active token | **Unverifiable.** The inventory of the required variables could not be read and is therefore unknown. |
| Repository secrets | The secrets list endpoint returned **403** for the active token | **Unverifiable.** The inventory of the required secrets could not be read and is therefore unknown. |

Running the fail-closed check against the remote confirms the same conclusion:
the script reports the environment as unreadable, finds no required reviewer,
finds neither an active ruleset nor branch protection for `main`, and cannot
read the variable or secret inventories. It exits non-zero with the summary
`The remote release controls are incomplete (N failed check(s)). See
docs/operations/operator-setup-checklist.md.`, where `N` is the number of
checks that failed or could not be performed. The individual error lines are
named in the script and are reproduced by re-running the command; they are not
transcribed here so that this document cannot drift from the real output.

**Consequences for a rollout, stated plainly:**

1. The deploy workflow's own gate — "a successful CI run must exist for this
   exact revision" — cannot be satisfied today, because no workflow is
   published and no CI run exists. The deploy workflow therefore refuses
   every deployment until the workflows are committed and pushed.
2. The `environment: production` declaration in the deploy workflow cannot
   request a reviewer today, because the environment does not exist. GitHub
   creates a referenced environment implicitly, without any protection rule,
   so no human approval gate exists for the rollout.
3. The 403 responses mean that the variable and secret inventories are
   **unknown**, not empty. They must be re-checked with a token that has
   repository administration access before a rollout; the built-in
   `GITHUB_TOKEN` cannot read them.
4. Nothing in this repository can change any of the above. The workflows, the
   scripts, and these documents can only *detect* the missing controls and
   refuse to proceed. Configuring them is an explicit operator action on the
   remote repository.

The remote repository was **not** modified during this inspection.

### 0.1 The token used by the release-controls CI job

The `release-controls` job in the CI workflow runs
`scripts/check-github-release-controls.sh` with `GH_TOKEN` set to the
built-in `GITHUB_TOKEN`. Reading an environment, a ruleset, a branch
protection rule, and the variable and secret inventories requires repository
administration access that the built-in token does not reliably have, so the
job will report those controls as unreadable and fail.

To make the job meaningful, store a token with repository administration
access as the repository secret `RELEASE_CONTROLS_TOKEN` and let the job use
it. The `secrets` inventory check remains an operator step in every case,
because listing repository secrets is a separate privilege. The fail-closed
behaviour is deliberate: a control that cannot be proven is treated as
absent.

## 1. GitHub repository settings

| # | Item | How to configure | How it is verified |
|---|---|---|---|
| 1.1 | A `production` environment exists | Settings → Environments → New environment | `scripts/check-github-release-controls.sh` reads the environment and fails when it is missing |
| 1.2 | The environment requires a reviewer | Environment → Deployment protection rules → Required reviewers | The same script fails when the reviewer count is zero |
| 1.3 | The environment limits the deployment branches | Environment → Deployment branches | The deploy workflow additionally refuses a revision that did not come from the protected branch or from a tag |
| 1.4 | The protected branch (`main`) has a ruleset or branch protection that requires the CI checks | Settings → Rules → Rulesets, or Settings → Branches | The script fails when neither an active ruleset nor branch protection is found |
| 1.5 | The required status checks are the CI job names | Branch protection → Require status checks | The deploy workflow refuses to deploy without a successful CI run for the exact revision, which makes the branch protection a second, independent gate |

### 1.5.1 Release refs

| # | Item | Requirement | How it is verified |
|---|---|---|---|
| 1.5.1.1 | The protected branch name | The repository variable `RELEASE_PROTECTED_BRANCH` names it; the default is `main` | The deploy workflow refuses a revision whose successful CI run is not on this branch |
| 1.5.1.2 | The release tag pattern | The repository variable `RELEASE_TAG_PATTERN` names it; the default is `v*` | The deploy workflow refuses a tag that does not match it |
| 1.5.1.3 | The CI workflow runs for release tags | The CI workflow triggers on `push` of a `v*` tag, so that a tag deployment has a CI run to point at | The deploy workflow searches for a successful CI run on the tag |

Only a `push` or a `workflow_dispatch` CI run on the protected branch or on a
release tag authorises a deployment. A `pull_request` CI run never does,
whatever the `source_sha` input says.

### 1.6 Repository variables

Create these as repository or environment variables:

| Variable | Example | Used by |
|---|---|---|
| `PUBLIC_APP_URL` | `https://app.example.com` | The validator and the smoke checks |
| `PUBLIC_HOST` | `app.example.com` | The validator, the Caddyfile, and the TLS smoke check |
| `CLIENT_URLS` | `https://app.example.com` | The backend origin allowlist |
| `ACME_EMAIL` | `operations@example.com` | The Caddy ACME contact |
| `MONGO_IMAGE` | `docker.io/library/mongo@sha256:<64 hex>` | The compose file |
| `CADDY_IMAGE` | `docker.io/library/caddy@sha256:<64 hex>` | The compose file |
| `RELEASE_PROTECTED_BRANCH` | `main` | The deploy workflow: the only branch that may authorise a deployment |
| `RELEASE_TAG_PATTERN` | `v*` | The deploy workflow: the tags that may authorise a deployment |
| `TRIVY_IMAGE` | `aquasec/trivy:0.58.1@sha256:<64 hex>` | The CI and publish image scans; optional, the workflow default is digest-pinned |

The variable values must be exact digest references for the images.

The `MONGO_IMAGE` and `CADDY_IMAGE` variables must be the **same** digests
that the host environment file uses. Before the rollout the deploy workflow
compares the image set that Compose resolves on the host with the four
digests in the approved release manifest, and a difference stops the
rollout. A host environment file that still names an older MongoDB or Caddy
image must be updated before the next rollout.

### 1.7 Repository secrets

| Secret | Purpose |
|---|---|
| `VPS_HOST`, `VPS_USER`, `VPS_SSH_PORT` | The deployment host |
| `VPS_SSH_KEY` | The private key used for the deployment |
| `VPS_SSH_HOST_KEY` | The pinned host key of the deployment host, in `known_hosts` format |
| `VPS_DEPLOY_PATH` | The deployment directory, for example `/opt/sigap` |
| `VPS_GHCR_USERNAME`, `VPS_GHCR_TOKEN` | The registry credential that the host uses to pull the images |
| `SESSION_SECRET` | The session signing secret; the only application secret the runtime reads |
| `MONGO_ROOT_USERNAME`, `MONGO_ROOT_PASSWORD` | The bootstrap root identity |
| `MONGO_APP_USERNAME`, `MONGO_APP_PASSWORD` | The application identity |
| `MONGO_BACKUP_USERNAME`, `MONGO_BACKUP_PASSWORD` | The backup identity |
| `MONGO_RESTORE_USERNAME`, `MONGO_RESTORE_PASSWORD` | The restore identity |
| `COMPOSE_MONGODB_URI` | The application URI; it must authenticate as the application identity and use `authSource=<application database>` |
| `RELEASE_MANIFEST_SIGNING_KEY_B64` | The base64 encoded signing key. **Required**: the publish job refuses to create an unsigned release manifest, so a rollout is impossible without it. |
| `RELEASE_MANIFEST_PUBLIC_KEY_B64` | The base64 encoded public key. **Required**: the deploy job refuses to roll out without it, always sets `REQUIRE_RELEASE_MANIFEST_SIGNATURE=true`, and therefore fails on an unsigned, missing, or tampered manifest. |
| `RELEASE_CONTROLS_TOKEN` | A token with repository administration access; the `release-controls` CI job uses it to read the environment, the rulesets, the branch protection, and the variable inventory |

There is **no CSRF secret** to provision. Per ADR-0005 the API runtime does not
read one: every session receives an independent random CSRF token whose
SHA-256 hash is stored server-side, and the browser sends that token back in
the `x-csrf-token` header. The Compose files, the CI workflows, the release
validator, and the environment templates therefore do not define or require a
`CSRF_SECRET` variable, and provisioning one would imply a runtime dependency
that does not exist.

`scripts/check-github-release-controls.sh` verifies the presence of the
`VPS_*` secrets. The built-in `GITHUB_TOKEN` cannot list repository secrets,
so the secret inventory check is skipped by the CI job and must be run by an
operator with an administration token:

```bash
GH_TOKEN=<administration token> \
  scripts/check-github-release-controls.sh --repository <owner>/<repository>
```

## 2. Deployment host

| # | Item | Requirement | How it is verified |
|---|---|---|---|
| 2.1 | Docker Engine and the Compose plugin | `docker compose version` must succeed | The preflight runs `docker compose config` |
| 2.2 | A dedicated deployment user | Not `root`; owns `<deploy-path>` | Operator |
| 2.3 | The deployment path | `<deploy-path>` contains `docker-compose.prod.yml`, `Caddyfile`, `.env`, `mongo/init/`, and `scripts/` | The deploy workflow copies the files |
| 2.4 | The environment file | `<deploy-path>/.env`, mode `600`, populated from `deploy/.env.production.example` | The preflight reads the variables |
| 2.4.1 | The host environment file names the approved images | `<deploy-path>/.env` defines `MONGO_IMAGE` and `CADDY_IMAGE` with the same approved digests as the repository variables | `scripts/verify-host-image-set.sh` compares the effective Compose image set with the approved digests before the rollout and refuses a difference |
| 2.4.2 | The release environment file | `<deploy-path>/.release.env` is written by the deploy workflow with `BACKEND_IMAGE`, `FRONTEND_IMAGE`, `MONGO_IMAGE`, `CADDY_IMAGE`, and `SOURCE_SHA` | `scripts/prepare-release-env.sh --verify` refuses a reference that does not declare the complete four-image set |
| 2.4.3 | The rollback reference | `<deploy-path>/rollback/<sha>.env` holds the complete four-image set of the previous release; the initial installation is recorded as `<deploy-path>/rollback/<sha>.no-previous-release` | The deploy workflow verifies the reference before the rollout and refuses a rollout without one |
| 2.4.4 | No ambient image variables on the host | The deployment user's shell profile does not export `BACKEND_IMAGE`, `FRONTEND_IMAGE`, `MONGO_IMAGE`, or `CADDY_IMAGE` | Docker Compose gives the process environment a higher precedence than an `--env-file` value. The check and the rollout both remove those variables, so an exported variable can neither pass the check nor change what is deployed. |
| 2.5 | The host key | `ssh-keyscan -p <port> <host>` reviewed by an operator and stored in the `VPS_SSH_HOST_KEY` secret | `StrictHostKeyChecking=yes` fails on a mismatch |
| 2.6 | The firewall | Only 80 and 443 are reachable from the internet; 27017 is not published | Operator |
| 2.7 | The DNS record | `PUBLIC_HOST` resolves to the host | The TLS smoke check fails otherwise |
| 2.8 | Disk space | Room for the images, the volumes, and the local backups | Operator |
| 2.9 | A backup target | An encrypted, access-controlled, off-host location | **Not verifiable by the repository.** See the backup runbook. |
| 2.10 | A backup schedule | A `cron` or systemd timer that runs `scripts/backup-mongodb.sh` | **Not verifiable by the repository.** |
| 2.11 | A restore rehearsal schedule | A periodic isolated rehearsal that proves a backup can be restored | **Not verifiable by the repository.** |

### 2.12 Host preparation, step by step

```bash
# 1. Create the deployment user and the directory.
sudo adduser --disabled-password --gecos '' sigapdeploy
sudo install -d -o sigapdeploy -g sigapdeploy -m 750 /opt/sigap
sudo install -d -o sigapdeploy -g sigapdeploy -m 750 /opt/sigap/mongo/init
sudo install -d -o sigapdeploy -g sigapdeploy -m 750 /opt/sigap/scripts/lib

# 2. Create the environment file from the template.
sudo install -m 600 -o sigapdeploy -g sigapdeploy /dev/null /opt/sigap/.env
sudo -u sigapdeploy nano /opt/sigap/.env
#   Fill in every value from deploy/.env.production.example.
#   Generate the secrets with: openssl rand -base64 48
#   MONGO_IMAGE and CADDY_IMAGE must be the approved digests, and they must
#   match the repository variables of the same name; the rollout refuses a
#   host image set that differs from the approved one.

# 3. Record the host key for the pinned known_hosts entry.
ssh-keyscan -p 22 deploy.example.com > /tmp/hostkey
#   Review the fingerprint with an out-of-band channel, then store it in the
#   VPS_SSH_HOST_KEY repository secret.

# 4. Install the Compose plugin and verify it.
docker compose version

# 5. Check that the host would deploy exactly the approved image set.
#    Run this from the repository with the same values as the host file.
scripts/verify-host-image-set.sh \
  --compose-file deploy/docker-compose.prod.yml \
  --env-file /opt/sigap/.env \
  --expected ghcr.io/<owner>/<repository>/backend@sha256:<64 hex> \
  --expected ghcr.io/<owner>/<repository>/frontend@sha256:<64 hex> \
  --expected docker.io/library/mongo@sha256:<64 hex> \
  --expected docker.io/library/caddy@sha256:<64 hex>
```

## 3. MongoDB identities and roles

| # | Item | Requirement | Reference |
|---|---|---|---|
| 3.1 | The initialisation script has run | On a **fresh** volume | `deploy/mongo/README.md` |
| 3.2 | The scoped roles exist | `sigapBackupRole` and `sigapRestoreRole` in `admin` | `deploy/mongo/README.md` |
| 3.3 | An existing volume has been reconciled | The init script does **not** re-run; the roles of an existing volume must be reconciled by a separately approved job | `deploy/mongo/README.md` section 2 |
| 3.4 | The bootstrap root credential has been revoked | The revocation is a break-glass operator procedure | `deploy/mongo/README.md` section 3 |

## 4. Verification before the first rollout

Run these in order:

```bash
# 1. The remote GitHub release controls.
GH_TOKEN=<administration token> \
  scripts/check-github-release-controls.sh --repository <owner>/<repository>

# 2. The action pins.
node scripts/check-action-pins.js
node scripts/check-action-pins.js --verify-remote

# 3. The release configuration.
PUBLIC_APP_URL=https://app.example.com \
PUBLIC_HOST=app.example.com \
CLIENT_URLS=https://app.example.com \
ACME_EMAIL=operations@example.com \
BACKEND_IMAGE=ghcr.io/<owner>/<repo>/backend@sha256:<64 hex> \
FRONTEND_IMAGE=ghcr.io/<owner>/<repo>/frontend@sha256:<64 hex> \
MONGO_IMAGE=docker.io/library/mongo@sha256:<64 hex> \
CADDY_IMAGE=docker.io/library/caddy@sha256:<64 hex> \
SESSION_SECRET=... \
MONGO_ROOT_USERNAME=... MONGO_ROOT_PASSWORD=... \
MONGO_APP_USERNAME=... MONGO_APP_PASSWORD=... \
MONGO_BACKUP_USERNAME=... MONGO_BACKUP_PASSWORD=... \
MONGO_RESTORE_USERNAME=... MONGO_RESTORE_PASSWORD=... \
COMPOSE_MONGODB_URI=... \
EXPECTED_GHCR_OWNER=<owner> EXPECTED_GHCR_REPOSITORY=<owner>/<repo> \
  scripts/validate-production-release.sh

# 4. The image set that the host would deploy.
#    Both environment files are required: the image set is resolved from the
#    files, never from an ambient shell variable.
scripts/verify-host-image-set.sh \
  --compose-file deploy/docker-compose.prod.yml \
  --env-file <deploy-path>/.env \
  --env-file <deploy-path>/.release.env \
  --expected ghcr.io/<owner>/<repo>/backend@sha256:<64 hex> \
  --expected ghcr.io/<owner>/<repo>/frontend@sha256:<64 hex> \
  --expected docker.io/library/mongo@sha256:<64 hex> \
  --expected docker.io/library/caddy@sha256:<64 hex>

# 5. A backup and an isolated restore rehearsal.
scripts/backup-mongodb.sh --dry-run
scripts/restore-mongodb.sh <archive> --rehearsal --dry-run
```

## 5. What this checklist does **not** cover

- The certificate authority and the ACME account.
- The organisational approval process for an image digest; the workflow reads
  the GitHub deployment record, but a human must decide.
- The incident response process, the on-call schedule, and the escalation
  contacts.
- The long-term retention of the SBOM, provenance, and scan artefacts.
- The legal and contractual obligations around the personal data in the
  database; the backup contains production personal data and must be handled
  accordingly.
