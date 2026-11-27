const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../../backend/src/modules/auth/userModel');

const mongoUri =
  process.env.MONGODB_URI_E2E || 'mongodb://127.0.0.1:27018/sigap_ulp_labuhan_e2e';

function assertSafeE2eDatabaseUri(uri) {
  const parsed = new URL(uri);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split('/')[0];
  if (!/^sigap_ulp_labuhan_e2e(?:_[a-z0-9_-]+)?$/.test(databaseName)) {
    throw new Error(
      'MONGODB_URI_E2E wajib menunjuk database E2E terisolasi yang berakhiran _e2e.'
    );
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  if (
    !localHosts.has(parsed.hostname) &&
    process.env.ALLOW_EXTERNAL_TEST_DATABASE !== 'true'
  ) {
    throw new Error(
      `Pengujian E2E ke host ${parsed.hostname} memerlukan ALLOW_EXTERNAL_TEST_DATABASE=true.`
    );
  }
}

module.exports = async function globalSetup() {
  assertSafeE2eDatabaseUri(mongoUri);
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
  const password = crypto.randomBytes(24).toString('base64url');
  const passwordHash = await User.hashPassword(password);
  await User.findOneAndUpdate(
    { adminId: 'e2eadmin' },
    {
      $set: {
        adminId: 'e2eadmin',
        username: 'E2E Administrator',
        passwordHash,
        fullName: 'E2E Administrator',
        email: 'e2e.admin@example.test',
        role: 'superadmin',
        isActive: true,
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  process.env.E2E_ADMIN_PASSWORD = password;
  await mongoose.disconnect();
};
