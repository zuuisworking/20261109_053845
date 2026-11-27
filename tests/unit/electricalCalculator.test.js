const { calculateIncomingAnalysis } = require('../../backend/src/shared/utils/electricalCalculator');

describe('calculateIncomingAnalysis', () => {
  it('treats unbalance warning as strictly greater than 10 percent', () => {
    const atBoundary = calculateIncomingAnalysis({ r: 22, s: 19, t: 19 }, 100, 'wbp');
    const aboveBoundary = calculateIncomingAnalysis({ r: 23, s: 19, t: 19 }, 100, 'wbp');

    expect(atBoundary.unbalance).toBe(10);
    expect(atBoundary.isPincang).toBe(false);
    expect(atBoundary.unbalanceLevel).toBe('normal');
    expect(atBoundary.status).toBe('normal');

    expect(aboveBoundary.unbalance).toBeGreaterThan(10);
    expect(aboveBoundary.isPincang).toBe(true);
    expect(aboveBoundary.unbalanceLevel).toBe('warning');
    expect(aboveBoundary.status).toBe('warning');
  });

  it('keeps visual critical above 20 and recommendation critical above 15', () => {
    const atRecommendation = calculateIncomingAnalysis({ r: 46, s: 37, t: 37 }, 100, 'wbp');
    const aboveRecommendation = calculateIncomingAnalysis({ r: 47, s: 37, t: 37 }, 100, 'wbp');
    const atVisualCritical = calculateIncomingAnalysis({ r: 80, s: 60, t: 60 }, 100, 'wbp');
    const aboveVisualCritical = calculateIncomingAnalysis({ r: 80, s: 59, t: 59 }, 100, 'wbp');

    expect(atRecommendation.unbalance).toBe(15);
    expect(atRecommendation.status).toBe('warning');
    expect(atRecommendation.unbalanceLevel).toBe('warning');

    expect(aboveRecommendation.unbalance).toBeGreaterThan(15);
    expect(aboveRecommendation.status).toBe('critical');
    expect(aboveRecommendation.unbalanceLevel).toBe('warning');

    expect(atVisualCritical.unbalance).toBe(20);
    expect(atVisualCritical.status).toBe('critical');
    expect(atVisualCritical.unbalanceLevel).toBe('warning');

    expect(aboveVisualCritical.unbalance).toBeGreaterThan(20);
    expect(aboveVisualCritical.status).toBe('critical');
    expect(aboveVisualCritical.unbalanceLevel).toBe('critical');
  });

  it('treats overload as strictly greater than 80 percent and gives it priority', () => {
    const atBoundary = calculateIncomingAnalysis(
      { r: 115.47, s: 115.47, t: 115.47 },
      100,
      'wbp'
    );
    const aboveBoundary = calculateIncomingAnalysis(
      { r: 116, s: 116, t: 116 },
      100,
      'wbp'
    );
    const overloadAndCritical = calculateIncomingAnalysis(
      { r: 140, s: 110, t: 110 },
      100,
      'wbp'
    );

    expect(atBoundary.loadingPercent).toBe(80);
    expect(atBoundary.isOverload).toBe(false);
    expect(atBoundary.status).toBe('normal');

    expect(aboveBoundary.loadingPercent).toBeGreaterThan(80);
    expect(aboveBoundary.isOverload).toBe(true);
    expect(aboveBoundary.status).toBe('overload');

    expect(overloadAndCritical.unbalance).toBeGreaterThan(15);
    expect(overloadAndCritical.loadingPercent).toBeGreaterThan(80);
    expect(overloadAndCritical.status).toBe('overload');
  });

  it('treats neutral current above 40 A as critical but not exactly 40 A', () => {
    const atBoundary = calculateIncomingAnalysis(
      { r: 100, s: 100, t: 100, n: 40 },
      100,
      'lwbp'
    );
    const aboveBoundary = calculateIncomingAnalysis(
      { r: 100, s: 100, t: 100, n: 41 },
      100,
      'lwbp'
    );

    expect(atBoundary.status).toBe('normal');
    expect(aboveBoundary.status).toBe('critical');
  });

  it('returns unavailable analysis for a zero average incoming current', () => {
    const analysis = calculateIncomingAnalysis({ r: 0, s: 0, t: 0, n: 0 }, 100, 'wbp');

    expect(analysis.hasIncoming).toBe(true);
    expect(analysis.iAvg).toBe(0);
    expect(analysis.unbalance).toBeNull();
    expect(analysis.loadingPercent).toBeNull();
    expect(analysis.isApplicable).toBe(false);
    expect(analysis.loadingApplicable).toBe(false);
    expect(analysis.status).toBe('not_applicable');
    expect(analysis.isPincang).toBe(false);
    expect(analysis.isOverload).toBe(false);
  });

  it('does not classify a transformer without valid capacity as unbalanced', () => {
    const analysis = calculateIncomingAnalysis({ r: 100, s: 70, t: 70 }, null, 'wbp');

    expect(analysis.unbalance).toBeNull();
    expect(analysis.loadingPercent).toBeNull();
    expect(analysis.isApplicable).toBe(false);
    expect(analysis.isPincang).toBe(false);
    expect(analysis.isOverload).toBe(false);
    expect(analysis.status).toBe('not_applicable');
  });

  it('keeps a non-zero average analyzable when one phase is zero', () => {
    const analysis = calculateIncomingAnalysis({ r: 0, s: 100, t: 100, n: 0 }, 100, 'wbp');

    expect(analysis.iAvg).toBe(66.67);
    expect(analysis.unbalance).toBe(100);
    expect(analysis.isApplicable).toBe(true);
    expect(analysis.isPincang).toBe(true);
  });

  it('rejects negative phase current and does not fabricate analysis metrics', () => {
    const analysis = calculateIncomingAnalysis({ r: -1, s: 100, t: 100 }, 100, 'wbp');

    expect(analysis.hasIncoming).toBe(true);
    expect(analysis.hasValidIncoming).toBe(false);
    expect(analysis.iAvg).toBeNull();
    expect(analysis.unbalance).toBeNull();
    expect(analysis.loadingPercent).toBeNull();
    expect(analysis.isApplicable).toBe(false);
  });

  it('does not require neutral current for eligibility and does not fabricate it', () => {
    const analysis = calculateIncomingAnalysis({ r: 100, s: 100, t: 100 }, 100, 'wbp');

    expect(analysis.inVal).toBeNull();
    expect(analysis.hasNeutralCurrent).toBe(false);
    expect(analysis.isApplicable).toBe(true);
    expect(analysis.status).toBe('normal');
  });

  it('fails closed for extreme non-finite derived electrical values', () => {
    const analysis = calculateIncomingAnalysis(
      { r: 1e308, s: 1e308, t: 1e308, n: 1e308 },
      1e307,
      'wbp',
    );

    expect(analysis.available).toBe(false);
    expect(analysis.isApplicable).toBe(false);
    expect(analysis.status).toBe('not_applicable');
    expect(analysis.isPincang).toBe(false);
    expect(analysis.isOverload).toBe(false);
    expect(analysis.averageCurrent).toBeNull();
    expect(analysis.unbalancePercent).toBeNull();
    expect(analysis.nominalCurrent).toBeNull();
    expect(analysis.loadingPercent).toBeNull();
    expect(analysis.visualStatus).toBe('unknown');
    expect(analysis.recommendationStatus).toBe('unknown');
    expect(analysis.overloaded).toBeNull();
  });

  it('does not fabricate loading when capacity or incoming data is missing', () => {
    const withoutCapacity = calculateIncomingAnalysis({ r: 100, s: 100, t: 100 }, null, 'wbp');
    const withoutIncoming = calculateIncomingAnalysis({ r: 100, s: null, t: 100 }, 100, 'wbp');

    expect(withoutCapacity.hasIncoming).toBe(true);
    expect(withoutCapacity.hasCapacity).toBe(false);
    expect(withoutCapacity.loadingPercent).toBeNull();
    expect(withoutCapacity.loadingApplicable).toBe(false);
    expect(withoutCapacity.status).toBe('not_applicable');

    expect(withoutIncoming.hasIncoming).toBe(false);
    expect(withoutIncoming.unbalance).toBeNull();
    expect(withoutIncoming.loadingPercent).toBeNull();
  });
});
