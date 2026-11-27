/* eslint-env mongosh */
/* global process, db */

// MongoDB initialisation for the SIGAP production deployment.
//
// IMPORTANT: this script runs only while MongoDB initialises an empty data
// directory. It does not run again for an existing volume. Changing this file
// therefore has no effect on a running deployment: the existing identities and
// roles must be reconciled by a separately approved migration job that is
// reviewed and executed on purpose. See deploy/mongo/README.md.
//
// The built-in `backup` and `restore` roles are cluster level roles. Assigning
// them with `db: <application database>` is invalid and makes user creation
// fail. This script therefore creates two custom roles whose privileges are
// scoped to exactly the databases they need:
//
//   sigapBackupRole  - read only access to the application database;
//   sigapRestoreRole - restore access to the isolated restore database.
//
// The roles are stored in the `admin` database because a role may only carry
// privileges for resources outside its own database when it is stored there.
// The users themselves are created in the database that owns their identity so
// that the authentication database stays predictable:
// the backup user authenticates against the application database and the
// restore user against the isolated restore database.

const databaseName = process.env.MONGO_DATABASE || 'sigap_ulp_labuhan';
const restoreDatabaseName = process.env.MONGO_RESTORE_DATABASE || `${databaseName}_restore`;
const rootUsername = String(process.env.MONGO_INITDB_ROOT_USERNAME || '').trim();

const adminDatabase = db.getSiblingDB('admin');
const targetDatabase = db.getSiblingDB(databaseName);
const restoreDatabase = db.getSiblingDB(restoreDatabaseName);

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`${name} is required during MongoDB initialization.`);
  }
  return value;
}

function assertDistinct(values) {
  const seen = new Map();
  for (const [name, value] of values) {
    if (seen.has(value)) {
      throw new Error(
        `${name} must differ from ${seen.get(value)}; duplicate MongoDB identities are rejected.`
      );
    }
    seen.set(value, name);
  }
}

const appUsername = required('MONGO_APP_USERNAME');
const appPassword = required('MONGO_APP_PASSWORD');
const backupUsername = required('MONGO_BACKUP_USERNAME');
const backupPassword = required('MONGO_BACKUP_PASSWORD');
const restoreUsername = required('MONGO_RESTORE_USERNAME');
const restorePassword = required('MONGO_RESTORE_PASSWORD');

if (restoreDatabaseName === databaseName) {
  throw new Error(
    `MONGO_RESTORE_DATABASE ('${restoreDatabaseName}') must differ from MONGO_DATABASE ('${databaseName}').`
  );
}

assertDistinct([
  ['MONGO_APP_USERNAME', appUsername],
  ['MONGO_BACKUP_USERNAME', backupUsername],
  ['MONGO_RESTORE_USERNAME', restoreUsername],
]);

if (rootUsername) {
  assertDistinct([
    ['MONGO_INITDB_ROOT_USERNAME', rootUsername],
    ['MONGO_APP_USERNAME', appUsername],
    ['MONGO_BACKUP_USERNAME', backupUsername],
    ['MONGO_RESTORE_USERNAME', restoreUsername],
  ]);
}

const backupRoleName = 'sigapBackupRole';
const restoreRoleName = 'sigapRestoreRole';

const readPrivileges = ['find', 'listCollections', 'listIndexes', 'collStats', 'dbStats'];
const restorePrivileges = [
  // `restore` is a role name, not a MongoDB privilege action. Supplying it
  // in a privilege set makes MongoDB reject the whole role. These are the
  // database-scoped actions used by mongorestore for the archive format
  // produced by scripts/backup-mongodb.sh, plus the read/drop actions used
  // by restore reconciliation and rehearsal cleanup.
  'bypassDocumentValidation',
  'collMod',
  'convertToCapped',
  'createCollection',
  'createIndex',
  'createSearchIndexes',
  'dropCollection',
  'dropDatabase',
  'find',
  'insert',
  'listCollections',
  'listIndexes',
  'collStats',
  'dbStats',
  'updateSearchIndex',
];

function upsertRole(roleName, privileges, roles) {
  const existing = adminDatabase.getRole(roleName);
  if (existing) {
    adminDatabase.updateRole(roleName, { privileges, roles });
    print(`Updated custom role ${roleName}.`);
    return;
  }
  adminDatabase.createRole({ role: roleName, privileges, roles });
  print(`Created custom role ${roleName}.`);
}

function upsertUser(database, username, password, roles) {
  const existing = database.getUser(username);
  if (existing) {
    database.updateUser(username, { pwd: password, roles });
    print(`Updated MongoDB user ${username} in ${database.getName()}.`);
    return;
  }
  database.createUser({ user: username, pwd: password, roles });
  print(`Created MongoDB user ${username} in ${database.getName()}.`);
}

upsertRole(
  backupRoleName,
  [{ resource: { db: databaseName, collection: '' }, actions: readPrivileges }],
  []
);

upsertRole(
  restoreRoleName,
  [
    { resource: { db: restoreDatabaseName, collection: '' }, actions: restorePrivileges },
  ],
  []
);

upsertUser(targetDatabase, appUsername, appPassword, [{ role: 'readWrite', db: databaseName }]);
upsertUser(targetDatabase, backupUsername, backupPassword, [{ role: backupRoleName, db: 'admin' }]);
upsertUser(restoreDatabase, restoreUsername, restorePassword, [
  { role: restoreRoleName, db: 'admin' },
]);

print(
  `MongoDB identities created for '${databaseName}' and '${restoreDatabaseName}'. ` +
    'The bootstrap root credential remains valid until it is revoked; see deploy/mongo/README.md.'
);
