const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const { findBash, runScript, makeTempDir } = require('../helpers/bash');

const bash = findBash();
const describeIfBash = bash ? describe : describe.skip;

const RESTORE_ENV = {
  MONGO_DATABASE: 'sigap_ulp_labuhan',
  MONGO_RESTORE_DATABASE: 'sigap_ulp_labuhan_restore',
  MONGO_RESTORE_USERNAME: 'sigap_restore',
  MONGO_RESTORE_PASSWORD: 'restore-password-0123456789-abcdefgh',
  MONGO_BACKUP_USERNAME: 'sigap_backup',
  MONGO_BACKUP_PASSWORD: 'backup-password-0123456789-abcdefghi',
  MONGO_ROOT_USERNAME: 'sigap_root',
  MONGO_ROOT_PASSWORD: 'root-password-0123456789-abcdefghijk',
};

function createBackupFixture(options = {}) {
  const directory = makeTempDir('sigap-restore-fixture-');
  const archivePath = path.join(directory, 'mongodb-sigap_ulp_labuhan-fixture.archive.gz');
  const payload = options.corruptGzip
    ? Buffer.from('fixture archive content')
    : zlib.gzipSync(Buffer.from('fixture archive content'));
  fs.writeFileSync(archivePath, payload);

  if (options.withIntegrity !== false) {
    const digest = crypto.createHash('sha256').update(payload).digest('hex');
    fs.writeFileSync(`${archivePath}.sha256`, `${digest}  ${path.basename(archivePath)}\n`);
    fs.writeFileSync(
      `${archivePath}.manifest.json`,
      `${JSON.stringify(
        {
          backupId: 'fixture',
          createdAt: '2026-01-01T00:00:00Z',
          database: options.database || 'sigap_ulp_labuhan',
          archive: path.basename(archivePath),
          sha256: digest,
          gzipValidated: true,
          collectionCounts: { transformers: 1238, customers: 68742 },
          excludedCollections: ['sessions'],
        },
        null,
        2
      )}\n`
    );
  }

  return { directory, archivePath };
}

