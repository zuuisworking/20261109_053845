const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');

const { findBash, runScript, makeTempDir } = require('../helpers/bash');

const bash = findBash();
const describeIfBash = bash ? describe : describe.skip;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_SHA = '0123456789abcdef0123456789abcdef01234567';

const IMAGES = {
  EXPECTED_GHCR_OWNER: 'acme',
  EXPECTED_GHCR_REPOSITORY: 'acme/sigap',
  BACKEND_IMAGE:
    'ghcr.io/acme/sigap/backend@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  FRONTEND_IMAGE:
    'ghcr.io/acme/sigap/frontend@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  MONGO_IMAGE:
    'docker.io/library/mongo@sha256:479e85ced54ffb8a40dade1dcde2da2a9ae858515b9415e9cc54bfb8f0575d01',
  CADDY_IMAGE:
    'docker.io/library/caddy@sha256:b4e3952384eb9524a887633ce65c752dd7c71314d2c2acf98cd5c715aaa534f0',
};

function node(args, options = {}) {
  return execFileSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...IMAGES, ...options.env },
    stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
  });
}

function opensslAvailable() {
  const result = spawnSync('openssl', ['version'], { encoding: 'utf8' });
  return result.status === 0;
}

describeIfBash('release bundle', () => {
  it('builds a complete bundle with a checksum manifest', () => {
    const outputDirectory = makeTempDir('sigap-bundle-');
    const result = runScript(
      'scripts/build-release-bundle.sh',
      ['--output', outputDirectory, '--source-sha', SOURCE_SHA],
      {}
    );

    expect(result.status).toBe(0);

    const bundleDirectory = path.join(outputDirectory, 'bundle');
    const requiredFiles = [
      'SHA256SUMS',
      'bundle-info.txt',
      'docker-compose.prod.yml',
      'Caddyfile',
      'mongo/init/01-create-users.js',
      'mongo/README.md',
      'release-manifest.schema.json',
      'scripts/validate-production-release.sh',
      'scripts/validate-release-manifest.js',
      'scripts/backup-mongodb.sh',
      'scripts/restore-mongodb.sh',
      'scripts/verify-host-image-set.sh',
      'scripts/prepare-release-env.sh',
      'scripts/lib/release-common.sh',
      'security/vulnerability-exceptions.json',
      'security/license-exceptions.json',
      'security/contract-gate-exceptions.json',
    ];

    for (const relativePath of requiredFiles) {
      expect(fs.existsSync(path.join(bundleDirectory, relativePath))).toBe(true);
    }

    const checksums = fs.readFileSync(path.join(bundleDirectory, 'SHA256SUMS'), 'utf8');
    expect(checksums).toMatch(/[0-9a-f]{64}/);
    expect(checksums).toContain('docker-compose.prod.yml');
  });

  it('rejects a source SHA that is not an exact 40 character commit SHA', () => {
    const outputDirectory = makeTempDir('sigap-bundle-');
    const result = runScript(
      'scripts/build-release-bundle.sh',
      ['--output', outputDirectory, '--source-sha', 'main'],
      {}
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/40 character lowercase commit SHA/);
  });

  it('verifies a bundle and detects a tampered file', () => {
    const outputDirectory = makeTempDir('sigap-bundle-');
    const buildResult = runScript(
      'scripts/build-release-bundle.sh',
      ['--output', outputDirectory, '--source-sha', SOURCE_SHA],
      {}
    );
    expect(buildResult.status).toBe(0);

    const bundleDirectory = path.join(outputDirectory, 'bundle');
    const verifyResult = runScript(
      'scripts/verify-release-bundle.sh',
      ['--bundle', bundleDirectory],
      {}
    );
    expect(verifyResult.status).toBe(0);
    expect(verifyResult.output).toMatch(/Checksum verification passed/);

    fs.appendFileSync(path.join(bundleDirectory, 'Caddyfile'), '# tampered\n');
    const tamperedResult = runScript(
      'scripts/verify-release-bundle.sh',
      ['--bundle', bundleDirectory],
      {}
    );
    expect(tamperedResult.status).not.toBe(0);
    expect(tamperedResult.output).toMatch(/Checksum verification failed/);
  });

  it('refuses a bundle that is missing a required file', () => {
    const outputDirectory = makeTempDir('sigap-bundle-');
    runScript('scripts/build-release-bundle.sh', ['--output', outputDirectory, '--source-sha', SOURCE_SHA], {});
    const bundleDirectory = path.join(outputDirectory, 'bundle');
    fs.unlinkSync(path.join(bundleDirectory, 'Caddyfile'));

    const result = runScript('scripts/verify-release-bundle.sh', ['--bundle', bundleDirectory], {});

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/missing Caddyfile/);
  });
});

