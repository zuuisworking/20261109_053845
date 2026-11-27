const mongoose = require('mongoose');

const guestVisitSchema = new mongoose.Schema(
  {
    syncFingerprint: {
      type: String,
      required: true,
      unique: true,
    },
    timestamp: {
      type: Date,
      default: null,
    },
    timestampRaw: {
      type: String,
      default: null,
      trim: true,
    },
    sourceRecordId: {
      type: String,
      default: null,
      trim: true,
    },
    syncedAt: {
      type: Date,
      default: null,
    },
    guestName: {
      type: String,
      required: [true, 'Nama tamu wajib diisi'],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, 'Nomor HP wajib diisi'],
      trim: true,
    },
    customerId: {
      type: String,
      default: null,
      trim: true,
    },
    purpose: {
      type: String,
      required: [true, 'Keperluan wajib diisi'],
      trim: true,
    },
    source: {
      type: String,
      enum: ['google_form', 'manual'],
      default: 'google_form',
    },
  },
  {
    timestamps: true,
    collection: 'guest_visits',
  }
);

module.exports = mongoose.models.GuestVisit || mongoose.model('GuestVisit', guestVisitSchema);
