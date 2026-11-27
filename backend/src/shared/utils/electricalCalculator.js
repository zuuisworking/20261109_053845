/**
 * Perhitungan analisis kelistrikan incoming trafo distribusi.
 *
 * Aturan business boundary bersifat strict:
 * - Pincang: ketidakseimbangan > 10%.
 * - Overload: pembebanan > 80%.
 * - Rekomendasi kritis: ketidakseimbangan > 15% ATAU arus neutral > 40 A.
 * - Level visual unbalance: warning > 10%, critical > 20%.
 *
 * Analisis hanya berlaku bila arus incoming R/S/T tersedia, valid, memiliki
 * rata-rata positif, dan kapasitas kVA positif. Data yang tidak lengkap tetap
 * boleh disimpan, tetapi tidak menghasilkan status anomal atau nilai turunan.
 */

const { MAX_CAPACITY_KVA, MAX_CURRENT_AMPS } = require('../constants/domainLimits');

const STATUS_BADGE = Object.freeze({
  normal: 'bg-green-100 text-green-700 border border-green-200',
  warning: 'bg-amber-100 text-amber-700 border border-amber-200 font-semibold',
  critical: 'bg-rose-100 text-rose-700 border border-rose-200 font-bold',
  overload: 'bg-red-100 text-red-700 border border-red-200 font-bold',
  unavailable: 'bg-gray-100 text-gray-600 border border-gray-200',
});

const UNBALANCE_BADGE = Object.freeze({
  normal: 'bg-green-100 text-green-700 border border-green-200',
  warning: 'bg-amber-100 text-amber-700 border border-amber-200 font-semibold',
  critical: 'bg-rose-100 text-rose-700 border border-rose-200 font-bold',
  not_available: 'bg-gray-100 text-gray-500 border border-gray-200',
});

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function round2(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 100) / 100;
  return Number.isFinite(rounded) ? rounded : null;
}

function assessElectricalEligibility(incoming = {}, capacityKva = null) {
  const ir = toFiniteNumber(incoming?.r);
  const is = toFiniteNumber(incoming?.s);
  const it = toFiniteNumber(incoming?.t);
  const inVal = toFiniteNumber(incoming?.n);

  const hasIncoming = ir !== null && is !== null && it !== null;
  const hasValidIncoming =
    hasIncoming &&
    ir >= 0 &&
    is >= 0 &&
    it >= 0 &&
    ir <= MAX_CURRENT_AMPS &&
    is <= MAX_CURRENT_AMPS &&
    it <= MAX_CURRENT_AMPS;
  const iAvg = hasValidIncoming ? (ir + is + it) / 3 : null;
  const hasFiniteAverage = iAvg !== null && Number.isFinite(iAvg);
  const hasPositiveAverage = hasFiniteAverage && iAvg > 0;

  const parsedKva = toFiniteNumber(capacityKva);
  const kva =
    parsedKva !== null && parsedKva > 0 && parsedKva <= MAX_CAPACITY_KVA
      ? parsedKva
      : null;
  const hasCapacity = kva !== null;
  const hasNeutralCurrent =
    inVal !== null && inVal >= 0 && inVal <= MAX_CURRENT_AMPS;

  return {
    ir,
    is,
    it,
    inVal,
    iAvg,
    kva,
    hasIncoming,
    hasValidIncoming,
    hasPositiveAverage,
    hasCapacity,
    hasNeutralCurrent,
    isApplicable: hasValidIncoming && hasPositiveAverage && hasCapacity,
  };
}

