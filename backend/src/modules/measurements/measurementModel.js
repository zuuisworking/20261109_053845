const mongoose = require('mongoose');
const {
  MAX_CURRENT_AMPS,
  MEASUREMENT_TEXT_MAX_LENGTH,
} = require('../../shared/constants/domainLimits');

const currentField = {
  type: Number,
  min: [0, 'Arus tidak boleh kurang dari 0'],
  max: [MAX_CURRENT_AMPS, `Arus tidak boleh lebih dari ${MAX_CURRENT_AMPS} A`],
};

const voltageField = {
  type: Number,
  min: [0, 'Tegangan tidak boleh kurang dari 0'],
  max: [500, 'Tegangan tidak boleh lebih dari 500 V'],
};

const branchSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      maxlength: [
        MEASUREMENT_TEXT_MAX_LENGTH,
        `Nama jurusan maksimal ${MEASUREMENT_TEXT_MAX_LENGTH} karakter`,
      ],
    },
    r: { ...currentField },
    s: { ...currentField },
    t: { ...currentField },
    n: { ...currentField },
    fuse: {
      type: String,
      trim: true,
      maxlength: [
        MEASUREMENT_TEXT_MAX_LENGTH,
        `Fuse maksimal ${MEASUREMENT_TEXT_MAX_LENGTH} karakter`,
      ],
    },
    note: {
      type: String,
      trim: true,
      maxlength: [
        MEASUREMENT_TEXT_MAX_LENGTH,
        `Catatan maksimal ${MEASUREMENT_TEXT_MAX_LENGTH} karakter`,
      ],
    },
  },
  { _id: false, minimize: false, strict: true },
);

const measurementSchema = new mongoose.Schema(
  {
    transformerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transformer',
      required: [true, 'Transformer ID wajib ada'],
      index: true,
    },
    period: {
      type: String,
      enum: {
        values: ['wbp', 'lwbp'],
        message: 'Periode pengukuran hanya boleh WBP atau LWBP',
      },
      required: [true, 'Periode pengukuran wajib diisi'],
      trim: true,
      lowercase: true,
    },
    voltage: {
      r: { ...voltageField },
      s: { ...voltageField },
      t: { ...voltageField },
    },
    incoming: {
      r: { ...currentField },
      s: { ...currentField },
      t: { ...currentField },
      n: { ...currentField },
    },
    branches: {
      type: [branchSchema],
      default: undefined,
    },
    measurementDate: {
      type: Date,
      default: null,
    },
    measurementTime: {
      type: String,
      trim: true,
      default: null,
      validate: {
        validator(value) {
          return (
            value === null ||
            value === undefined ||
            /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
          );
        },
        message: 'Jam pengukuran harus menggunakan format HH:mm',
      },
    },
    source: {
      type: String,
      enum: {
        values: ['html_snapshot', 'operator_import', 'manual'],
        message: 'Sumber pengukuran tidak valid',
      },
      required: [true, 'Sumber pengukuran wajib diisi'],
    },
    sourceRecordKey: {
      type: String,
      trim: true,
      default: null,
      maxlength: [300, 'Kunci sumber pengukuran maksimal 300 karakter'],
    },
  },
  { timestamps: true, strict: true },
);

measurementSchema.index({ transformerId: 1, period: 1 }, { unique: true });
measurementSchema.index({ measurementDate: -1 }, { sparse: true });

module.exports = mongoose.model('Measurement', measurementSchema);
