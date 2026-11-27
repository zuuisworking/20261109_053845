const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema(
  {
    tokenHash: {
      type: String,
      required: true,
      unique: true,
      minlength: 64,
      maxlength: 64,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    csrfTokenHash: {
      type: String,
      required: true,
      minlength: 64,
      maxlength: 64,
    },
    createdAt: {
      type: Date,
      required: true,
      default: Date.now,
      immutable: true,
    },
    lastUsedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: {
        expireAfterSeconds: 0,
      },
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedReason: {
      type: String,
      default: null,
      maxlength: 64,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

sessionSchema.methods.isActive = function isActive(now = new Date()) {
  return !this.revokedAt && this.expiresAt && this.expiresAt.getTime() > now.getTime();
};

module.exports = mongoose.model('Session', sessionSchema);
