const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const { findBash, runScript } = require('../helpers/bash');

const bash = findBash();
const describeIfBash = bash ? describe : describe.skip;

const RESTORE_ENV = {
  MONGO_DATABASE: 'sigap_ulp_labuhan',
  MONGO_RESTORE_DATABASE: 'sigap_ulp_labuhan_restore',
  MONGO_RESTORE_USERNAME: 'sigap_restore',
  MONGO_RESTORE_PASSWORD: 'restore-password-0123456789-abcdefgh',
};

/**
 * Creates a fake `docker` executable that simulates the two Compose calls
 * the restore script makes: the mongorestore, and the collection count
 * query. It lets the reconciliation logic be tested without a Docker daemon
 * and without a MongoDB server.
 */
function createFakeDocker(_counts) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sigap-fake-docker-'));
  const dockerPath = path.join(directory, 'docker');

  const script = [
    '#!/usr/bin/env bash',
    '# Fake docker used by the restore reconciliation tests.',
    'arguments="$*"',
    'if [[ "${arguments}" == *"mongorestore"* ]]; then',
    '  cat > /dev/null',
    '  exit 0',
    'fi',
    'if [[ "${arguments}" == *"getCollectionNames"* ]]; then',
    "  printf '%b' \"${FAKE_RESTORE_COUNTS:-}\"",
    '  exit 0',
    'fi',
    'exit 0',
    '',
  ].join('\n');

  fs.writeFileSync(dockerPath, script, 'utf8');
  try {
    fs.chmodSync(dockerPath, 0o755);
  } catch (_error) {
    // On Windows the executable bit is emulated; Git Bash still honours the
    // shebang for an extensionless file.
  }

  return { directory, dockerPath };
}

function createBackupFixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sigap-reconcile-fixture-'));
  const archivePath = path.join(directory, 'mongodb-sigap_ulp_labuhan-fixture.archive.gz');
  const payload = zlib.gzipSync(Buffer.from('fixture archive content'));
  fs.writeFileSync(archivePath, payload);

  const digest = crypto.createHash('sha256').update(payload).digest('hex');
  fs.writeFileSync(`${archivePath}.sha256`, `${digest}  ${path.basename(archivePath)}\n`);
  fs.writeFileSync(
    `${archivePath}.manifest.json`,
    `${JSON.stringify(
      {
        backupId: 'fixture',
        createdAt: '2026-01-01T00:00:00Z',
        database: 'sigap_ulp_labuhan',
        archive: path.basename(archivePath),
        sha256: digest,
        gzipValidated: true,
        collectionCounts: options.collectionCounts || { transformers: 1238, customers: 68742 },
        excludedCollections: ['sessions', 'import_jobs'],
      },
      null,
      2
    )}\n`
  );

  return { directory, archivePath };
}

describeIfBash('restore collection reconciliation', () => {
  it('accepts a restore whose collections match the manifest exactly', () => {
    const fixture = createBackupFixture();
    const fake = createFakeDocker('transformers\t1238\ncustomers\t68742\n');

    const result = runScript(
      'scripts/restore-mongodb.sh',
      [fixture.archivePath],
      {
        ...RESTORE_ENV,
        PATH: `${fake.directory}${path.delimiter}${process.env.PATH}`,
        FAKE_RESTORE_COUNTS: 'transformers\t1238\ncustomers\t68742\n',
        RESTORE_LOCK_DIR: path.join(fixture.directory, 'restore.lock'),
      }
    );

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/Restore completed/);
  });

  it('rejects a restore that contains a collection the manifest does not record', () => {
    const fixture = createBackupFixture();
    const fake = createFakeDocker();

    const result = runScript(
      'scripts/restore-mongodb.sh',
      [fixture.archivePath],
      {
        ...RESTORE_ENV,
        PATH: `${fake.directory}${path.delimiter}${process.env.PATH}`,
        FAKE_RESTORE_COUNTS: 'transformers\t1238\ncustomers\t68742\nstale_leftover\t7\n',
        RESTORE_LOCK_DIR: path.join(fixture.directory, 'restore.lock'),
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/stale_leftover/);
    expect(result.output).toMatch(/is not recorded in the backup manifest/);
    expect(result.output).toMatch(/reconciliation failed/);
  });

  it('rejects a restore that is missing a collection the manifest records', () => {
    const fixture = createBackupFixture();
    const fake = createFakeDocker();

    const result = runScript(
      'scripts/restore-mongodb.sh',
      [fixture.archivePath],
      {
        ...RESTORE_ENV,
        PATH: `${fake.directory}${path.delimiter}${process.env.PATH}`,
        FAKE_RESTORE_COUNTS: 'transformers\t1238\n',
        RESTORE_LOCK_DIR: path.join(fixture.directory, 'restore.lock'),
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/customers/);
    expect(result.output).toMatch(/is missing from the restored database/);
    expect(result.output).toMatch(/reconciliation failed/);
  });

  it('rejects a restore whose document count differs from the manifest', () => {
    const fixture = createBackupFixture();
    const fake = createFakeDocker();

    const result = runScript(
      'scripts/restore-mongodb.sh',
      [fixture.archivePath],
      {
        ...RESTORE_ENV,
        PATH: `${fake.directory}${path.delimiter}${process.env.PATH}`,
        FAKE_RESTORE_COUNTS: 'transformers\t1200\ncustomers\t68742\n',
        RESTORE_LOCK_DIR: path.join(fixture.directory, 'restore.lock'),
      }
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/has 1200 documents but the manifest recorded 1238/);
    expect(result.output).toMatch(/reconciliation failed/);
  });
});
