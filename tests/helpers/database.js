const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let memoryServer;
let databaseUri;

function assertSafeTestDatabaseUri(uri, kind = 'test') {
  let parsed;
  try {
    parsed = new URL(uri);
  } catch (_error) {
    throw new Error(`MONGODB_URI_${kind.toUpperCase()} harus berupa URI MongoDB yang valid.`);
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '')).split('/')[0];
  const allowedNamePattern =
    kind === 'e2e'
      ? /^sigap_ulp_labuhan_e2e(?:_[a-z0-9_-]+)?$/
      : /^sigap_ulp_labuhan_test(?:_[a-z0-9_-]+)?$/;
  if (!allowedNamePattern.test(databaseName)) {
    throw new Error(
      `Database pengujian wajib memakai nama terisolasi yang diizinkan (${allowedNamePattern.source}).`
    );
  }

  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const allowExternal = process.env.ALLOW_EXTERNAL_TEST_DATABASE === 'true';
  if (!allowExternal && !localHosts.has(parsed.hostname)) {
    throw new Error(
      `Pengujian ke host MongoDB eksternal ${parsed.hostname} memerlukan ALLOW_EXTERNAL_TEST_DATABASE=true.`
    );
  }
}

async function connectTestDatabase() {
  if (mongoose.connection.readyState === 1) {
    return databaseUri || mongoose.connection.name;
  }

  databaseUri = process.env.MONGODB_URI_TEST;
  if (!databaseUri) {
    memoryServer = await MongoMemoryServer.create({
      instance: {
        dbName: 'sigap_ulp_labuhan_test',
      },
    });
    databaseUri = memoryServer.getUri('sigap_ulp_labuhan_test');
  } else {
    assertSafeTestDatabaseUri(databaseUri, 'test');
  }

  process.env.MONGODB_URI = databaseUri;
  await mongoose.connect(databaseUri, {
    serverSelectionTimeoutMS: 10000,
  });

  return databaseUri;
}

async function clearTestDatabase() {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((collection) => collection.deleteMany({})));
}

async function closeTestDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = undefined;
  }
}

module.exports = {
  clearTestDatabase,
  closeTestDatabase,
  connectTestDatabase,
};
