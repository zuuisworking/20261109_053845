const express = require('express');
const router = express.Router();
const exportController = require('./exportController');
const { authMiddleware, requireRole } = require('../../middlewares/authMiddleware');

router.use(authMiddleware);
router.use(requireRole('admin', 'superadmin'));

router.get('/transformers', (req, res, next) => exportController.exportTransformers(req, res, next));
router.get('/customers', (req, res, next) => exportController.exportCustomers(req, res, next));
router.get('/guests', (req, res, next) => exportController.exportGuests(req, res, next));

module.exports = router;
