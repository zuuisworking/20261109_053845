const path = require('path');
const authService = require('./authService');
const { getAvatarForUser, storeAvatarForUser } = require('./avatarService');
const {
  clearAuthCookies,
  getCsrfCookieOptions,
  getSessionCookieOptions,
} = require('./sessionCookie');
const config = require('../../config');
const AppError = require('../../shared/errors/AppError');

class AuthController {
  async login(req, res, next) {
    try {
      const adminId = req.body.adminId ?? req.body.idadmin;
      const result = await authService.login(adminId, req.body.password, {
        currentToken: req.cookies?.[config.sessionCookieName],
      });

      res.cookie(config.sessionCookieName, result.rawToken, getSessionCookieOptions());
      res.cookie(config.csrfCookieName, result.csrfToken, getCsrfCookieOptions());

      // Neither the raw session token nor the raw CSRF token is ever returned
      // in a JSON body.
      res.status(200).json({
        data: {
          user: result.user,
          session: {
            expiresAt: result.expiresAt,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async logout(req, res, next) {
    try {
      await authService.logout(req.auth.sessionId);
      clearAuthCookies(res);
      res.status(200).json({
        data: {
          revoked: true,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getMe(req, res) {
    res.status(200).json({
      data: {
        user: req.user,
        session: {
          expiresAt: req.session.expiresAt,
        },
      },
    });
  }

  async registerAdmin(req, res, next) {
    try {
      const result = await authService.registerAdmin(req.user, req.body);
      res.status(201).json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  async changeUsername(req, res, next) {
    try {
      const newUsername = req.body.username ?? req.body.newUsername;
      const result = await authService.changeUsername(req.user._id, newUsername);
      res.status(200).json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  async changePassword(req, res, next) {
    try {
      const currentPassword =
        req.body.currentPassword ?? req.body.oldPassword;
      const result = await authService.changePassword(
        req.user._id,
        currentPassword,
        req.body.newPassword
      );
      clearAuthCookies(res);
      res.status(200).json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  async updateProfile(req, res, next) {
    try {
      const result = await authService.updateProfile(req.user._id, req.body);
      res.status(200).json({ data: result });
    } catch (error) {
      next(error);
    }
  }

  async uploadAvatar(req, res, next) {
    try {
      const result = await storeAvatarForUser(req.user._id, req.file);
      res.status(200).json({
        data: {
          user: result.user,
          avatar: result.user.avatar,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getAvatar(req, res, next) {
    try {
      const requestedUserId = String(req.params.userId || '');
      const currentUserId = req.user._id.toString();
      if (requestedUserId !== currentUserId && req.user.role !== 'superadmin') {
        throw new AppError(
          'Anda tidak memiliki hak akses untuk melihat avatar tersebut.',
          403,
          null,
          'FORBIDDEN'
        );
      }

      const avatar = await getAvatarForUser(requestedUserId);
      const extension = path.extname(avatar.absolutePath).toLowerCase() || '.bin';
      res.type(avatar.mimeType);
      res.set('Cache-Control', 'private, max-age=300');
      res.set('Content-Disposition', `inline; filename="avatar${extension}"`);
      res.sendFile(avatar.absolutePath, { dotfiles: 'deny' }, (error) => {
        if (error) {
          next(error);
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
