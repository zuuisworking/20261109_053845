const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { findBash, runScript, makeTempDir } = require('../helpers/bash');

const bash = findBash();
const describeIfBash = bash ? describe : describe.skip;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

const DIGEST_A = 'a'.repeat(64);
const DIGEST_B = 'b'.repeat(64);
const DIGEST_C = 'c'.repeat(64);
const DIGEST_D = 'd'.repeat(64);

const BASE_ENV = {
  PUBLIC_APP_URL: 'https://app.example.test',
  PUBLIC_HOST: 'app.example.test',
  CLIENT_URLS: 'https://app.example.test',
  ACME_EMAIL: 'ops@example.test',
  BACKEND_IMAGE: `ghcr.io/acme/sigap/backend@sha256:${DIGEST_A}`,
  FRONTEND_IMAGE: `ghcr.io/acme/sigap/frontend@sha256:${DIGEST_B}`,
  MONGO_IMAGE: `docker.io/library/mongo@sha256:${DIGEST_C}`,
  CADDY_IMAGE: `docker.io/library/caddy@sha256:${DIGEST_D}`,
  SESSION_SECRET: 'session-secret-0123456789-abcdefghijklmnop',
  MONGO_ROOT_USERNAME: 'sigap_root',
  MONGO_ROOT_PASSWORD: 'root-password-0123456789-abcdefghijk',
  MONGO_APP_USERNAME: 'sigap_app',
  MONGO_APP_PASSWORD: 'app-password-0123456789-abcdefghijklmnop',
  MONGO_BACKUP_USERNAME: 'sigap_backup',
  MONGO_BACKUP_PASSWORD: 'backup-password-0123456789-abcdefghi',
  MONGO_RESTORE_USERNAME: 'sigap_restore',
  MONGO_RESTORE_PASSWORD: 'restore-password-0123456789-abcdefgh',
  COMPOSE_MONGODB_URI:
    'mongodb://sigap_app:app-password-0123456789-abcdefghijklmnop@mongo:27017/sigap_ulp_labuhan?authSource=sigap_ulp_labuhan',
  EXPECTED_GHCR_OWNER: 'acme',
  EXPECTED_GHCR_REPOSITORY: 'acme/sigap',
  MONGO_DATABASE: 'sigap_ulp_labuhan',
  MONGO_RESTORE_DATABASE: 'sigap_ulp_labuhan_restore',
  SKIP_COMPOSE_CONFIG: 'true',
};

/**
 * Builds a release bundle and an approved release manifest that describes
 * it. The result is the production input: a bundle directory, the bundle
 * archive, and the manifest path.
 */
function buildApprovedRelease() {
  const outputDirectory = makeTempDir('sigap-approved-release-');
  const buildResult = runScript(
    'scripts/build-release-bundle.sh',
    ['--output', outputDirectory, '--source-sha', SOURCE_SHA, '--archive'],
    {}
  );
  expect(buildResult.status).toBe(0);

  const bundleDirectory = path.join(outputDirectory, 'bundle');
  const bundleArchive = path.join(outputDirectory, `sigap-release-${SOURCE_SHA}.tar.gz`);
  const manifestPath = path.join(outputDirectory, 'release-manifest.json');

  execFileSync(
    process.execPath,
    [
      path.join(REPO_ROOT, 'scripts', 'create-release-manifest.js'),
      '--output',
      manifestPath,
      '--source-sha',
      SOURCE_SHA,
      '--bundle',
      bundleArchive,
      '--approver',
      'ops-lead',
      '--approved-at',
      '2026-01-01T00:00:00Z',
    ],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        BACKEND_IMAGE: BASE_ENV.BACKEND_IMAGE,
        FRONTEND_IMAGE: BASE_ENV.FRONTEND_IMAGE,
        MONGO_IMAGE: BASE_ENV.MONGO_IMAGE,
        CADDY_IMAGE: BASE_ENV.CADDY_IMAGE,
      },
    }
  );

  return { outputDirectory, bundleDirectory, bundleArchive, manifestPath };
}

