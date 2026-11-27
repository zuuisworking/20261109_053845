const express = require('express');
const router = express.Router();
const guestController = require('./guestController');
const { authMiddleware, requireRole } = require('../../middlewares/authMiddleware');
const { guestSyncRateLimiter } = require('../../middlewares/guestSyncRateLimiter');

router.use(authMiddleware);
router.use(requireRole('admin', 'superadmin'));

router.get('/', (req, res, next) => guestController.getGuests(req, res, next));
router.post(
  '/sync',
  guestSyncRateLimiter,
  (req, res, next) => guestController.syncGuests(req, res, next)
);

module.exports = router;