describeIfBash('backup guards', () => {
  it('refuses the bootstrap root identity', () => {
    const result = runScript('scripts/backup-mongodb.sh', ['--dry-run'], {
      ...RESTORE_ENV,
      MONGO_BACKUP_USERNAME: 'sigap_root',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/must not be the bootstrap root user/);
  });

  it('refuses the bootstrap root password', () => {
    const result = runScript('scripts/backup-mongodb.sh', ['--dry-run'], {
      ...RESTORE_ENV,
      MONGO_BACKUP_PASSWORD: 'root-password-0123456789-abcdefghijk',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/must not use the bootstrap root password/);
  });

  it('requires the scoped backup identity', () => {
    const result = runScript('scripts/backup-mongodb.sh', ['--dry-run'], {
      MONGO_DATABASE: 'sigap_ulp_labuhan',
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/MONGO_BACKUP_USERNAME is required/);
  });

  it('reports the planned archive and excluded collections in dry-run mode', () => {
    const outputDirectory = makeTempDir('sigap-backup-dry-run-');
    const result = runScript('scripts/backup-mongodb.sh', ['--dry-run', '--output-dir', outputDirectory], {
      ...RESTORE_ENV,
    });

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/Dry run/);
    expect(result.output).toMatch(/mongodb-sigap_ulp_labuhan/);    expect(result.output).toMatch(/sessions/);
  });

  it('filters the collection count query with exactly the excluded collection list', () => {
    const outputDirectory = makeTempDir('sigap-backup-dry-run-');
    const result = runScript('scripts/backup-mongodb.sh', ['--dry-run', '--output-dir', outputDirectory], {
      ...RESTORE_ENV,
    });

    expect(result.status).toBe(0);

    // The count command must carry the excluded list, so that the manifest
    // describes the archive contents and the restore reconciliation does not
    // expect collections that the dump never contained.
    expect(result.output).toMatch(/EXCLUDED_COLLECTIONS_JSON=/);
    expect(result.output).toMatch(
      /excluded collections JSON: \["sessions","import_jobs","import_job_records","import_job_issues","import_job_sources"\]/
    );
    expect(result.output).toMatch(/excluded\.indexOf\(name\)/);
    expect(result.output).toMatch(
      /the count query filters exactly those excluded collections/
    );

    // The dump command representation carries exactly the same list, so the
    // archive and the count query can never describe different collections.
    const dumpLine = result.output
      .split('\n')
      .find((line) => line.includes('dump command would be:'));
    expect(dumpLine).toBeDefined();
    for (const collection of [
      'sessions',
      'import_jobs',
      'import_job_records',
      'import_job_issues',
      'import_job_sources',
    ]) {
      expect(dumpLine).toMatch(new RegExp(`--excludeCollection\\\\?\\s+${collection}`));
    }
  });

  it('uses a unique archive name so two backups in the same second cannot collide', () => {
    const outputDirectory = makeTempDir('sigap-backup-dry-run-');
    const first = runScript('scripts/backup-mongodb.sh', ['--dry-run', '--output-dir', outputDirectory], {
      ...RESTORE_ENV,
    });
    const second = runScript('scripts/backup-mongodb.sh', ['--dry-run', '--output-dir', outputDirectory], {
      ...RESTORE_ENV,
    });

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);

    const archivePattern = /mongodb-sigap_ulp_labuhan-(\S+)\.archive\.gz/;
    const firstName = first.output.match(archivePattern);
    const secondName = second.output.match(archivePattern);

    expect(firstName).not.toBeNull();
    expect(secondName).not.toBeNull();

    // The name must carry a run token in addition to the second-granularity
    // timestamp, so two runs cannot produce the same file name.
    expect(firstName[1]).not.toBe(secondName[1]);
    expect(firstName[1]).toMatch(/^[0-9]{8}T[0-9]{6}Z-/);
  });
});

describeIfBash('restore guards', () => {
  it('refuses an archive without integrity metadata', () => {
    const fixture = createBackupFixture({ withIntegrity: false });
    const result = runScript('scripts/restore-mongodb.sh', [fixture.archivePath, '--dry-run'], {
      ...RESTORE_ENV,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/Backup integrity metadata is missing/);
  });

  it('refuses a checksum mismatch', () => {
    const fixture = createBackupFixture();
    fs.appendFileSync(fixture.archivePath, 'tampered');

    const result = runScript('scripts/restore-mongodb.sh', [fixture.archivePath, '--dry-run'], {
      ...RESTORE_ENV,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/checksum verification failed/);
  });

  it('refuses an archive that is not a valid gzip stream', () => {
    const fixture = createBackupFixture({ corruptGzip: true });

    const result = runScript('scripts/restore-mongodb.sh', [fixture.archivePath, '--dry-run'], {
      ...RESTORE_ENV,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/not a valid gzip stream/);
  });

  it('refuses a production restore without the break-glass flags', () => {
    const fixture = createBackupFixture();
    const result = runScript(
      'scripts/restore-mongodb.sh',
      [fixture.archivePath, '--target', 'sigap_ulp_labuhan', '--dry-run'],
      { ...RESTORE_ENV }
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/Production restore refused/);
  });

  it('refuses a production restore rehearsal', () => {
    const fixture = createBackupFixture();
    const result = runScript(
      'scripts/restore-mongodb.sh',
      [fixture.archivePath, '--target', 'sigap_ulp_labuhan', '--rehearsal', '--dry-run'],
      { ...RESTORE_ENV, ALLOW_PRODUCTION_RESTORE: 'true' }
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/rehearsal must never target the production database/);
  });

  it('refuses a target outside the approved restore databases', () => {
    const fixture = createBackupFixture();
    const result = runScript(
      'scripts/restore-mongodb.sh',
      [fixture.archivePath, '--target', 'some_other_database', '--dry-run'],
      { ...RESTORE_ENV }
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/outside the approved targets/);
  });

  it('refuses a manifest whose database does not match the source database', () => {
    const fixture = createBackupFixture({ database: 'other_database' });
    const result = runScript('scripts/restore-mongodb.sh', [fixture.archivePath, '--dry-run'], {
      ...RESTORE_ENV,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/does not match the configured source database/);
  });

  it('defaults to the isolated restore database', () => {
    const fixture = createBackupFixture();
    const result = runScript('scripts/restore-mongodb.sh', [fixture.archivePath, '--dry-run'], {
      ...RESTORE_ENV,
    });

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/would be restored into sigap_ulp_labuhan_restore/);
    expect(result.output).toMatch(/production restore: false/);
  });

  it('supports an explicitly isolated restore rehearsal', () => {
    const fixture = createBackupFixture();
    const result = runScript('scripts/restore-mongodb.sh', [fixture.archivePath, '--rehearsal', '--dry-run'], {
      ...RESTORE_ENV,
    });

    expect(result.status).toBe(0);
    expect(result.output).toMatch(/rehearsal: true/);
    expect(result.output).toMatch(/transformers = 1238/);
    expect(result.output).toMatch(/customers = 68742/);
  });
});
