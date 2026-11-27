const mongoose = require('mongoose');

const importJobIssueSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ImportJob',
      required: true,
      index: true,
    },
    rowNumber: {
      type: Number,
      required: true,
      min: 1,
    },
    field: {
      type: String,
      default: null,
    },
    code: {
      type: String,
      required: true,
      index: true,
    },
    message: {
      type: String,
      required: true,
    },
    rawValue: {
      type: String,
      default: null,
      maxlength: 4096,
    },
    action: {
      type: String,
      enum: ['reject', 'skip', 'warn'],
      required: true,
      default: 'reject',
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    collection: 'import_job_issues',
  },
);

importJobIssueSchema.index({ jobId: 1, rowNumber: 1, field: 1 });
importJobIssueSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports =
  mongoose.models.ImportJobIssue || mongoose.model('ImportJobIssue', importJobIssueSchema);
