const express = require('express');
const router = express.Router();
const transformerController = require('./transformerController');
const { authMiddleware, requireRole } = require('../../middlewares/authMiddleware');
const { validateRequest, transformerWriteSchema } = require('../../shared/validation');

router.use(authMiddleware);

router.get('/', (req, res, next) => transformerController.getTransformers(req, res, next));
router.get('/map-points', (req, res, next) => transformerController.getMapPoints(req, res, next));
router.get('/anomalies', (req, res, next) => transformerController.getAnomalies(req, res, next));
router.get('/:id', (req, res, next) => transformerController.getTransformerById(req, res, next));
router.post(
  '/',
  validateRequest(transformerWriteSchema),
  (req, res, next) => transformerController.createTransformer(req, res, next),
);
router.put(
  '/:id',
  validateRequest(transformerWriteSchema),
  (req, res, next) => transformerController.updateTransformer(req, res, next),
);
router.delete(
  '/:id',
  requireRole('superadmin'),
  (req, res, next) => transformerController.deleteTransformer(req, res, next),
);

module.exports = router;
