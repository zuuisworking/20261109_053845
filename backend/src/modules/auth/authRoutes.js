const express = require('express');
const router = express.Router();
const authController = require('./authController');
const { authMiddleware, requireRole } = require('../../middlewares/authMiddleware');
const { requireAllowedOrigin } = require('../../middlewares/csrfMiddleware');
const { loginRateLimiter } = require('../../middlewares/loginRateLimiter');
const { uploadAvatarFile } = require('./avatarService');
const {
  loginSchema,
  passwordChangeSchema,
  profileSchema,
  registerAdminSchema,
  usernameChangeSchema,
  validateRequest,
} = require('../../shared/validation');

router.use((_req, res, next) => {
  // Authentication responses contain session state and must never be cached by
  // browsers or intermediary proxies.
  res.set('Cache-Control', 'no-store');
  next();
});

router.post(
  '/login',
  requireAllowedOrigin,
  loginRateLimiter,
  validateRequest(loginSchema),
  (req, res, next) => authController.login(req, res, next),
);
router.post('/logout', authMiddleware, (req, res, next) => authController.logout(req, res, next));
router.get('/me', authMiddleware, (req, res) => authController.getMe(req, res));

router.post(
  '/register-admin',
  authMiddleware,
  requireRole('superadmin'),
  validateRequest(registerAdminSchema),
  (req, res, next) => authController.registerAdmin(req, res, next),
);
router.put(
  '/profile/username',
  authMiddleware,
  validateRequest(usernameChangeSchema),
  (req, res, next) => authController.changeUsername(req, res, next),
);
router.put(
  '/profile/password',
  authMiddleware,
  validateRequest(passwordChangeSchema),
  (req, res, next) => authController.changePassword(req, res, next),
);
router.put(
  '/profile',
  authMiddleware,
  validateRequest(profileSchema),
  (req, res, next) => authController.updateProfile(req, res, next),
);
router.post(
  '/profile/avatar',
  authMiddleware,
  uploadAvatarFile,
  (req, res, next) => authController.uploadAvatar(req, res, next),
);
router.get(
  '/avatar/:userId',
  authMiddleware,
  (req, res, next) => authController.getAvatar(req, res, next),
);

module.exports = router;
