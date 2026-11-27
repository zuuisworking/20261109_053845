const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { findBash, runScript } = require('../helpers/bash');
const { extractUses, readRegistry } = require('../../scripts/check-action-pins');

const bash = findBash();
const describeIfBash = bash ? describe : describe.skip;

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW_DIRECTORY = path.join(REPO_ROOT, '.github', 'workflows');

describe('GitHub Action pin gate', () => {
  it('accepts the repository workflows and the pin registry', () => {
    const output = execFileSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'check-action-pins.js')],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );

    expect(output).toMatch(/Action pin gate passed/);
  });

  it('records every pinned action in the registry with an exact commit SHA', () => {
    const registry = readRegistry();
    const actions = [...registry.keys()];

    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(registry.get(action).sha).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  it('pins every action use in every workflow to the registered commit', () => {
    const registry = readRegistry();

    for (const fileName of fs.readdirSync(WORKFLOW_DIRECTORY)) {
      if (!fileName.endsWith('.yml') && !fileName.endsWith('.yaml')) {
        continue;
      }
      const source = fs.readFileSync(path.join(WORKFLOW_DIRECTORY, fileName), 'utf8');

      for (const reference of extractUses(source)) {
        const separator = reference.lastIndexOf('@');
        expect(separator).toBeGreaterThan(-1);

        const action = reference.slice(0, separator);
        const ref = reference.slice(separator + 1);

        expect(ref).toMatch(/^[0-9a-f]{40}$/);
        expect(registry.has(action)).toBe(true);
        expect(registry.get(action).sha).toBe(ref);
      }
    }
  });

  it('resolves the pinned setup-node commit against the upstream repository', () => {
    // The upstream API is queried so that a mistyped or non-existent commit
    // is detected. A rate-limited or unreachable API is not a failure.
    const result = spawnSync(
      process.execPath,
      [path.join(REPO_ROOT, 'scripts', 'check-action-pins.js'), '--verify-remote', '--allow-unavailable'],
      { cwd: REPO_ROOT, encoding: 'utf8' }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Action pin gate passed/);
  });

  it('rejects a workflow that pins an unregistered commit', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sigap-pins-'));
    const workflowFile = path.join(directory, 'workflow.yml');
    fs.writeFileSync(
      workflowFile,
      ['name: test', 'jobs:', '  test:', '    runs-on: ubuntu-latest', '    steps:', '      - uses: actions/checkout@0000000000000000000000000000000000000000', ''].join('\n')
    );

    const { extractUses: extract } = require('../../scripts/check-action-pins');
    const references = extract(fs.readFileSync(workflowFile, 'utf8'));

    expect(references).toEqual([
      'actions/checkout@0000000000000000000000000000000000000000',
    ]);
    // The registered SHA for actions/checkout is different, so the gate would
    // reject it.
    const registry = readRegistry();
    expect(registry.get('actions/checkout').sha).not.toBe(
      '0000000000000000000000000000000000000000'
    );
  });
});

