import { describe, expect, it } from 'vitest';
import { getAnalysisPresentation } from '../src/features/transformers/analysis';

describe('Kontrak presentasi analisis kelistrikan', () => {
  it('memisahkan status rekomendasi kritis dan status visual kritis', () => {
    const criticalRecommendation = getAnalysisPresentation({
      period: 'wbp',
      available: true,
      averageCurrent: 100,
      unbalancePercent: 16,
      nominalCurrent: 144,
      neutralCurrent: 0,
      loadingPercent: 70,
      overloaded: false,
      visualStatus: 'warning',
      recommendationStatus: 'critical',
    });

    expect(criticalRecommendation).toMatchObject({
      available: true,
      averageCurrent: 100,
      unbalancePercent: 16,
      nominalCurrent: 144,
      neutralCurrent: 0,
      overloaded: false,
      visualStatus: 'warning',
      recommendationStatus: 'critical',
      labelStatus: 'Kritis',
      isPincang: true,
    });
  });

  it('menurunkan status visual dan rekomendasi dari metrik kanonik', () => {
    const visualCritical = getAnalysisPresentation({
      period: 'lwbp',
      available: true,
      averageCurrent: 100,
      unbalancePercent: 21,
      nominalCurrent: 144,
      neutralCurrent: 0,
      loadingPercent: 70,
    });

    expect(visualCritical).toMatchObject({
      visualStatus: 'critical',
      recommendationStatus: 'critical',
      labelStatus: 'Kritis',
    });
  });

  it('menjaga data yang tidak dapat dinilai tetap unknown', () => {
    const unavailable = getAnalysisPresentation({
      period: 'wbp',
      available: false,
      averageCurrent: null,
      unbalancePercent: null,
      nominalCurrent: null,
      neutralCurrent: null,
      loadingPercent: null,
      overloaded: null,
    });

    expect(unavailable).toMatchObject({
      available: false,
      isApplicable: false,
      isPincang: false,
      isOverload: false,
      overloaded: false,
      visualStatus: 'unknown',
      recommendationStatus: 'unknown',
      labelStatus: 'Belum Dapat Dinilai',
    });
  });
});
