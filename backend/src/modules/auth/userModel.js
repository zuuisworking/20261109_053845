const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    adminId: {
      type: String,
      required: [true, 'ID Admin wajib diisi'],
      unique: true,
      lowercase: true,
      trim: true,
      minlength: [3, 'ID Admin minimal 3 karakter'],
      maxlength: [64, 'ID Admin maksimal 64 karakter'],
      match: /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    },
    username: {
      type: String,
      required: [true, 'Username wajib diisi'],
      unique: true,
      trim: true,
      minlength: [3, 'Username minimal 3 karakter'],
      maxlength: [64, 'Username maksimal 64 karakter'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash wajib ada'],
    },
    fullName: {
      type: String,
      trim: true,
      maxlength: [120, 'Nama lengkap maksimal 120 karakter'],
      default: '',
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      maxlength: [254, 'Email maksimal 254 karakter'],
      unique: true,
      sparse: true,
    },
    avatar: {
      type: String,
      default: '',
      maxlength: 512,
    },
    avatarMetadata: {
      path: {
        type: String,
        maxlength: 512,
      },
      filename: {
        type: String,
        maxlength: 255,
      },
      originalName: {
        type: String,
        maxlength: 255,
      },
      mimeType: {
        type: String,
        enum: ['image/jpeg', 'image/png', 'image/webp'],
      },
      size: {
        type: Number,
        min: 1,
        max: 2 * 1024 * 1024,
      },
      uploadedAt: {
        type: Date,
      },
    },
    role: {
      type: String,
      enum: ['superadmin', 'admin'],
      default: 'admin',
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

userSchema.methods.comparePassword = async function comparePassword(candidatePassword) {
  return bcrypt.compare(String(candidatePassword), this.passwordHash);
};

userSchema.statics.hashPassword = async function hashPassword(plainPassword) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(String(plainPassword), salt);
};

module.exports = mongoose.model('User', userSchema);
