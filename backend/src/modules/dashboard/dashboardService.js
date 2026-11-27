const transformerService = require('../transformers/transformerService');
const Customer = require('../customers/customerModel');
const GuestVisit = require('../guests/guestModel');
const AppError = require('../../shared/errors/AppError');

const DASHBOARD_ANOMALY_LIMIT = 5;

function normalizePeriod(value) {
  const period = typeof value === 'string' ? value.trim().toLowerCase() : 'wbp';
  if (!['wbp', 'lwbp'].includes(period)) {
    throw new AppError(
      'Permintaan tidak valid.',
      422,
      [{ path: 'period', code: 'VALIDATION_ERROR', message: 'period hanya boleh WBP atau LWBP.' }],
      'VALIDATION_ERROR',
    );
  }
  return period;
}

class DashboardService {
  async getSummary(period = 'wbp') {
    const normalizedPeriod = normalizePeriod(period);
    const comparisonPeriod = normalizedPeriod === 'wbp' ? 'lwbp' : 'wbp';

    const [
      selected,
      comparison,
      customerTotal,
      guestTotal,
      featureCollection,
      unbalanced,
      overloaded,
    ] = await Promise.all([
      transformerService.getTransformers({
        page: 1,
        pageSize: 1,
        category: 'all',
        period: normalizedPeriod,
      }),
      transformerService.getTransformers({
        page: 1,
        pageSize: 1,
        category: 'all',
        period: comparisonPeriod,
      }),
      Customer.countDocuments(),
      GuestVisit.countDocuments(),
      transformerService.getMapPoints(normalizedPeriod),
      transformerService.getTransformers({
        page: 1,
        pageSize: DASHBOARD_ANOMALY_LIMIT,
        category: 'unbalanced',
        period: normalizedPeriod,
      }),
      transformerService.getTransformers({
        page: 1,
        pageSize: DASHBOARD_ANOMALY_LIMIT,
        category: 'overloaded',
        period: normalizedPeriod,
      }),
    ]);

    const periodCounts = {
      wbp: null,
      lwbp: null,
    };
    periodCounts[normalizedPeriod] = {
      unbalance: selected.counts.pincang,
      overload: selected.counts.overload,
      analyzable: selected.counts.analyzable,
      notAnalyzable: selected.counts.notAnalyzable,
    };
    periodCounts[comparisonPeriod] = {
      unbalance: comparison.counts.pincang,
      overload: comparison.counts.overload,
      analyzable: comparison.counts.analyzable,
      notAnalyzable: comparison.counts.notAnalyzable,
    };

    const transformerTotal = selected.counts.total;
    const summary = {
      transformerTotal,
      unbalancedTotal: selected.counts.pincang,
      overloadedTotal: selected.counts.overload,
      analyzableTotal: selected.counts.analyzable,
      notAnalyzableTotal: selected.counts.notAnalyzable,
      customerTotal,
      guestTotal,
    };

    return {
      period: normalizedPeriod,
      summary,
      anomalies: {
        unbalanced: unbalanced.items,
        overloaded: overloaded.items,
      },
      mapPoints: featureCollection.features,
      mapFeatureCollection: featureCollection,
      transformerTotal,
      customerTotal,
      guestTotal,
      transformers: {
        total: transformerTotal,
        periods: periodCounts,
      },
      customers: {
        total: customerTotal,
      },
      guests: {
        total: guestTotal,
      },
      pincangList: unbalanced.items,
      overloadList: overloaded.items,
    };
  }
}

module.exports = new DashboardService();
