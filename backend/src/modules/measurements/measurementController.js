const measurementService = require('./measurementService');

class MeasurementController {
  async getMeasurements(req, res, next) {
    try {
      const data = await measurementService.getMeasurementsByTransformerId(req.params.transformerId);
      res.status(200).json({ data });
    } catch (err) {
      next(err);
    }
  }

  async saveMeasurement(req, res, next) {
    try {
      const saved = await measurementService.saveMeasurement(req.params.transformerId, req.body);
      res.status(200).json({ data: saved });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new MeasurementController();
