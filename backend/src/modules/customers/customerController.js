const customerService = require('./customerService');

class CustomerController {
  async getCustomers(req, res, next) {
    try {
      const result = await customerService.getCustomers(req.query);
      res.status(200).json({
        data: result.items,
        meta: result.meta,
      });
    } catch (err) {
      next(err);
    }
  }

  async getCustomerById(req, res, next) {
    try {
      const cust = await customerService.getCustomerById(req.params.id);
      res.status(200).json({ data: cust });
    } catch (err) {
      next(err);
    }
  }

  async createCustomer(req, res, next) {
    try {
      const newCust = await customerService.createCustomer(req.body);
      res.status(201).json({ data: newCust });
    } catch (err) {
      next(err);
    }
  }

  async updateCustomer(req, res, next) {
    try {
      const updated = await customerService.updateCustomer(req.params.id, req.body);
      res.status(200).json({ data: updated });
    } catch (err) {
      next(err);
    }
  }

  async deleteCustomer(req, res, next) {
    try {
      const result = await customerService.deleteCustomer(req.params.id);
      res.status(200).json({
        data: { id: result.id, deleted: true },
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new CustomerController();
