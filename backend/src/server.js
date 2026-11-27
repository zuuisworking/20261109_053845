const app = require('./app');
const config = require('./config');
const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('./database/connection');
const importService = require('./modules/imports/importService');
const Transformer = require('./modules/transformers/transformerModel');
const {
  analyzeTransformerNameKeys,
  assertTransformerIdentityReady,
} = require('./database/transformerNameKeyMigration');

let server;

function transformerCollection() {
  const collectionName = Transformer.collection?.collectionName || 'transformers';
  return mongoose.connection.db.collection(collectionName);
}

/**
 * The unique nameKey index protects transformer identity. Mongoose builds
 * indexes in the background and swallows index failures, so an unmigrated
 * legacy volume could start without any uniqueness protection at all.
 * Production therefore verifies the identity contract and the index before
 * the service accepts traffic.
 */
async function prepareTransformerIdentity() {
  const collection = transformerCollection();

  if (!config.isProduction) {
    const analysis = await analyzeTransformerNameKeys(collection);
    if (analysis.pendingUpdates > 0 || analysis.duplicateKeys.length > 0) {
      console.warn(
        '[Database] Transformer nameKey identity is not canonical in this environment.',
        {
          pendingUpdates: analysis.pendingUpdates,
          duplicateKeys: analysis.duplicateKeys.length,
        },
      );
    }
    return analysis;
  }

  const result = await assertTransformerIdentityReady(collection);
  console.log('[Database] Transformer nameKey identity verified.', {
    transformers: result.analysis.total,
    uniqueNameKeyIndex: true,
    createdIndex: Boolean(result.indexes?.created?.length),
  });
  if (result.warning) console.warn(`[Database] ${result.warning}`);
  return result;
}

async function startServer() {
  try {
    await connectDatabase();
    await prepareTransformerIdentity();
    importService.startImportCleanupScheduler();

    server = app.listen(config.port, () => {
      console.log(`=================================================`);
      console.log(` SIGAP ULP Labuhan - Backend API Service`);
      console.log(` Port: ${config.port}`);
      console.log(` Environment: ${config.nodeEnv}`);
      console.log(` Database: ${config.sanitizedMongodbUri}`);
      console.log(`=================================================`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received. Closing HTTP server...');
  importService.stopImportCleanupScheduler();
  if (server) {
    server.close(async () => {
      console.log('HTTP server closed.');
      await disconnectDatabase();
      process.exit(0);
    });
  }
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received. Closing HTTP server...');
  importService.stopImportCleanupScheduler();
  if (server) {
    server.close(async () => {
      console.log('HTTP server closed.');
      await disconnectDatabase();
      process.exit(0);
    });
  }
});

if (require.main === module) {
  startServer();
}

module.exports = { app, prepareTransformerIdentity, startServer };