function calculateIncomingAnalysis(
  incoming = {},
  capacityKva = null,
  period = 'wbp',
  voltage = null,
) {
  const eligibility = assessElectricalEligibility(incoming, capacityKva);
  const {
    ir,
    is,
    it,
    inVal,
    kva,
    hasIncoming,
    hasValidIncoming,
    hasPositiveAverage,
    hasCapacity,
    hasNeutralCurrent,
  } = eligibility;
  let isApplicable = eligibility.isApplicable;

  const vr = toFiniteNumber(voltage?.r);
  const vs = toFiniteNumber(voltage?.s);
  const vt = toFiniteNumber(voltage?.t);
  const hasVoltage = vr !== null && vs !== null && vt !== null && vr > 0 && vs > 0 && vt > 0;

  let maxDiff = null;
  let unbalance = null;
  let nominalA = null;
  let loadingPercent = null;

  if (isApplicable) {
    const iAvg = eligibility.iAvg;
    maxDiff = Math.max(Math.abs(ir - iAvg), Math.abs(is - iAvg), Math.abs(it - iAvg));
    unbalance = (maxDiff / iAvg) * 100;
    nominalA = (kva * 1000) / (Math.sqrt(3) * 400);
    loadingPercent = (iAvg / nominalA) * 100;

    // Fail closed if any derived value is not finite or is otherwise outside
    // the operational domain. Invalid legacy data must never be reported as a
    // normal (safe) transformer merely because a comparison happened to be
    // false for NaN or Infinity.
    if (
      !Number.isFinite(maxDiff) ||
      !Number.isFinite(unbalance) ||
      !Number.isFinite(nominalA) ||
      !Number.isFinite(loadingPercent) ||
      nominalA <= 0 ||
      loadingPercent < 0
    ) {
      isApplicable = false;
      maxDiff = null;
      unbalance = null;
      nominalA = null;
      loadingPercent = null;
    }
  }

  const isPincang = isApplicable && unbalance > 10;
  const isOverload = isApplicable && loadingPercent > 80;

  let unbalanceLevel = 'not_available';
  let unbalanceLabel = 'Tidak tersedia';
  if (isApplicable) {
    if (unbalance > 20) {
      unbalanceLevel = 'critical';
      unbalanceLabel = 'Kritis';
    } else if (unbalance > 10) {
      unbalanceLevel = 'warning';
      unbalanceLabel = 'Waspada';
    } else {
      unbalanceLevel = 'normal';
      unbalanceLabel = 'Normal';
    }
  }

  let status = 'not_applicable';
  let labelStatus = 'Belum Dapat Dinilai';
  let badgeClass = STATUS_BADGE.unavailable;
  let rekomendasi =
    'Data pengukuran wajib belum lengkap atau valid, sehingga kondisi beban belum dapat dinilai.';

  if (isApplicable) {
    if (isOverload) {
      status = 'overload';
      labelStatus = 'Overload';
      badgeClass = STATUS_BADGE.overload;
      rekomendasi = 'Perlu mutasi / up-rating trafo atau pelimpahan beban fasa keluar.';
    } else if (unbalance > 15 || (hasNeutralCurrent && inVal > 40)) {
      status = 'critical';
      labelStatus = 'Kritis';
      badgeClass = STATUS_BADGE.critical;
      rekomendasi = 'Pemerataan fasa mendesak dan perbaikan koneksi grounding.';
    } else if (isPincang) {
      status = 'warning';
      labelStatus = 'Waspada';
      badgeClass = STATUS_BADGE.warning;
      rekomendasi = 'Pemerataan beban antar jurusan direkomendasikan pada pemeliharaan rutin.';
    } else {
      status = 'normal';
      labelStatus = 'Aman';
      badgeClass = STATUS_BADGE.normal;
      rekomendasi = 'Kondisi beban dan keseimbangan fasa dalam batas aman operasional.';
    }
  }

  const recommendationStatus = !isApplicable
    ? 'unknown'
    : isOverload || unbalance > 15 || (hasNeutralCurrent && inVal > 40)
      ? 'critical'
      : unbalance > 10
        ? 'warning'
        : 'normal';
  const visualStatus = isApplicable ? unbalanceLevel : 'unknown';

  return {
    period,
    ir,
    is,
    it,
    inVal,
    vr,
    vs,
    vt,
    available: isApplicable,
    averageCurrent: isApplicable ? round2(eligibility.iAvg) : null,
    unbalancePercent: isApplicable ? round2(unbalance) : null,
    nominalCurrent: isApplicable ? round2(nominalA) : null,
    neutralCurrent: hasNeutralCurrent ? inVal : null,
    visualStatus,
    recommendationStatus,
    overloaded: isApplicable ? isOverload : null,
    iAvg: round2(eligibility.iAvg),
    maxDiff: round2(maxDiff),
    nominalA: round2(nominalA),
    kva,
    unbalance: round2(unbalance),
    loadingPercent: round2(loadingPercent),
    isPincang,
    isOverload,
    hasIncoming,
    hasValidIncoming,
    hasPositiveAverage,
    hasVoltage,
    hasNeutralCurrent,
    hasCapacity,
    isApplicable,
    loadingApplicable: isApplicable,
    status,
    labelStatus,
    badgeClass,
    rekomendasi,
    unbalanceLevel,
    unbalanceLabel,
    unbalanceBadgeClass: UNBALANCE_BADGE[unbalanceLevel],
  };
}

module.exports = {
  assessElectricalEligibility,
  calculateIncomingAnalysis,
};