describeIfBash('production release validator', () => {
  it('accepts an approved release bundle with a signed-ready manifest', () => {
    const release = buildApprovedRelease();

    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      RELEASE_DIR: release.bundleDirectory,
      RELEASE_MANIFEST: release.manifestPath,
      BUNDLE_ARCHIVE: release.bundleArchive,
    });

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/passed the preflight/i);
  });

  it('fails closed when the approved release manifest is absent', () => {
    const release = buildApprovedRelease();

    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      RELEASE_DIR: release.bundleDirectory,
      BUNDLE_ARCHIVE: release.bundleArchive,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/RELEASE_MANIFEST is required/);
  });

  it('fails closed when the release bundle has no checksum manifest', () => {
    const release = buildApprovedRelease();
    fs.unlinkSync(path.join(release.bundleDirectory, 'SHA256SUMS'));

    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      RELEASE_DIR: release.bundleDirectory,
      RELEASE_MANIFEST: release.manifestPath,
      BUNDLE_ARCHIVE: release.bundleArchive,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/SHA256SUMS is missing/);
  });

  it('fails closed when the bundle-only mode finds no checksum manifest', () => {
    const release = buildApprovedRelease();
    fs.unlinkSync(path.join(release.bundleDirectory, 'SHA256SUMS'));

    const result = runScript('scripts/validate-production-release.sh', ['--bundle-only'], {
      ...BASE_ENV,
      RELEASE_DIR: release.bundleDirectory,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/SHA256SUMS is missing/);
  });

  it('keeps the bundle-only mode usable without a release manifest', () => {
    const release = buildApprovedRelease();

    const result = runScript('scripts/validate-production-release.sh', ['--bundle-only'], {
      ...BASE_ENV,
      RELEASE_DIR: release.bundleDirectory,
    });

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/passed the preflight/i);
    expect(result.output).not.toMatch(/RELEASE_MANIFEST is required/);
  });

  it('fails closed when the recorded bundle checksum does not match the archive bytes', () => {
    const release = buildApprovedRelease();
    const tamperedArchive = path.join(release.outputDirectory, 'tampered.tar.gz');
    fs.writeFileSync(tamperedArchive, 'not the approved bundle');

    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      RELEASE_DIR: release.bundleDirectory,
      RELEASE_MANIFEST: release.manifestPath,
      BUNDLE_ARCHIVE: tamperedArchive,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/bundle.sha256 does not match/);
  });

  it('fails closed when no bundle archive is supplied for the checksum verification', () => {
    const release = buildApprovedRelease();

    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      RELEASE_DIR: release.bundleDirectory,
      RELEASE_MANIFEST: release.manifestPath,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/BUNDLE_ARCHIVE is required/);
  });

  it('rejects a mutable image tag instead of a digest', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      BACKEND_IMAGE: 'ghcr.io/acme/sigap/backend:latest',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/BACKEND_IMAGE must reference/);
  });

  it('rejects a fake sha256 digest', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      FRONTEND_IMAGE: 'ghcr.io/acme/sigap/frontend@sha256:not-a-digest',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/FRONTEND_IMAGE/);
  });

  it('rejects an image from an unexpected repository', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      MONGO_IMAGE: `docker.io/library/mongo:8.0`,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/MONGO_IMAGE must reference/);
  });

  it('rejects a secret that is shorter than 32 characters', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      SESSION_SECRET: 'too-short',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/SESSION_SECRET must be at least 32 characters/);
  });

  it('rejects a placeholder secret', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      SESSION_SECRET: 'replace-with-a-random-secret-of-at-least-32-bytes',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/SESSION_SECRET still contains a placeholder/);
  });

  it('does not require a CSRF secret, because the runtime does not read one', () => {
    const release = buildApprovedRelease();
    const envWithoutCsrfSecret = { ...BASE_ENV };
    delete envWithoutCsrfSecret.CSRF_SECRET;

    const result = runScript('scripts/validate-production-release.sh', [], {
      ...envWithoutCsrfSecret,
      RELEASE_DIR: release.bundleDirectory,
      RELEASE_MANIFEST: release.manifestPath,
      BUNDLE_ARCHIVE: release.bundleArchive,
    });

    expect(result.status).toBe(0);
    expect(result.output).not.toMatch(/CSRF_SECRET/);
  });

  it('rejects a public URL that does not use HTTPS', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      PUBLIC_APP_URL: 'http://app.example.test',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/PUBLIC_APP_URL must be an absolute HTTPS URL/);
  });

  it('rejects a public URL whose host does not match PUBLIC_HOST', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      PUBLIC_APP_URL: 'https://other.example.test',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/does not match PUBLIC_HOST/);
  });

  it('rejects a credentialed origin list that omits the public origin', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      CLIENT_URLS: 'https://other.example.test',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/CLIENT_URLS must contain the exact public origin/);
  });

  it('rejects an application URI that authenticates as the bootstrap root user', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      COMPOSE_MONGODB_URI:
        'mongodb://sigap_root:root-password-0123456789-abcdefghijk@mongo:27017/sigap_ulp_labuhan?authSource=admin',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/must authenticate as MONGO_APP_USERNAME/);
    expect(result.output).toMatch(/must not use the bootstrap root identity/);
  });

  it('rejects an application URI that uses a different database', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      COMPOSE_MONGODB_URI:
        'mongodb://sigap_app:app-password-0123456789-abcdefghijklmnop@mongo:27017/other_db?authSource=sigap_ulp_labuhan',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/must target MONGO_DATABASE/);
  });

  it('rejects a restore database that equals the source database', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      MONGO_RESTORE_DATABASE: 'sigap_ulp_labuhan',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/MONGO_RESTORE_DATABASE must differ from MONGO_DATABASE/);
  });

  it('rejects a release bundle that is missing runtime files', () => {
    const result = runScript('scripts/validate-production-release.sh', [], {
      ...BASE_ENV,
      RELEASE_DIR: makeTempDir('sigap-empty-bundle-'),
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/Release bundle is missing/);
  });

  it('rejects a release bundle whose checksum manifest does not match', () => {
    const bundleDirectory = makeTempDir('sigap-bundle-');
    const bundleFiles = [
      'docker-compose.prod.yml',
      'Caddyfile',
      'mongo/init/01-create-users.js',
      'scripts/validate-production-release.sh',
      'scripts/backup-mongodb.sh',
      'scripts/restore-mongodb.sh',
      'scripts/lib/release-common.sh',
    ];
    for (const relativePath of bundleFiles) {
      const target = path.join(bundleDirectory, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, 'placeholder\n');
    }
    fs.writeFileSync(
      path.join(bundleDirectory, 'SHA256SUMS'),
      `${'0'.repeat(64)}  docker-compose.prod.yml\n`
    );

    const result = runScript('scripts/validate-production-release.sh', ['--bundle-only'], {
      ...BASE_ENV,
      RELEASE_DIR: bundleDirectory,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/Checksum verification failed/);
  });
});
