import type { Analysis, Period, Transformer } from '../../types';

export function getTransformerAnalysis(
  transformer: Transformer,
  period: Period,
): Partial<Analysis> | null {
  const analysis = transformer.analysis;
  if (!analysis) return null;
  if ('wbp' in analysis || 'lwbp' in analysis) {
    const analysisByPeriod = analysis as Partial<Record<Period, Analysis>>;
    return analysisByPeriod[period] ?? null;
  }
  return analysis as Partial<Analysis>;
}

function deriveRecommendationStatus(
  available: boolean,
  overloaded: boolean,
  unbalancePercent: number | null,
  neutralCurrent: number | null,
): NonNullable<Analysis['recommendationStatus']> {
  if (!available) return 'unknown';
  if (
    overloaded ||
    (unbalancePercent !== null && unbalancePercent > 15) ||
    (neutralCurrent !== null && neutralCurrent > 40)
  ) {
    return 'critical';
  }
  if (unbalancePercent !== null && unbalancePercent > 10) return 'warning';
  return 'normal';
}

function deriveVisualStatus(
  available: boolean,
  unbalancePercent: number | null,
): NonNullable<Analysis['visualStatus']> {
  if (!available) return 'unknown';
  if (unbalancePercent !== null && unbalancePercent > 20) return 'critical';
  if (unbalancePercent !== null && unbalancePercent > 10) return 'warning';
  return 'normal';
}

export function getAnalysisPresentation(analysis: Partial<Analysis> | null): Analysis | null {
  if (!analysis) return null;

  const loadingPercent = analysis.loadingPercent ?? null;
  const averageCurrent = analysis.averageCurrent ?? analysis.iAvg ?? null;
  const unbalancePercent = analysis.unbalancePercent ?? analysis.unbalance ?? null;
  const nominalCurrent = analysis.nominalCurrent ?? analysis.nominalA ?? null;
  const neutralCurrent = analysis.neutralCurrent ?? analysis.inVal ?? null;
  const available =
    analysis.available ??
    analysis.isApplicable ??
    (unbalancePercent !== null || loadingPercent !== null);
  const overloaded =
    analysis.overloaded ??
    analysis.isOverload ??
    (loadingPercent !== null && loadingPercent > 80);
  const isPincang =
    analysis.isPincang ?? (unbalancePercent !== null && unbalancePercent > 10);
  const recommendationStatus =
    analysis.recommendationStatus ??
    deriveRecommendationStatus(
      available,
      overloaded,
      unbalancePercent,
      neutralCurrent,
    );
  const visualStatus =
    analysis.visualStatus ?? deriveVisualStatus(available, unbalancePercent);

  const labelStatus =
    analysis.labelStatus ||
    (overloaded
      ? 'Overload'
      : recommendationStatus === 'critical'
        ? 'Kritis'
        : recommendationStatus === 'warning'
          ? 'Peringatan'
          : available
            ? 'Normal'
            : 'Belum Dapat Dinilai');
  const badgeClass =
    analysis.badgeClass ||
    (overloaded
      ? 'bg-red-100 text-red-700'
      : recommendationStatus === 'critical'
        ? 'bg-red-100 text-red-700'
        : recommendationStatus === 'warning'
          ? 'bg-amber-100 text-amber-700'
          : available
            ? 'bg-emerald-100 text-emerald-700'
            : 'bg-gray-100 text-gray-600');
  const rekomendasi =
    analysis.rekomendasi ||
    (overloaded
      ? 'Disarankan melakukan up-rating kapasitas atau pelimpahan beban.'
      : recommendationStatus === 'critical'
        ? 'Prioritas tinggi: lakukan pemerataan beban fasa segera.'
        : recommendationStatus === 'warning'
          ? 'Pantau ketidakseimbangan fasa dan lakukan perbaikan bila meningkat.'
          : available
            ? 'Kondisi pembebanan masih dalam batas aman.'
            : 'Data analisis belum tersedia.');

  return {
    period: analysis.period ?? 'wbp',
    ir: analysis.ir ?? null,
    is: analysis.is ?? null,
    it: analysis.it ?? null,
    inVal: neutralCurrent,
    iAvg: averageCurrent,
    nominalA: nominalCurrent,
    kva: analysis.kva ?? null,
    unbalance: unbalancePercent,
    loadingPercent,
    isPincang,
    isOverload: overloaded,
    available,
    averageCurrent,
    unbalancePercent,
    nominalCurrent,
    neutralCurrent,
    visualStatus,
    recommendationStatus,
    overloaded,
    isApplicable: available,
    loadingApplicable: analysis.loadingApplicable ?? loadingPercent !== null,
    labelStatus,
    badgeClass,
    rekomendasi,
  };
}
