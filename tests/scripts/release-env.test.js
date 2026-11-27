const fs = require('fs');
const path = require('path');

const { findBash, runScript, makeTempDir } = require('../helpers/bash');

const bash = findBash();
const describeIfBash = bash ? describe : describe.skip;

const CURRENT_SHA = '1111111111111111111111111111111111111111';
const PREVIOUS_SHA = '2222222222222222222222222222222222222222';

const IMAGES = {
  backend: `ghcr.io/acme/sigap/backend@sha256:${'a'.repeat(64)}`,
  frontend: `ghcr.io/acme/sigap/frontend@sha256:${'b'.repeat(64)}`,
  mongo: `docker.io/library/mongo@sha256:${'c'.repeat(64)}`,
  caddy: `docker.io/library/caddy@sha256:${'d'.repeat(64)}`,
};

const PREVIOUS_IMAGES = {
  backend: `ghcr.io/acme/sigap/backend@sha256:${'e'.repeat(64)}`,
  frontend: `ghcr.io/acme/sigap/frontend@sha256:${'f'.repeat(64)}`,
  mongo: `docker.io/library/mongo@sha256:${'0'.repeat(64)}`,
  caddy: `docker.io/library/caddy@sha256:${'1'.repeat(64)}`,
};

function readEnv(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const separator = line.indexOf('=');
    if (separator > 0) {
      values[line.slice(0, separator)] = line.slice(separator + 1);
    }
  }
  return values;
}

function writeReleaseEnv(directory, sha, images) {
  fs.mkdirSync(directory, { recursive: true });
  const content = [
    `BACKEND_IMAGE=${images.backend}`,
    `FRONTEND_IMAGE=${images.frontend}`,
    `MONGO_IMAGE=${images.mongo}`,
    `CADDY_IMAGE=${images.caddy}`,
    `SOURCE_SHA=${sha}`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(directory, '.release.env'), content);
}

