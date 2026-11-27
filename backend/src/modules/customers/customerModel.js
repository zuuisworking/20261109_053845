const mongoose = require('mongoose');
const {
  CUSTOMER_NAME_MAX_LENGTH,
  CUSTOMER_TARIFF_MAX_LENGTH,
  CUSTOMER_POWER_RAW_MAX_LENGTH,
  CUSTOMER_ADDRESS_MAX_LENGTH,
  MAX_POWER_VA,
} = require('../../shared/constants/domainLimits');

const customerSchema = new mongoose.Schema(
  {
    customerId: {
      type: String,
      required: [true, 'ID Pelanggan wajib diisi'],
      unique: true,
      trim: true,
      match: [/^\d{12}$/, 'ID Pelanggan harus terdiri dari tepat 12 digit'],
      index: true,
    },
    name: {
      type: String,
      required: [true, 'Nama pelanggan wajib diisi'],
      trim: true,
      maxlength: [
        CUSTOMER_NAME_MAX_LENGTH,
        `Nama pelanggan maksimal ${CUSTOMER_NAME_MAX_LENGTH} karakter`,
      ],
      index: true,
    },
    tariff: {
      type: String,
      trim: true,
      maxlength: [
        CUSTOMER_TARIFF_MAX_LENGTH,
        `Tarif maksimal ${CUSTOMER_TARIFF_MAX_LENGTH} karakter`,
      ],
    },
    // `powerRaw` menyimpan teks daya asli. `power` adalah alias legacy.
    powerRaw: {
      type: String,
      trim: true,
      maxlength: [
        CUSTOMER_POWER_RAW_MAX_LENGTH,
        `Teks daya maksimal ${CUSTOMER_POWER_RAW_MAX_LENGTH} karakter`,
      ],
      alias: 'power',
    },
    powerVa: {
      type: Number,
      validate: {
        validator(value) {
          return (
            value === null ||
            value === undefined ||
            (Number.isSafeInteger(value) && value >= 0 && value <= MAX_POWER_VA)
          );
        },
        message: 'Daya VA harus berupa bilangan bulat nonnegatif yang aman',
      },
    },
    address: {
      type: String,
      trim: true,
      maxlength: [
        CUSTOMER_ADDRESS_MAX_LENGTH,
        `Alamat pelanggan maksimal ${CUSTOMER_ADDRESS_MAX_LENGTH} karakter`,
      ],
    },
    feeder: {
      type: String,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      trim: true,
    },
    source: {
      type: String,
      trim: true,
    },
    sourceFile: {
      type: String,
      trim: true,
      maxlength: 255,
    },
    sourceRow: {
      type: Number,
      min: 1,
    },
    sourceMetadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

customerSchema.index({ address: 1 });

function mapPowerAliasInUpdate(update) {
  if (!update || typeof update !== 'object' || Array.isArray(update)) return update;

  const rewritten = { ...update };
  for (const operator of ['$set', '$setOnInsert']) {
    if (rewritten[operator] && Object.prototype.hasOwnProperty.call(rewritten[operator], 'power')) {
      const values = { ...rewritten[operator] };
      if (values.powerRaw === undefined) values.powerRaw = values.power;
      delete values.power;
      rewritten[operator] = values;
    }
  }
  if (!rewritten.$set && !rewritten.$setOnInsert && Object.prototype.hasOwnProperty.call(rewritten, 'power')) {
    const replacement = { ...rewritten };
    if (replacement.powerRaw === undefined) replacement.powerRaw = replacement.power;
    delete replacement.power;
    return replacement;
  }
  return rewritten;
}

customerSchema.pre(['updateOne', 'findOneAndUpdate'], function mapPowerAlias() {
  this.setUpdate(mapPowerAliasInUpdate(this.getUpdate()));
});

customerSchema.pre(['replaceOne', 'findOneAndReplace'], function mapPowerAlias() {
  this.setUpdate(mapPowerAliasInUpdate(this.getUpdate()));
});

customerSchema.pre('bulkWrite', function mapBulkPowerAliases(ops) {
  for (const operation of ops) {
    if (operation.updateOne || operation.updateMany) {
      const op = operation.updateOne || operation.updateMany;
      op.update = mapPowerAliasInUpdate(op.update);
    } else if (operation.replaceOne) {
      operation.replaceOne.replacement = mapPowerAliasInUpdate(operation.replaceOne.replacement);
    } else if (operation.insertOne?.document) {
      const document = operation.insertOne.document;
      if (document.powerRaw === undefined && document.power !== undefined) {
        document.powerRaw = document.power;
      }
      delete document.power;
    }
  }
  return ops;
});

module.exports = mongoose.model('Customer', customerSchema);
