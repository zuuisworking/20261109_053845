const express = require('express');
const router = express.Router();
const transformerAliasController = require('./transformerAliasController');
const { authMiddleware, requireRole } = require('../../middlewares/authMiddleware');
const { validateRequest } = require('../../shared/validation');
const {
  transformerAliasWriteSchema,
} = require('../../shared/validation/transformerAliasSchemas');

router.use(authMiddleware);
router.get('/', (req, res, next) => transformerAliasController.list(req, res, next));
router.post(
  '/',
  requireRole('superadmin'),
  validateRequest(transformerAliasWriteSchema),
  (req, res, next) => transformerAliasController.create(req, res, next),
);
router.delete(
  '/:id',
  requireRole('superadmin'),
  (req, res, next) => transformerAliasController.delete(req, res, next),
);

module.exports = router;
