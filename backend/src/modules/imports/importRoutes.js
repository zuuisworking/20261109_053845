const express = require('express');
const router = express.Router();
const multer = require('multer');
const importController = require('./importController');
const { authMiddleware, requireRole } = require('../../middlewares/authMiddleware');
const AppError = require('../../shared/errors/AppError');

const MAX_UPLOAD_SIZE = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_UPLOAD_SIZE,
    files: 1,
    fields: 10,
    parts: 12,
  },
});

function uploadSingleFile(req, res, next) {
  upload.single('file')(req, res, (error) => {
    if (!error) return next();

    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(
          new AppError(
            `Ukuran file melebihi batas ${MAX_UPLOAD_SIZE} byte.`,
            413
          )
        );
      }
      return next(new AppError(`Upload file gagal: ${error.message}`, 400));
    }

    return next(error);
  });
}

router.use(authMiddleware);
router.use(requireRole('admin', 'superadmin'));

router.post('/preview', uploadSingleFile, (req, res, next) =>
  importController.preview(req, res, next)
);
router.post('/commit', (req, res, next) => importController.commit(req, res, next));
router.get('/:importJobId', (req, res, next) => importController.job(req, res, next));
router.get(
  '/:importJobId/rows',
  (req, res, next) => importController.rows(req, res, next)
);
router.get(
  '/:importJobId/issues',
  (req, res, next) => importController.issues(req, res, next)
);

module.exports = router;
