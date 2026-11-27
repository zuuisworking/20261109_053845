# Operations documentation — SIGAP ULP Labuhan

This directory describes how a production release is prepared, approved,
rolled out, verified, and rolled back, and it states plainly which parts are
implemented in this repository and which parts remain external operator
responsibilities.

| Document | Purpose |
|---|---|
| [Deployment reality](deployment-reality.md) | The topology and endpoints that actually exist today |
| [Production release](production-release.md) | The release gates, the pipeline, and the evidence record |
| [Image approval](image-approval.md) | Digest pinning, SBOM/provenance retention, scan exceptions |
| [Backup and restore](backup-restore.md) | Backup, restore rehearsal, reconciliation, and external gates |
| [Rollback runbook](rollback-runbook.md) | Rollback reference, triggers, and procedure |
| [Operator setup checklist](operator-setup-checklist.md) | The remote GitHub and host configuration that this repository cannot create |

## Non-claims

Nothing in this directory states that a remote GitHub environment, ruleset,
branch protection rule, host firewall, TLS certificate, backup target, or
credential store has been configured. Those are external obligations. The
repository only contains the checks that fail closed when they are missing:

- `scripts/check-github-release-controls.sh` verifies the remote release
  controls and fails when a control is absent or cannot be verified;
- `scripts/validate-production-release.sh` verifies the release configuration
  and fails closed on mutable images, placeholder secrets, identity mistakes,
  an incomplete bundle, a missing bundle checksum manifest, a missing approved
  release manifest, or a mismatching checksum;
- `scripts/verify-host-image-set.sh` compares the image set that Compose
  resolves on the host with the approved digests, and fails closed on a
  difference;
- `scripts/prepare-release-env.sh` records the release environment and the
  rollback reference with the complete approved four-image set, and fails
  closed when the previous image set cannot be resolved;
- `scripts/backup-mongodb.sh` and `scripts/restore-mongodb.sh` fail closed on
  identity, integrity, and reconciliation mismatches.

### Verified remote state (2026-11-27)

A read-only inspection of `zuuisworking/20261109_053845` found **no published
workflows, no rulesets, no environments, and no branch protection for
`main`**; the variable and secret inventories are **unverifiable** because
those list endpoints return 403 for the active token.
`scripts/check-github-release-controls.sh` fails closed and reports the remote
controls as incomplete. The remote repository was not modified.

The full evidence and the consequences for a rollout are recorded in
[Operator setup checklist](operator-setup-checklist.md#0-verified-state-of-the-remote-repository).

Run the checklist in [Operator setup checklist](operator-setup-checklist.md)
before the first production rollout.

