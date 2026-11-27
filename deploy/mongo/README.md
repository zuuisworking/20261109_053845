# MongoDB deployment notes

This directory contains the MongoDB initialisation script used by
`deploy/docker-compose.prod.yml` and the operational notes that an operator
must follow. The statements below describe what the repository implements and
what it does not.

## 1. What the initialisation script does

`init/01-create-users.js` runs inside `mongosh` while the official MongoDB
image initialises an **empty** data directory. It:

1. creates the custom role `sigapBackupRole` in the `admin` database with read
   privileges that are scoped to the application database only;
2. creates the custom role `sigapRestoreRole` in the `admin` database with
   database-scoped insert, create, read, and drop privileges used by
   `mongorestore` against the isolated restore database only;
3. creates the application user in the application database with the built-in
   `readWrite` role for that database;
4. creates the backup user in the application database with the custom backup
   role;
5. creates the restore user in the isolated restore database with the custom
   restore role;
6. refuses to continue when the restore database equals the application
   database, when two operational identities share a user name, or when an
   operational identity reuses the bootstrap root name.

The built-in `backup` and `restore` roles are **cluster level** roles. The
previous version of this script assigned them with `db: <application
database>`, which MongoDB rejects. The custom roles above replace that
assignment and keep every privilege scoped to the databases that need it.
`restore` is a role name, not a privilege action; the custom restore role
therefore lists the concrete database-scoped actions needed by `mongorestore`
(and by the reconciliation/cleanup queries) instead of the invalid action
`restore`.

Authentication databases:

| Identity | Created in | Authenticates against | Effective privileges |
|---|---|---|---|
| `MONGO_APP_USERNAME` | application database | application database | `readWrite` on the application database |
| `MONGO_BACKUP_USERNAME` | application database | application database | read only on the application database |
| `MONGO_RESTORE_USERNAME` | restore database | restore database | restore, create, and drop on the restore database only |

## 2. The initialisation script does not run again

`/docker-entrypoint-initdb.d` is executed **only** when the MongoDB data
directory is empty. Restarting the container, pulling a new image, or
re-running Compose never re-executes the script.

Therefore:

- editing this script has **no effect** on an existing deployment;
- a production database that was initialised with an earlier version of the
  script keeps the old, invalid or overly broad role assignments;
- the backup and restore identities of an existing deployment must be
  reconciled by a **separately approved reconciliation job**.

The reconciliation job is not part of this repository because it changes live
credentials and roles. It must be reviewed and approved on its own, and it
must:

1. create the two custom roles with exactly the privileges listed above;
2. reassign the backup and restore users to those roles;
3. verify that the backup user cannot write and that the restore user cannot
   write to the application database;
4. record the before/after role assignment in the release evidence.

Until that job has run, the backup and restore identities of an existing
volume are **not** the identities described in section 1.

## 3. Bootstrap root behaviour and revocation

The Compose file requires `MONGO_ROOT_USERNAME` and `MONGO_ROOT_PASSWORD`.
Those values are consumed by the MongoDB image only while it initialises an
empty data directory:

- on a **fresh** volume the image creates a root user in the `admin` database
  with the supplied password;
- on an **existing** volume the variables are ignored; the stored root user
  keeps the password it was created with.

The root credential is never given to the backend, the frontend, the backup
script, or the restore script.

Revocation procedure (break-glass, operator executed):

1. Create a dedicated administrative identity with a reviewed process:
   `db.getSiblingDB('admin').createUser({user: '<admin>', pwd: '<random>', roles: [{role: 'root', db: 'admin'}]})`.
2. Revoke the bootstrap root identity:
   `db.getSiblingDB('admin').updateUser('<bootstrap-root>', {roles: []})`, then
   `db.getSiblingDB('admin').dropUser('<bootstrap-root>')`.
3. Verify that the bootstrap credential can no longer authenticate:
   `mongosh --username '<bootstrap-root>' --password '<old-password>' --authenticationDatabase admin --eval 'db.runCommand({ping:1})'`
   must fail.
4. Keep `MONGO_ROOT_USERNAME` and `MONGO_ROOT_PASSWORD` set in the Compose
   environment file to a freshly generated random value that is stored nowhere
   else. The values are not used by an existing volume; they only guarantee
   that a future fresh volume never starts with a known credential. The
   release validator still rejects short or placeholder values for them.
5. Record the revocation evidence (timestamp, the command output, and the
   approving operator) in the release record.

Revoking the bootstrap user is **not** performed automatically by this
repository.

## 4. Related repository files

| File | Purpose |
|---|---|
| `init/01-create-users.js` | Identity and role creation for a fresh volume |
| `../docker-compose.prod.yml` | Production topology, MongoDB service definition |
| `../../scripts/backup-mongodb.sh` | Backup with the scoped backup identity |
| `../../scripts/restore-mongodb.sh` | Restore into the isolated restore database |
| `../../scripts/validate-production-release.sh` | Release preflight, including the identity checks |
| `../../docs/operations/backup-restore.md` | Backup, restore, and rehearsal runbook |
