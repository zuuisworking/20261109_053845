const express = require('express');
const router = express.Router();
const customerController = require('./customerController');
const { authMiddleware, requireRole } = require('../../middlewares/authMiddleware');
const { validateRequest, customerWriteSchema } = require('../../shared/validation');

router.use(authMiddleware);

router.get('/', (req, res, next) => customerController.getCustomers(req, res, next));
router.get('/:id', (req, res, next) => customerController.getCustomerById(req, res, next));
router.post(
  '/',
  validateRequest(customerWriteSchema),
  (req, res, next) => customerController.createCustomer(req, res, next),
);
router.put(
  '/:id',
  validateRequest(customerWriteSchema),
  (req, res, next) => customerController.updateCustomer(req, res, next),
);
router.delete(
  '/:id',
  requireRole('superadmin'),
  (req, res, next) => customerController.deleteCustomer(req, res, next),
);

module.exports = router;
