const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const mongoose = require('mongoose');
const config = require('../../config');
const User = require('./userModel');
const { toPublicUser } = require('./authService');
const AppError = require('../../shared/errors/AppError');

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const IMAGE_SIGNATURES = {
  'image/jpeg': {
    extension: '.jpg',
    matches: (buffer) =>
      buffer.length >= 3 &&
      buffer[0] === 0xff &&
      buffer[1] === 0xd8 &&
      buffer[2] === 0xff,
  },
  'image/png': {
    extension: '.png',
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a,
  },
  'image/webp': {
    extension: '.webp',
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP',
  },
};

function detectImageType(buffer) {
  for (const [mimeType, signature] of Object.entries(IMAGE_SIGNATURES)) {
    if (signature.matches(buffer)) {
      return { mimeType, extension: signature.extension };
    }
  }

  return null;
}

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxAvatarBytes,
    files: 1,
    fields: 0,
    parts: 1,
  },
  fileFilter: (req, file, callback) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return callback(
        new AppError(
          'Format avatar harus JPEG, PNG, atau WebP.',
          415,
          null,
          'UNSUPPORTED_MEDIA_TYPE'
        )
      );
    }

    if (file.size > config.maxAvatarBytes) {
      return callback(
        new AppError(
          'Ukuran avatar maksimal 2 MiB.',
          413,
          null,
          'PAYLOAD_TOO_LARGE'
        )
      );
    }

    return callback(null, true);
  },
});

function uploadAvatarFile(req, res, next) {
  avatarUpload.single('avatar')(req, res, (error) => {
    if (error) {
      return next(error);
    }

    if (!req.file) {
      return next(
        new AppError(
          'Field avatar wajib diisi.',
          400,
          null,
          'MALFORMED_MULTIPART'
        )
      );
    }

    return next();
  });
}

function resolveStoredAvatarPath(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) {
    return null;
  }

  const uploadRoot = path.resolve(config.uploadDir);
  const avatarRoot = path.resolve(config.avatarUploadDir);
  const absolutePath = path.resolve(uploadRoot, relativePath);
  const relativeToAvatarRoot = path.relative(avatarRoot, absolutePath);

  if (
    relativeToAvatarRoot.startsWith('..') ||
    path.isAbsolute(relativeToAvatarRoot) ||
    !relativeToAvatarRoot
  ) {
    return null;
  }

  return absolutePath;
}

async function removeStoredAvatar(relativePath) {
  const absolutePath = resolveStoredAvatarPath(relativePath);
  if (!absolutePath) {
    return;
  }

  try {
    await fs.unlink(absolutePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[Avatar] Failed to remove an old avatar file.');
    }
  }
}

async function writeAvatarFile(buffer, extension) {
  await fs.mkdir(config.avatarUploadDir, { recursive: true, mode: 0o750 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const filename = `${crypto.randomBytes(24).toString('hex')}${extension}`;
    const absolutePath = path.join(config.avatarUploadDir, filename);

    try {
      await fs.writeFile(absolutePath, buffer, {
        flag: 'wx',
        mode: 0o600,
      });
      return { absolutePath, filename };
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  throw new AppError(
    'Gagal menyimpan avatar.',
    500,
    null,
    'AVATAR_STORAGE_ERROR'
  );
}

async function storeAvatarForUser(userId, file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0) {
    throw new AppError(
      'File avatar tidak valid.',
      400,
      null,
      'MALFORMED_MULTIPART'
    );
  }

  if (file.buffer.length > config.maxAvatarBytes) {
    throw new AppError(
      'Ukuran avatar maksimal 2 MiB.',
      413,
      null,
      'PAYLOAD_TOO_LARGE'
    );
  }

  const detectedImage = detectImageType(file.buffer);
  if (!detectedImage || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new AppError(
      'Isi file avatar tidak sesuai dengan format yang diizinkan.',
      415,
      null,
      'UNSUPPORTED_MEDIA_TYPE'
    );
  }

  if (detectedImage.mimeType !== file.mimetype) {
    throw new AppError(
      'Isi file avatar tidak sesuai dengan format yang diizinkan.',
      415,
      null,
      'UNSUPPORTED_MEDIA_TYPE'
    );
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new AppError('Pengguna tidak ditemukan.', 404, null, 'RESOURCE_NOT_FOUND');
  }

  const previousAvatarPath = user.avatarMetadata?.path || null;
  const { absolutePath, filename } = await writeAvatarFile(
    file.buffer,
    detectedImage.extension
  );
  const relativePath = path.posix.join('avatars', filename);
  const originalName = path
    .basename(file.originalname || 'avatar')
    .split('')
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join('')
    .slice(0, 255);

  try {
    user.avatar = `/api/v1/auth/avatar/${user._id.toString()}`;
    user.avatarMetadata = {
      path: relativePath,
      filename,
      originalName,
      mimeType: detectedImage.mimeType,
      size: file.buffer.length,
      uploadedAt: new Date(),
    };
    await user.save();
  } catch (error) {
    await fs.unlink(absolutePath).catch(() => {});
    throw error;
  }

  if (previousAvatarPath && previousAvatarPath !== relativePath) {
    await removeStoredAvatar(previousAvatarPath);
  }

  return {
    user: toPublicUser(user),
    file: {
      absolutePath,
      filename,
      mimeType: detectedImage.mimeType,
      size: file.buffer.length,
    },
  };
}

async function getAvatarForUser(userId) {
  if (!mongoose.isValidObjectId(userId)) {
    throw new AppError('Avatar tidak ditemukan.', 404, null, 'RESOURCE_NOT_FOUND');
  }

  const user = await User.findById(userId).select('avatar avatarMetadata');
  if (!user || !user.avatarMetadata?.path) {
    throw new AppError('Avatar tidak ditemukan.', 404, null, 'RESOURCE_NOT_FOUND');
  }

  const absolutePath = resolveStoredAvatarPath(user.avatarMetadata.path);
  if (!absolutePath) {
    throw new AppError('Avatar tidak ditemukan.', 404, null, 'RESOURCE_NOT_FOUND');
  }

  try {
    const stats = await fs.stat(absolutePath);
    if (!stats.isFile()) {
      throw new AppError(
        'Avatar tidak ditemukan.',
        404,
        null,
        'RESOURCE_NOT_FOUND'
      );
    }
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('Avatar tidak ditemukan.', 404, null, 'RESOURCE_NOT_FOUND');
  }

  const mimeType = ALLOWED_MIME_TYPES.has(user.avatarMetadata.mimeType)
    ? user.avatarMetadata.mimeType
    : 'application/octet-stream';

  return {
    absolutePath,
    mimeType,
    size: user.avatarMetadata.size,
  };
}

module.exports = {
  detectImageType,
  getAvatarForUser,
  storeAvatarForUser,
  uploadAvatarFile,
};
