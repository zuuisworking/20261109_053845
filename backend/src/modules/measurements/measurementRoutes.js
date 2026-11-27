const express = require('express');
const router = express.Router();
const measurementController = require('./measurementController');
const { authMiddleware } = require('../../middlewares/authMiddleware');
const { validateRequest, measurementUpsertSchema } = require('../../shared/validation');
const AppError = require('../../shared/errors/AppError');

router.post('/:transformerId', (req, res, next) => {
  res.set('Allow', 'GET, PUT');
  return next(
    new AppError(
      'Metode POST tidak didukung untuk pengukuran. Gunakan PUT.',
      405,
      null,
      'METHOD_NOT_ALLOWED'
    )
  );
});

router.use(authMiddleware);

router.get('/:transformerId', (req, res, next) => measurementController.getMeasurements(req, res, next));
router.put(
  '/:transformerId',
  validateRequest(measurementUpsertSchema),
  (req, res, next) => measurementController.saveMeasurement(req, res, next)
);

module.exports = router;