describe('release manifest', () => {
  const workingDirectory = makeTempDir('sigap-manifest-');
  const bundleArchive = path.join(workingDirectory, 'bundle.tar.gz');
  const manifestPath = path.join(workingDirectory, 'release-manifest.json');

  beforeAll(() => {
    // The archive content is irrelevant to the manifest validator; only its
    // checksum is recorded.
    fs.writeFileSync(bundleArchive, 'release bundle fixture');
    node([
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
    ]);
  });

  it('records the source revision, the digests, the bundle checksum, and the approval', () => {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    expect(manifest.manifestVersion).toBe(1);
    expect(manifest.sourceSha).toBe(SOURCE_SHA);
    expect(manifest.images.backend).toBe(IMAGES.BACKEND_IMAGE);
    expect(manifest.bundle.sha256).toBe(
      crypto.createHash('sha256').update(fs.readFileSync(bundleArchive)).digest('hex')
    );
    expect(manifest.approvals[0].approver).toBe('ops-lead');
    expect(manifest.approvals[0].role).toBe('release-manager');
    expect(manifest.exceptionSummary.vulnerabilityExceptions).toBeGreaterThanOrEqual(0);
  });

  it('validates a valid manifest', () => {
    const output = node([
      path.join(REPO_ROOT, 'scripts', 'validate-release-manifest.js'),
      '--manifest',
      manifestPath,
    ]);

    expect(output).toMatch(/Release manifest is valid/);
  });

  it('rejects a manifest whose image is a mutable tag', () => {
    const taggedManifestPath = path.join(workingDirectory, 'tagged-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.images.backend = 'ghcr.io/acme/sigap/backend:latest';
    fs.writeFileSync(taggedManifestPath, JSON.stringify(manifest, null, 2));

    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'validate-release-manifest.js'), '--manifest', taggedManifestPath],
      { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, ...IMAGES } }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/exact <repository>@sha256:<64 hex> reference/);
  });

  it('rejects a manifest with a future approval timestamp', () => {
    const futureManifestPath = path.join(workingDirectory, 'future-manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.approvals[0].approvedAt = '2099-01-01T00:00:00Z';
    fs.writeFileSync(futureManifestPath, JSON.stringify(manifest, null, 2));

    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'validate-release-manifest.js'), '--manifest', futureManifestPath],
      { cwd: REPO_ROOT, encoding: 'utf8', env: { ...process.env, ...IMAGES } }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/approval timestamp is in the future/);
  });

  it('rejects a manifest whose bundle checksum does not match the archive', () => {
    const otherArchive = path.join(workingDirectory, 'other-bundle.tar.gz');
    fs.writeFileSync(otherArchive, 'a different bundle');

    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'validate-release-manifest.js'), '--manifest', manifestPath],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...IMAGES, BUNDLE_ARCHIVE: otherArchive },
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/does not match the checksum of the supplied release bundle/);
  });

  it('fails closed when a signature is required but not supplied', () => {
    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'validate-release-manifest.js'), '--manifest', manifestPath],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: { ...process.env, ...IMAGES, REQUIRE_RELEASE_MANIFEST_SIGNATURE: 'true' },
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/a signed release manifest is required/);
  });

  it('signs and verifies a manifest, and detects a tampered manifest', () => {
    if (!opensslAvailable()) {
      return;
    }

    const keyPath = path.join(workingDirectory, 'manifest.key');
    const publicKeyPath = path.join(workingDirectory, 'manifest.pub');
    const signedManifestPath = path.join(workingDirectory, 'signed-manifest.json');

    const keyResult = spawnSync('openssl', ['genpkey', '-algorithm', 'ED25519', '-out', keyPath], {
      encoding: 'utf8',
    });
    expect(keyResult.status).toBe(0);

    const publicKeyResult = spawnSync(
      'openssl',
      ['pkey', '-in', keyPath, '-pubout', '-out', publicKeyPath],
      { encoding: 'utf8' }
    );
    expect(publicKeyResult.status).toBe(0);

    node([
      path.join(REPO_ROOT, 'scripts', 'create-release-manifest.js'),
      '--output',
      signedManifestPath,
      '--source-sha',
      SOURCE_SHA,
      '--bundle',
      bundleArchive,
      '--approver',
      'ops-lead',
      '--approved-at',
      '2026-01-01T00:00:00Z',
      '--sign',
      keyPath,
    ]);

    expect(fs.existsSync(`${signedManifestPath}.sig`)).toBe(true);

    const signaturePath = `${signedManifestPath}.sig`;
    const verifyResult = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'validate-release-manifest.js'), '--manifest', signedManifestPath],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...IMAGES,
          RELEASE_MANIFEST_SIGNATURE: signaturePath,
          RELEASE_MANIFEST_PUBLIC_KEY: publicKeyPath,
          REQUIRE_RELEASE_MANIFEST_SIGNATURE: 'true',
        },
      }
    );

    expect(verifyResult.status).toBe(0);
    expect(verifyResult.stdout).toMatch(/signature verified/);

    fs.appendFileSync(signedManifestPath, '\n');
    const tamperedResult = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'validate-release-manifest.js'), '--manifest', signedManifestPath],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
          ...process.env,
          ...IMAGES,
          RELEASE_MANIFEST_SIGNATURE: signaturePath,
          RELEASE_MANIFEST_PUBLIC_KEY: publicKeyPath,
          REQUIRE_RELEASE_MANIFEST_SIGNATURE: 'true',
        },
      }
    );

    expect(tamperedResult.status).not.toBe(0);
    expect(tamperedResult.stderr).toMatch(/signature could not be verified/);
  });
});
