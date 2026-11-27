## Summary

<!-- Describe the user-visible and operational change. -->

## Source-of-truth and data handling

- [ ] `.temp/sigap/` was not modified.
- [ ] No missing customer, transformer, measurement, or alias values were fabricated.
- [ ] Customer identifiers remain strings and dotted power values retain their raw form and correct VA value.
- [ ] Import/export behavior was verified for the complete dataset.

## Validation

- [ ] Backend unit and integration tests pass.
- [ ] Frontend unit tests and production build pass.
- [ ] Visual/E2E checks pass when affected.
- [ ] `npm audit` reports no high or critical vulnerabilities.

## Deployment and rollback

- [ ] Persistent MongoDB and upload volumes are unaffected.
- [ ] Database migrations were tested in dry-run mode.
- [ ] Backup and rollback steps are documented for destructive changes.
