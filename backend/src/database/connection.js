const mongoose = require('mongoose');
const config = require('../config');

let isConnected = false;

async function connectDatabase(uri = config.mongodbUri) {
  if (isConnected) return mongoose.connection;

  try {
    const conn = await mongoose.connect(uri, {
      autoIndex: true,
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = true;
    console.log(`[Database] MongoDB connected: ${conn.connection.host}/${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.error('[Database] MongoDB connection error:', error.message);
    throw error;
  }
}

async function disconnectDatabase() {
  if (!isConnected) return;
  await mongoose.disconnect();
  isConnected = false;
  console.log('[Database] MongoDB disconnected.');
}

module.exports = {
  connectDatabase,
  disconnectDatabase,
  getConnection: () => mongoose.connection,
};
