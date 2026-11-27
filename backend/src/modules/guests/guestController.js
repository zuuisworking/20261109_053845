const guestService = require('./guestService');

class GuestController {
  async getGuests(req, res, next) {
    try {
      const result = await guestService.getGuests(req.query);
      res.status(200).json({
        data: result.items,
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }

  async syncGuests(req, res, next) {
    try {
      // Client-provided URLs are ignored. The upstream URL is server-only and
      // is always read from config.googleFormUrl.
      const result = await guestService.syncFromGoogleForm();
      res.status(200).json({ data: result });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new GuestController();
