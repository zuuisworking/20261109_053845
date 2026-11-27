const transformerAliasService = require('./transformerAliasService');

class TransformerAliasController {
  async list(req, res, next) {
    try {
      const result = await transformerAliasService.list(req.query);
      res.status(200).json({
        data: result.items,
        meta: result.meta,
      });
    } catch (error) {
      next(error);
    }
  }

  async create(req, res, next) {
    try {
      const alias = await transformerAliasService.create({
        ...req.body,
        approvedBy: req.user._id,
      });
      res.status(201).json({ data: alias });
    } catch (error) {
      next(error);
    }
  }

  async delete(req, res, next) {
    try {
      const alias = await transformerAliasService.delete(req.params.id);
      res.status(200).json({
        data: { id: alias._id.toString(), deleted: true },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new TransformerAliasController();