describeIfBash('host image set verification', () => {
  const DIGEST_A = 'a'.repeat(64);
  const DIGEST_B = 'b'.repeat(64);
  const DIGEST_C = 'c'.repeat(64);
  const DIGEST_D = 'd'.repeat(64);

  const COMPOSE_FILE = path.join('deploy', 'docker-compose.prod.yml');

  function buildEnvironment(overrides = {}) {
    return {
      BACKEND_IMAGE: `ghcr.io/acme/sigap/backend@sha256:${DIGEST_A}`,
      FRONTEND_IMAGE: `ghcr.io/acme/sigap/frontend@sha256:${DIGEST_B}`,
      MONGO_IMAGE: `docker.io/library/mongo@sha256:${DIGEST_C}`,
      CADDY_IMAGE: `docker.io/library/caddy@sha256:${DIGEST_D}`,
      PUBLIC_APP_URL: 'https://app.example.test',
      PUBLIC_HOST: 'app.example.test',
      CLIENT_URLS: 'https://app.example.test',
      ACME_EMAIL: 'ops@example.test',
      SESSION_SECRET: 'session-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
      MONGO_DATABASE: 'sigap_ulp_labuhan',
      MONGO_RESTORE_DATABASE: 'sigap_ulp_labuhan_restore',
      MONGO_ROOT_USERNAME: 'sigap_root',
      MONGO_ROOT_PASSWORD: 'root-password-0123456789-abcdefghijklmnopqrstuvwxyz',
      MONGO_APP_USERNAME: 'sigap_app',
      MONGO_APP_PASSWORD: 'app-password-0123456789-abcdefghijklmnopqrstuvwxyz',
      MONGO_BACKUP_USERNAME: 'sigap_backup',
      MONGO_BACKUP_PASSWORD: 'backup-password-0123456789-abcdefghijklmnopqrstuvwxyz',
      MONGO_RESTORE_USERNAME: 'sigap_restore',
      MONGO_RESTORE_PASSWORD: 'restore-password-0123456789-abcdefghijklmnopqrstuvwxyz',
      COMPOSE_MONGODB_URI:
        'mongodb://sigap_app:app-password-0123456789-abcdefghijklmnopqrstuvwxyz@mongo:27017/sigap_ulp_labuhan?authSource=sigap_ulp_labuhan',
      ...overrides,
    };
  }

  /**
   * Writes the host environment files the way the deployment host holds them.
   * The image references live in the files, not in the ambient environment.
   */
  function writeHostEnvironment(images) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sigap-host-image-set-'));
    const releaseEnvPath = path.join(directory, '.release.env');
    const hostEnvPath = path.join(directory, '.env');

    fs.writeFileSync(
      releaseEnvPath,
      [
        `BACKEND_IMAGE=${images.BACKEND_IMAGE}`,
        `FRONTEND_IMAGE=${images.FRONTEND_IMAGE}`,
        `MONGO_IMAGE=${images.MONGO_IMAGE}`,
        `CADDY_IMAGE=${images.CADDY_IMAGE}`,
        'SOURCE_SHA=0123456789abcdef0123456789abcdef01234567',
        '',
      ].join('\n')
    );
    // The host .env carries the operational values, not the image set.
    fs.writeFileSync(
      hostEnvPath,
      [
        'PUBLIC_APP_URL=https://app.example.test',
        'PUBLIC_HOST=app.example.test',
        'CLIENT_URLS=https://app.example.test',
        'ACME_EMAIL=ops@example.test',
        'SESSION_SECRET=session-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
        'MONGO_DATABASE=sigap_ulp_labuhan',
        'MONGO_RESTORE_DATABASE=sigap_ulp_labuhan_restore',
        'MONGO_ROOT_USERNAME=sigap_root',
        'MONGO_ROOT_PASSWORD=root-password-0123456789-abcdefghijklmnopqrstuvwxyz',
        'MONGO_APP_USERNAME=sigap_app',
        'MONGO_APP_PASSWORD=app-password-0123456789-abcdefghijklmnopqrstuvwxyz',
        'MONGO_BACKUP_USERNAME=sigap_backup',
        'MONGO_BACKUP_PASSWORD=backup-password-0123456789-abcdefghijklmnopqrstuvwxyz',
        'MONGO_RESTORE_USERNAME=sigap_restore',
        'MONGO_RESTORE_PASSWORD=restore-password-0123456789-abcdefghijklmnopqrstuvwxyz',
        'COMPOSE_MONGODB_URI=mongodb://sigap_app:app-password-0123456789-abcdefghijklmnopqrstuvwxyz@mongo:27017/sigap_ulp_labuhan?authSource=sigap_ulp_labuhan',
        '',
      ].join('\n')
    );

    return { releaseEnvPath, hostEnvPath, directory };
  }

  function expectedArguments(env) {
    return [
      '--expected',
      env.BACKEND_IMAGE,
      '--expected',
      env.FRONTEND_IMAGE,
      '--expected',
      env.MONGO_IMAGE,
      '--expected',
      env.CADDY_IMAGE,
    ];
  }

  it('accepts a host whose effective image set is exactly the approved set', () => {
    const env = buildEnvironment();
    const host = writeHostEnvironment(env);

    const result = runScript(
      'scripts/verify-host-image-set.sh',
      [
        '--compose-file',
        COMPOSE_FILE,
        '--env-file',
        host.hostEnvPath,
        '--env-file',
        host.releaseEnvPath,
        ...expectedArguments(env),
      ],
      buildEnvironment()
    );

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/exactly the approved image set/);
  });

  it('rejects a host whose MongoDB image drifted from the approved digest', () => {
    const env = buildEnvironment();
    const drifted = `docker.io/library/mongo@sha256:${'e'.repeat(64)}`;
    const host = writeHostEnvironment({ ...env, MONGO_IMAGE: drifted });

    const result = runScript(
      'scripts/verify-host-image-set.sh',
      [
        '--compose-file',
        COMPOSE_FILE,
        '--env-file',
        host.hostEnvPath,
        '--env-file',
        host.releaseEnvPath,
        ...expectedArguments(env),
      ],
      buildEnvironment()
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/differs from the approved image set/);
  });

  it('ignores an ambient image variable that the environment files do not declare', () => {
    // Docker Compose gives the process environment a higher precedence than
    // an --env-file value. An ambient MONGO_IMAGE in the host shell profile
    // would otherwise override the approved reference and deploy an image
    // that was never approved.
    const env = buildEnvironment();
    const host = writeHostEnvironment(env);
    const ambientDrift = `docker.io/library/mongo@sha256:${'9'.repeat(64)}`;

    const result = runScript(
      'scripts/verify-host-image-set.sh',
      [
        '--compose-file',
        COMPOSE_FILE,
        '--env-file',
        host.hostEnvPath,
        '--env-file',
        host.releaseEnvPath,
        ...expectedArguments(env),
      ],
      buildEnvironment({ MONGO_IMAGE: ambientDrift })
    );

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/exactly the approved image set/);
    expect(result.output).not.toContain(ambientDrift);
  });

  it('requires the environment files that declare the effective image set', () => {
    const env = buildEnvironment();
    const result = runScript(
      'scripts/verify-host-image-set.sh',
      ['--compose-file', COMPOSE_FILE, ...expectedArguments(env)],
      env
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/At least one --env-file <file> is required/);
  });

  it('rejects an expected image that is not an exact digest reference', () => {
    const env = buildEnvironment();
    const host = writeHostEnvironment(env);
    const result = runScript(
      'scripts/verify-host-image-set.sh',
      [
        '--compose-file',
        COMPOSE_FILE,
        '--env-file',
        host.hostEnvPath,
        '--env-file',
        host.releaseEnvPath,
        '--expected',
        'ghcr.io/acme/sigap/backend:latest',
      ],
      buildEnvironment()
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/is not an exact <repository>@sha256:<64 hex> reference/);
  });

  it('requires at least one expected image', () => {
    const env = buildEnvironment();
    const host = writeHostEnvironment(env);
    const result = runScript(
      'scripts/verify-host-image-set.sh',
      [
        '--compose-file',
        COMPOSE_FILE,
        '--env-file',
        host.hostEnvPath,
        '--env-file',
        host.releaseEnvPath,
      ],
      env
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/At least one --expected <image> is required/);
  });
});
