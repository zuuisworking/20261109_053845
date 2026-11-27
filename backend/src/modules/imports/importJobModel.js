const crypto = require('crypto');
const mongoose = require('mongoose');

const randomJobId = () => crypto.randomUUID();

const summarySchema = new mongoose.Schema(
  {
    totalRows: { type: Number, required: true, min: 0, default: 0 },
    validRows: { type: Number, required: true, min: 0, default: 0 },
    insertCount: { type: Number, required: true, min: 0, default: 0 },
    updateCount: { type: Number, required: true, min: 0, default: 0 },
    unchangedCount: { type: Number, required: true, min: 0, default: 0 },
    rejectedCount: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false, minimize: false },
);

const importJobSchema = new mongoose.Schema(
  {
    jobId: {
      type: String,
      required: true,
      unique: true,
      default: randomJobId,
    },
    kind: {
      type: String,
      enum: ['transformer', 'customer'],
      required: true,
    },
    origin: {
      type: String,
      enum: ['api_import', 'ground_truth_migration'],
      required: true,
      default: 'api_import',
    },
    format: {
      type: String,
      enum: ['csv', 'xlsx'],
      required: true,
    },
    sourceEncoding: {
      type: String,
      enum: ['utf-8-sig', 'cp1252'],
      default: null,
    },
    sourceWorksheetName: {
      type: String,
      default: null,
      maxlength: 255,
    },
    sourceFilename: {
      type: String,
      required: true,
      maxlength: 255,
    },
    sourceSizeBytes: {
      type: Number,
      required: true,
      min: 1,
    },
    sourceSha256: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
    },
    stagedUploadId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    diffReportUploadId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    diffReportSha256: {
      type: String,
      required: true,
      match: /^[a-f0-9]{64}$/,
    },
    previewTokenHash: {
      type: String,
      required: true,
      unique: true,
      match: /^[a-f0-9]{64}$/,
    },
    actorUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['previewed', 'committing', 'committed', 'failed', 'expired'],
      required: true,
      default: 'previewed',
      index: true,
    },
    summary: {
      type: summarySchema,
      required: true,
      default: () => ({}),
    },
    issueCount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    mapping: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    resolvedMapping: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    commitProgress: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    commitError: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    commitLeaseUntil: {
      type: Date,
      default: null,
      index: true,
    },
    committedAt: {
      type: Date,
      default: null,
    },
    commitResult: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'import_jobs',
  },
);

importJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
importJobSchema.index({ actorUserId: 1, createdAt: -1 });

module.exports = mongoose.models.ImportJob || mongoose.model('ImportJob', importJobSchema);
