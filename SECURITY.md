# Security Policy

## Reporting

Do not open a public issue for a suspected vulnerability or exposed credential. Use the repository's private GitHub security-advisory reporting flow and include:

- affected endpoint or component;
- reproducible steps and expected impact;
- the affected commit or deployment version;
- any logs or screenshots with personal data removed.

For an active incident involving customer data, rotate affected credentials and sessions before sharing diagnostic material.

## Handling rules

- Never commit `.env`, supplied customer/transformer data, database files, avatar files, backups, or archives.
- Treat `.temp/sigap/` as read-only ground truth and do not include it in issue attachments, CI artifacts, or deployment packages.
- Rotate `SESSION_SECRET`, the initial administrator password, and any GHCR/VPS credentials that may have been exposed. There is no CSRF secret to rotate: the API runtime does not read one — every session receives an independent random CSRF token whose SHA-256 hash is stored server-side.
- Production sessions are opaque and revocable. Password changes invalidate existing sessions.
- The CSRF token lives only in the `sigap_csrf` cookie, is never returned in a JSON body, and is never written to `localStorage`/`sessionStorage`.
- Guest synchronization uses only the server-configured Google Apps Script endpoint. Client-supplied destinations are rejected.
- Import previews are short-lived and bound to the authenticated user who created them.

## Supported versions

Security fixes target the current `main` release and the most recent production container image. Historical images remain available for rollback but are not patched in place; deploy a newly built image instead.
