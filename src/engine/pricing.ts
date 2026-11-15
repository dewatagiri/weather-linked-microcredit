import type { RegionCode, TenureMonths } from './types';
import { addDays, clamp, money } from './math';
import { localParts } from './weather/window';
import { WEEKS_BY_TENURE } from './underwriting';

/**
 * Probability that a given week contains ≥1 qualifying trigger (heavy rain / flood
 * alert inside the 08:00–19:00 window at a worker's location), by calendar month,
 * for a reference (Klang Valley) region. Peaks in the Oct–Dec inter-monsoon / NE-monsoon.
 * ILLUSTRATIVE — recalibrate from 10-year MET Malaysia / DID data.
 */
export const MONTHLY_WEEKLY_TRIGGER_PROB = [
  /* Jan */ 0.040, /* Feb */ 0.020, /* Mar */ 0.023, /* Apr */ 0.033, /* May */ 0.027, /* Jun */ 0.017,
  /* Jul */ 0.017, /* Aug */ 0.020, /* Sep */ 0.027, /* Oct */ 0.040, /* Nov */ 0.060, /* Dec */ 0.057,
];

export const REGION_FACTOR: Record<RegionCode, number> = {
  KLANG_VALLEY: 1.0, JOHOR: 1.15, PENANG: 0.9, KELANTAN: 1.45,
  TERENGGANU: 1.5, PAHANG: 1.3, SABAH: 1.1, SARAWAK: 1.1,
};

export const GUARANTEE_TERMS = {
  maxClaimsByTenure: { 3: 2, 6: 3, 12: 5 } as Record<TenureMonths, number>,
  waitingPeriodDays: 7,
  /** Share of weather-trigger weeks that survive the window + geofence + online filters. */
  qualifyingShare: 0.5,
  targetLossRatio: 0.65,
  q4OriginationLoading: 1.10, // Oct–Dec originations: adverse selection / peak demand
  minFeePctOfPrincipal: 0.6,
  maxFeePctOfPrincipal: 10,
  minFeeMyr: 12,
};

/** Poisson-binomial: distribution of the number of trigger-weeks among independent weeks. */
function countDistribution(ps: number[], cap: number): number[] {
  let d = new Array(cap + 1).fill(0);
  d[0] = 1;
  for (const p of ps) {
    const nd = new Array(cap + 1).fill(0);
    for (let k = 0; k <= cap; k++) {
      if (!d[k]) continue;
      nd[k] += d[k] * (1 - p);
      nd[Math.min(k + 1, cap)] += d[k] * p; // k+1 beyond cap folds into cap (= claims limit)
    }
    d = nd;
  }
  return d;
}

export interface GuaranteeQuote {
  fee: number;
  feePctOfPrincipal: number;
  expectedClaims: number;
  expectedLoss: number;
  maxClaims: number;
  maxLiability: number;
  seasonalityIndex: number;      // avg exposure over the loan vs annual avg (1.0 = neutral)
  q4Loading: number;
  regionFactor: number;
  originationMonth: number;
  weeklyExposure: { week: number; month: number; prob: number }[];
  capped: 'MIN' | 'MAX' | null;
}

/**
 * Upfront guarantee fee.
 *   weekly p_w = monthProb[month(w)] × regionFactor × qualifyingShare
 *   E[claims]  = E[min(N, maxClaims)],  N ~ PoissonBinomial(p_w)
 *   fee        = E[claims] × installment / targetLossRatio × Q4-origination loading
 * Walking the loan week-by-week means a Nov-origination 3-month loan prices the
 * Nov–Feb monsoon, and a Mar-origination 6-month loan prices Mar–Sep blended.
 */
export function priceGuarantee(opts: {
  principal: number;
  weeklyInstallment: number;
  tenureMonths: TenureMonths;
  originationDate: Date | string;
  region: RegionCode;
  timezone?: string;
}): GuaranteeQuote {
  const T = GUARANTEE_TERMS;
  const tz = opts.timezone ?? 'Asia/Kuala_Lumpur';
  const start = new Date(opts.originationDate);
  const weeks = WEEKS_BY_TENURE[opts.tenureMonths];
  const maxClaims = T.maxClaimsByTenure[opts.tenureMonths];
  const rf = REGION_FACTOR[opts.region];

  const exposure: GuaranteeQuote['weeklyExposure'] = [];
  const startWeek = Math.ceil(T.waitingPeriodDays / 7); // cover only starts after waiting period
  for (let w = startWeek + 1; w <= weeks; w++) {
    const month = localParts(addDays(start, 7 * (w - 1)), tz).month;
    exposure.push({ week: w, month, prob: clamp(MONTHLY_WEEKLY_TRIGGER_PROB[month - 1] * rf * T.qualifyingShare, 0, 0.95) });
  }
  const dist = countDistribution(exposure.map((e) => e.prob), maxClaims);
  const expectedClaims = dist.reduce((a, pk, k) => a + k * pk, 0);
  const expectedLoss = expectedClaims * opts.weeklyInstallment;

  const origMonth = localParts(start, tz).month;
  const q4 = origMonth >= 10 ? T.q4OriginationLoading : 1;
  let fee = (expectedLoss / T.targetLossRatio) * q4;
  const lo = Math.max(T.minFeeMyr, (T.minFeePctOfPrincipal / 100) * opts.principal);
  const hi = (T.maxFeePctOfPrincipal / 100) * opts.principal;
  let capped: GuaranteeQuote['capped'] = null;
  if (fee < lo) { fee = lo; capped = 'MIN'; } else if (fee > hi) { fee = hi; capped = 'MAX'; }

  const annualAvg = MONTHLY_WEEKLY_TRIGGER_PROB.reduce((a, b) => a + b, 0) / 12;
  const avgExposure = exposure.reduce((a, e) => a + e.prob / (rf * T.qualifyingShare), 0) / Math.max(1, exposure.length);

  return {
    fee: money(fee),
    feePctOfPrincipal: money((fee / opts.principal) * 100),
    expectedClaims: Math.round(expectedClaims * 1000) / 1000,
    expectedLoss: money(expectedLoss),
    maxClaims,
    maxLiability: money(maxClaims * opts.weeklyInstallment),
    seasonalityIndex: Math.round((avgExposure / annualAvg) * 100) / 100,
    q4Loading: q4,
    regionFactor: rf,
    originationMonth: origMonth,
    weeklyExposure: exposure,
    capped,
  };
}
