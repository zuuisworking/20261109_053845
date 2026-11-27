const transformerService = require('./transformerService');

class TransformerController {
  async getTransformers(req, res, next) {
    try {
      const result = await transformerService.getTransformers(req.query);
      res.status(200).json({
        data: result.items,
        meta: result.meta,
        counts: result.counts,
      });
    } catch (err) {
      next(err);
    }
  }

  async getMapPoints(req, res, next) {
    try {
      const featureCollection = await transformerService.getMapPoints(req.query.period);
      res.status(200).json({ data: featureCollection });
    } catch (err) {
      next(err);
    }
  }

  async getAnomalies(req, res, next) {
    try {
      const result = await transformerService.getAnomalies(req.query);
      res.status(200).json({
        data: result.items,
        meta: result.meta,
        counts: result.counts,
      });
    } catch (err) {
      next(err);
    }
  }

  async getTransformerById(req, res, next) {
    try {
      const trafo = await transformerService.getTransformerById(req.params.id);
      res.status(200).json({ data: trafo });
    } catch (err) {
      next(err);
    }
  }

  async createTransformer(req, res, next) {
    try {
      const newTrafo = await transformerService.createTransformer(req.body);
      res.status(201).json({ data: newTrafo });
    } catch (err) {
      next(err);
    }
  }

  async updateTransformer(req, res, next) {
    try {
      const updated = await transformerService.updateTransformer(req.params.id, req.body);
      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  async deleteTransformer(req, res, next) {
    try {
      const result = await transformerService.deleteTransformer(req.params.id);
      res.status(200).json({
        data: { id: result.id, deleted: true },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new TransformerController();
