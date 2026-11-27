const mongoose = require('mongoose');

const BUCKET_NAME = 'import_staging';

function getBucket() {
  const database = mongoose.connection.db;
  if (!database) {
    throw new Error('MongoDB connection is required for import staging.');
  }
  return new mongoose.mongo.GridFSBucket(database, { bucketName: BUCKET_NAME });
}

function uploadBuffer(buffer, filename, metadata = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('A non-empty staging buffer is required.');
  }

  const bucket = getBucket();
  return new Promise((resolve, reject) => {
    const stream = bucket.openUploadStream(filename, {
      contentType: 'application/octet-stream',
      metadata,
    });
    stream.once('error', reject);
    stream.once('finish', () => resolve(stream.id));
    stream.end(buffer);
  });
}

async function downloadBuffer(fileId) {
  const bucket = getBucket();
  const file = await bucket.find({ _id: fileId }).next();
  if (!file) return null;

  const chunks = [];
  for await (const chunk of bucket.openDownloadStream(fileId)) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function deleteArtifact(fileId) {
  if (!fileId) return false;
  const bucket = getBucket();
  try {
    await bucket.delete(fileId);
    return true;
  } catch (error) {
    // GridFS reports a missing file as FileNotFound. Cleanup is idempotent.
    if (error?.code === 27 || error?.codeName === 'FileNotFound') return false;
    throw error;
  }
}

async function deleteArtifacts(fileIds) {
  const uniqueIds = Array.from(
    new Map(
      (fileIds || [])
        .filter(Boolean)
        .map((fileId) => [String(fileId), fileId]),
    ).values(),
  );
  const settled = await Promise.allSettled(
    uniqueIds.map(async (fileId) => {
      try {
        return {
          fileId,
          deleted: await deleteArtifact(fileId),
        };
      } catch (error) {
        error.fileId = fileId;
        throw error;
      }
    }),
  );

  return {
    deleted: settled.filter(
      (result) => result.status === 'fulfilled' && result.value.deleted,
    ).length,
    missing: settled.filter(
      (result) => result.status === 'fulfilled' && !result.value.deleted,
    ).length,
    failed: settled
      .filter((result) => result.status === 'rejected')
      .map((result) => ({
        fileId: result.reason?.fileId,
        error: result.reason,
      })),
  };
}

async function cleanupExpiredArtifacts(now = new Date()) {
  const bucket = getBucket();
  const cursor = bucket.find({ 'metadata.expiresAt': { $lte: now } });
  const failures = [];
  for await (const file of cursor) {
    try {
      await deleteArtifact(file._id);
    } catch (error) {
      failures.push({ fileId: file._id, error: error.message });
    }
  }
  return { failures };
}

module.exports = {
  BUCKET_NAME,
  cleanupExpiredArtifacts,
  deleteArtifact,
  deleteArtifacts,
  downloadBuffer,
  getBucket,
  uploadBuffer,
};
