const dashboardService = require('./dashboardService');

class DashboardController {
  async getSummary(req, res, next) {
    try {
      const summary = await dashboardService.getSummary(req.query.period);
      res.status(200).json({ data: summary });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new DashboardController();