function writeManifest(directory, sha, images) {
  const releaseDirectory = path.join(directory, 'releases', sha);
  fs.mkdirSync(releaseDirectory, { recursive: true });
  const manifest = {
    manifestVersion: 1,
    releaseId: `sigap-${sha.slice(0, 12)}`,
    sourceSha: sha,
    generatedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    images: {
      backend: images.backend,
      frontend: images.frontend,
      mongo: images.mongo,
      caddy: images.caddy,
    },
    bundle: { name: 'bundle.tar.gz', sha256: 'a'.repeat(64) },
    approvals: [{ role: 'release-manager', approver: 'ops-lead', approvedAt: '2026-01-01T00:00:00.000Z' }],
    exceptionSummary: { vulnerabilityExceptions: 0, licenseExceptions: 0, contractExceptions: 0 },
  };
  fs.writeFileSync(path.join(releaseDirectory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function runPrepare(deployPath, images = IMAGES) {
  return runScript(
    'scripts/prepare-release-env.sh',
    [
      '--deploy-path',
      deployPath,
      '--source-sha',
      CURRENT_SHA,
      '--backend-image',
      images.backend,
      '--frontend-image',
      images.frontend,
      '--mongo-image',
      images.mongo,
      '--caddy-image',
      images.caddy,
    ],
    {}
  );
}

describeIfBash('release environment and rollback reference', () => {
  it('records the complete four-image set in the release environment', () => {
    const deployPath = makeTempDir('sigap-release-env-');

    const result = runPrepare(deployPath);

    expect(result.status).toBe(0);

    const releaseEnv = readEnv(path.join(deployPath, '.release.env'));
    expect(releaseEnv.BACKEND_IMAGE).toBe(IMAGES.backend);
    expect(releaseEnv.FRONTEND_IMAGE).toBe(IMAGES.frontend);
    expect(releaseEnv.MONGO_IMAGE).toBe(IMAGES.mongo);
    expect(releaseEnv.CADDY_IMAGE).toBe(IMAGES.caddy);
    expect(releaseEnv.SOURCE_SHA).toBe(CURRENT_SHA);
  });

  it('records the previous four-image set as the rollback reference', () => {
    const deployPath = makeTempDir('sigap-release-env-');
    writeReleaseEnv(deployPath, PREVIOUS_SHA, PREVIOUS_IMAGES);

    const result = runPrepare(deployPath);

    expect(result.status).toBe(0);

    const rollbackEnv = readEnv(path.join(deployPath, 'rollback', `${CURRENT_SHA}.env`));
    expect(rollbackEnv.BACKEND_IMAGE).toBe(PREVIOUS_IMAGES.backend);
    expect(rollbackEnv.FRONTEND_IMAGE).toBe(PREVIOUS_IMAGES.frontend);
    // The MongoDB and Caddy references are part of the rollback reference: a
    // rollback must restore the whole approved stack, not only the
    // application images.
    expect(rollbackEnv.MONGO_IMAGE).toBe(PREVIOUS_IMAGES.mongo);
    expect(rollbackEnv.CADDY_IMAGE).toBe(PREVIOUS_IMAGES.caddy);
    expect(rollbackEnv.SOURCE_SHA).toBe(PREVIOUS_SHA);
    expect(
      fs.existsSync(path.join(deployPath, 'rollback', `${CURRENT_SHA}.no-previous-release`))
    ).toBe(false);
  });

  it('recovers the previous four-image set from the previous release manifest', () => {
    const deployPath = makeTempDir('sigap-release-env-');
    // A legacy release environment that only names the application images.
    fs.writeFileSync(
      path.join(deployPath, '.release.env'),
      [
        `BACKEND_IMAGE=${PREVIOUS_IMAGES.backend}`,
        `FRONTEND_IMAGE=${PREVIOUS_IMAGES.frontend}`,
        `SOURCE_SHA=${PREVIOUS_SHA}`,
        '',
      ].join('\n')
    );
    writeManifest(deployPath, PREVIOUS_SHA, PREVIOUS_IMAGES);

    const result = runPrepare(deployPath);

    expect(result.status).toBe(0);

    const rollbackEnv = readEnv(path.join(deployPath, 'rollback', `${CURRENT_SHA}.env`));
    expect(rollbackEnv.BACKEND_IMAGE).toBe(PREVIOUS_IMAGES.backend);
    expect(rollbackEnv.MONGO_IMAGE).toBe(PREVIOUS_IMAGES.mongo);
    expect(rollbackEnv.CADDY_IMAGE).toBe(PREVIOUS_IMAGES.caddy);
  });

  it('records the initial installation when the host never ran a release', () => {
    const deployPath = makeTempDir('sigap-release-env-');

    const result = runPrepare(deployPath);

    expect(result.status).toBe(0);

    const releaseEnv = readEnv(path.join(deployPath, '.release.env'));
    expect(releaseEnv.BACKEND_IMAGE).toBe(IMAGES.backend);
    expect(releaseEnv.MONGO_IMAGE).toBe(IMAGES.mongo);
    expect(releaseEnv.CADDY_IMAGE).toBe(IMAGES.caddy);
    expect(releaseEnv.SOURCE_SHA).toBe(CURRENT_SHA);

    // The initial installation is recorded explicitly, so that the rollout
    // can tell "no previous release" apart from "the rollback reference is
    // missing".
    expect(
      fs.existsSync(path.join(deployPath, 'rollback', `${CURRENT_SHA}.no-previous-release`))
    ).toBe(true);
    expect(fs.existsSync(path.join(deployPath, 'rollback', `${CURRENT_SHA}.env`))).toBe(false);
  });

  it('records the initial installation when only the current release manifest is on the host', () => {
    const deployPath = makeTempDir('sigap-release-env-');
    // The deployment workflow copies the release manifest of the revision
    // that is being installed to the host before it records the release
    // environment. That manifest is not a previous release.
    writeManifest(deployPath, CURRENT_SHA, IMAGES);

    const result = runPrepare(deployPath);

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/initial installation/);
    expect(
      fs.existsSync(path.join(deployPath, 'rollback', `${CURRENT_SHA}.no-previous-release`))
    ).toBe(true);
    expect(fs.existsSync(path.join(deployPath, 'rollback', `${CURRENT_SHA}.env`))).toBe(false);
  });

  it('fails closed when a previous release exists but its image set is incomplete', () => {
    const deployPath = makeTempDir('sigap-release-env-');
    // A legacy release environment that only names the application images
    // and no release manifest exists to recover the rest from.
    fs.writeFileSync(
      path.join(deployPath, '.release.env'),
      [
        `BACKEND_IMAGE=${PREVIOUS_IMAGES.backend}`,
        `FRONTEND_IMAGE=${PREVIOUS_IMAGES.frontend}`,
        `SOURCE_SHA=${PREVIOUS_SHA}`,
        '',
      ].join('\n')
    );

    const result = runPrepare(deployPath);

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/previous approved four-image set could not be resolved/);
    expect(fs.existsSync(path.join(deployPath, '.release.env'))).toBe(true);
    expect(fs.existsSync(path.join(deployPath, 'rollback', `${CURRENT_SHA}.env`))).toBe(false);
  });

  it('refuses an image that is not an exact digest reference', () => {
    const deployPath = makeTempDir('sigap-release-env-');
    writeReleaseEnv(deployPath, PREVIOUS_SHA, PREVIOUS_IMAGES);

    const result = runPrepare(deployPath, {
      ...IMAGES,
      mongo: 'docker.io/library/mongo:8.0',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/MONGO_IMAGE=.*is not an exact <repository>@sha256:<64 hex> reference/);
  });

  it('verifies that an environment file declares the complete four-image set', () => {
    const deployPath = makeTempDir('sigap-release-env-');
    writeReleaseEnv(deployPath, CURRENT_SHA, IMAGES);

    const complete = runScript(
      'scripts/prepare-release-env.sh',
      ['--verify', path.join(deployPath, '.release.env')],
      {}
    );
    expect(complete.status).toBe(0);

    fs.writeFileSync(
      path.join(deployPath, 'incomplete.env'),
      [`BACKEND_IMAGE=${IMAGES.backend}`, `FRONTEND_IMAGE=${IMAGES.frontend}`, ''].join('\n')
    );
    const incomplete = runScript(
      'scripts/prepare-release-env.sh',
      ['--verify', path.join(deployPath, 'incomplete.env')],
      {}
    );
    expect(incomplete.status).not.toBe(0);
    expect(incomplete.output).toMatch(/does not declare the complete approved image set/);
  });
});
