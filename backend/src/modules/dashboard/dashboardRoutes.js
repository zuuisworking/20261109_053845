const express = require('express');
const router = express.Router();
const dashboardController = require('./dashboardController');
const { authMiddleware } = require('../../middlewares/authMiddleware');

router.use(authMiddleware);

router.get('/', (req, res, next) => dashboardController.getSummary(req, res, next));

module.exports = router;
