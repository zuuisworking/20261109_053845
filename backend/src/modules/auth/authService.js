const bcrypt = require('bcryptjs');
const User = require('./userModel');
const {
  createSession,
  revokeAllSessionsForUser,
  revokeSessionById,
  revokeSessionByToken,
} = require('./sessionService');
const {
  assertValid,
  passwordSchema,
  registerAdminSchema,
  usernameSchema,
} = require('../../shared/validation');
const AppError = require('../../shared/errors/AppError');

const INVALID_CREDENTIALS_MESSAGE = 'ID Admin atau kata sandi salah.';
const DUMMY_PASSWORD_HASH = '$2b$10$6FGSdP36lYEatfA5KBLnjuW0mJzfoS.IybMdZSa0IjdHd1oj.Nm2O';

function normalizeAdminId(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function toPublicUser(user) {
  return {
    id: user._id.toString(),
    adminId: user.adminId,
    username: user.username,
    fullName: user.fullName ?? null,
    email: user.email ?? null,
    avatar: user.avatar || '',
    role: user.role,
  };
}

class AuthService {
  async login(adminId, password, options = {}) {
    const normalizedAdminId = normalizeAdminId(adminId);
    if (!normalizedAdminId || typeof password !== 'string' || !password) {
      throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401, null, 'INVALID_CREDENTIALS');
    }

    const user = await User.findOne({ adminId: normalizedAdminId });
    const passwordHash = user?.passwordHash || DUMMY_PASSWORD_HASH;
    const isPasswordValid = await bcrypt.compare(password, passwordHash);

    if (!user || !user.isActive || !isPasswordValid) {
      throw new AppError(INVALID_CREDENTIALS_MESSAGE, 401, null, 'INVALID_CREDENTIALS');
    }

    if (options.currentToken) {
      await revokeSessionByToken(options.currentToken, 'rotated-login');
    }

    const { rawToken, csrfToken, session } = await createSession(user._id);

    return {
      rawToken,
      csrfToken,
      expiresAt: session.expiresAt,
      user: toPublicUser(user),
    };
  }

  async registerAdmin(requesterUser, newAdminData) {
    if (!requesterUser) {
      throw new AppError(
        'Hanya superadmin yang dapat mendaftarkan admin baru.',
        403,
        null,
        'FORBIDDEN'
      );
    }

    if (requesterUser.role !== 'superadmin') {
      throw new AppError(
        'Hanya superadmin yang dapat mendaftarkan admin baru.',
        403,
        null,
        'FORBIDDEN'
      );
    }

    assertValid(registerAdminSchema, newAdminData);

    const adminId = normalizeAdminId(newAdminData.adminId);
    const username = newAdminData.username.trim();
    const existingUser = await User.findOne({
      $or: [{ adminId }, { username }],
    });

    if (existingUser) {
      throw new AppError(
        'ID Admin atau Username tersebut sudah terdaftar.',
        409,
        null,
        'DUPLICATE_RESOURCE'
      );
    }

    const passwordHash = await User.hashPassword(newAdminData.password);
    const newUser = await User.create({
      adminId,
      username,
      passwordHash,
      fullName:
        typeof newAdminData.fullName === 'string'
          ? newAdminData.fullName.trim()
          : null,
      email:
        typeof newAdminData.email === 'string'
          ? newAdminData.email.trim().toLowerCase()
          : null,
      role: 'admin',
      isActive: true,
    });

    return toPublicUser(newUser);
  }

  async changeUsername(userId, newUsername) {
    assertValid(usernameSchema, newUsername);
    const normalizedUsername = newUsername.trim();

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('Pengguna tidak ditemukan.', 404, null, 'RESOURCE_NOT_FOUND');
    }

    const usernameExists = await User.exists({
      username: normalizedUsername,
      _id: { $ne: user._id },
    });
    if (usernameExists) {
      throw new AppError(
        'Username tersebut sudah digunakan.',
        409,
        null,
        'DUPLICATE_RESOURCE'
      );
    }

    user.username = normalizedUsername;
    await user.save();

    return toPublicUser(user);
  }

  async changePassword(userId, currentPassword, newPassword) {
    assertValid(passwordSchema, newPassword);

    if (typeof currentPassword !== 'string' || !currentPassword) {
      throw new AppError(
        'Kata sandi saat ini wajib diisi.',
        400,
        null,
        'VALIDATION_ERROR'
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('Pengguna tidak ditemukan.', 404, null, 'RESOURCE_NOT_FOUND');
    }

    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      throw new AppError(
        'Kata sandi saat ini tidak cocok.',
        400,
        null,
        'INVALID_CURRENT_PASSWORD'
      );
    }

    if (await user.comparePassword(newPassword)) {
      throw new AppError(
        'Kata sandi baru harus berbeda dari kata sandi saat ini.',
        400,
        null,
        'PASSWORD_REUSE'
      );
    }

    user.passwordHash = await User.hashPassword(newPassword);
    await user.save();
    await revokeAllSessionsForUser(user._id, 'password-change');

    return {
      passwordChanged: true,
      reauthenticationRequired: true,
    };
  }

  async updateProfile(userId, updateData) {
    if (Object.prototype.hasOwnProperty.call(updateData, 'avatar')) {
      throw new AppError(
        'Avatar harus diunggah melalui endpoint avatar.',
        422,
        null,
        'UNEXPECTED_FIELD'
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new AppError('Pengguna tidak ditemukan.', 404, null, 'RESOURCE_NOT_FOUND');
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'fullName')) {
      user.fullName =
        typeof updateData.fullName === 'string'
          ? updateData.fullName.trim()
          : null;
    }

    if (Object.prototype.hasOwnProperty.call(updateData, 'email')) {
      user.email =
        typeof updateData.email === 'string'
          ? updateData.email.trim().toLowerCase()
          : null;
    }

    await user.save();

    return toPublicUser(user);
  }

  async logout(sessionId) {
    await revokeSessionById(sessionId, 'logout');
    return { revoked: true };
  }
}

module.exports = new AuthService();
module.exports.normalizeAdminId = normalizeAdminId;
module.exports.toPublicUser = toPublicUser;
module.exports.INVALID_CREDENTIALS_MESSAGE = INVALID_CREDENTIALS_MESSAGE;
