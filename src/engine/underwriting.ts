import type {
  ApplicantPayload, BureauResult, CreditTier, EarningsMetrics, LoanOffer, TenureMonths, UnderwritingResult,
} from './types';
import { clamp, lerp01, mean, median, money, stdev } from './math';
import { stageOf } from './graduation';

export const WEEKS_BY_TENURE: Record<TenureMonths, number> = { 3: 13, 6: 26, 12: 52 };

/** Per-tier product terms. Deduction 9–10 % of weekly payout; collection cap 15–30 %. */
export const TIER_TERMS: Record<CreditTier, { aprPct: number; deductionRatePct: number; weeklyCapPct: number }> = {
  A: { aprPct: 16, deductionRatePct: 10,  weeklyCapPct: 30 },
  B: { aprPct: 20, deductionRatePct: 9.5, weeklyCapPct: 22 },
  C: { aprPct: 24, deductionRatePct: 9,   weeklyCapPct: 15 },
};

export const POLICY = {
  minHistoryWeeks: 26,
  minPlatformTenureMonths: 6,
  minActiveWeekRatio: 0.75,
  minAvgWeekly: 350,
  minRating: 4.0,
  maxCancellationRate: 0.25,
  minCtos: 450,
  referCtos: 520,
  tierA: 75,
  tierB: 60,
  tierC: 45,
};

export function earningsMetrics(p: Pick<ApplicantPayload, 'weeklyPayouts' | 'weeklyActiveDays'>): EarningsMetrics {
  const w = p.weeklyPayouts;
  const avg = mean(w);
  const last8 = w.slice(-8), prior = w.slice(0, -8);
  return {
    weeks: w.length,
    avgWeekly: money(avg),
    medianWeekly: money(median(w)),
    cv: avg > 0 ? stdev(w) / avg : 9,
    activeWeekRatio: w.length ? w.filter((x) => x > 0).length / w.length : 0,
    avgActiveDays: mean(p.weeklyActiveDays),
    trend: prior.length && mean(prior) > 0 ? mean(last8) / mean(prior) : 1,
  };
}

/** 0–100 alternative-data score: earnings level, stability, consistency, activity, quality, tenure. */
export function altScore(p: ApplicantPayload, m = earningsMetrics(p)): number {
  const level = 30 * lerp01(m.avgWeekly, 400, 1500);
  const stability = 25 * (1 - lerp01(m.cv, 0.15, 0.8));
  const consistency = 20 * lerp01(m.activeWeekRatio, 0.6, 1);
  const activity = 10 * lerp01(m.avgActiveDays, 3, 6);
  const quality = 10 * lerp01(p.avgRating, 4.0, 4.9) * (1 - lerp01(p.cancellationRate, 0.05, 0.25) * 0.5);
  const tenure = 5 * lerp01(p.platformTenureMonths, 6, 24);
  const trendAdj = clamp((m.trend - 1) * 10, -5, 3); // falling income hurts more than rising helps
  return clamp(level + stability + consistency + activity + quality + tenure + trendAdj, 0, 100);
}

export const tierFor = (score: number): CreditTier | null =>
  score >= POLICY.tierA ? 'A' : score >= POLICY.tierB ? 'B' : score >= POLICY.tierC ? 'C' : null;

/** Weekly annuity payment for principal P at weekly rate r over n weeks. */
export function annuityPayment(principal: number, aprPct: number, weeks: number) {
  const r = aprPct / 100 / 52;
  return r === 0 ? principal / weeks : (principal * r) / (1 - Math.pow(1 + r, -weeks));
}
export function annuityPrincipal(payment: number, aprPct: number, weeks: number) {
  const r = aprPct / 100 / 52;
  return r === 0 ? payment * weeks : (payment * (1 - Math.pow(1 + r, -weeks))) / r;
}

/**
 * Size an offer. Installment target = deduction-rate × trailing-6m mean weekly
 * payout; principal is the PV of that stream, floored to RM50 and bounded by the
 * facility-stage cap and the borrower's requested amount.
 */
export function sizeOffer(opts: {
  tier: CreditTier; avgWeekly: number; tenureMonths: TenureMonths; stage?: number; requestedAmount?: number;
}): LoanOffer | null {
  const stage = stageOf(opts.stage ?? 1);
  if (!stage.tenures.includes(opts.tenureMonths)) return null;
  const t = TIER_TERMS[opts.tier];
  const weeks = WEEKS_BY_TENURE[opts.tenureMonths];
  const targetInstallment = (t.deductionRatePct / 100) * opts.avgWeekly;
  const capacity = annuityPrincipal(targetInstallment, t.aprPct, weeks);
  let principal = Math.floor(Math.min(capacity, stage.maxPrincipal, opts.requestedAmount ?? Infinity) / 50) * 50;
  if (principal < 500) return null;
  const installment = Math.ceil(annuityPayment(principal, t.aprPct, weeks) * 100) / 100;
  return {
    principal,
    tenureMonths: opts.tenureMonths,
    weeks,
    aprPct: t.aprPct,
    weeklyInstallment: money(installment),
    deductionRatePct: t.deductionRatePct,
    weeklyCapPct: t.weeklyCapPct,
    totalRepayable: money(installment * weeks),
    stage: stage.stage,
  };
}

export interface UnderwriteContext {
  bureau?: BureauResult;
  identityVerified?: boolean;
  stage?: number;
}

export function underwrite(p: ApplicantPayload, ctx: UnderwriteContext = {}): UnderwritingResult {
  const metrics = earningsMetrics(p);
  const score = altScore(p, metrics);
  const reasons: string[] = [];
  const decline: string[] = [];
  const refer: string[] = [];

  if (p.weeklyPayouts.length < POLICY.minHistoryWeeks) decline.push(`Needs ${POLICY.minHistoryWeeks} weeks of payout history (got ${p.weeklyPayouts.length})`);
  if (p.platformTenureMonths < POLICY.minPlatformTenureMonths) decline.push(`Platform tenure < ${POLICY.minPlatformTenureMonths} months`);
  if (metrics.activeWeekRatio < POLICY.minActiveWeekRatio) decline.push(`Active weeks ${(metrics.activeWeekRatio * 100).toFixed(0)}% < ${POLICY.minActiveWeekRatio * 100}%`);
  if (metrics.avgWeekly < POLICY.minAvgWeekly) decline.push(`Avg weekly payout RM${metrics.avgWeekly} < RM${POLICY.minAvgWeekly}`);
  if (p.avgRating < POLICY.minRating) decline.push(`Rating ${p.avgRating} < ${POLICY.minRating}`);
  if (p.cancellationRate > POLICY.maxCancellationRate) decline.push(`Cancellation rate ${(p.cancellationRate * 100).toFixed(0)}% too high`);
  if (ctx.identityVerified === false) decline.push('Identity verification failed');

  if (ctx.bureau) {
    const b = ctx.bureau;
    if (b.bankruptcyFlag) decline.push('Bankruptcy flag (CTOS)');
    if (b.ccrisWorstArrearsMonths > 3) decline.push(`CCRIS worst arrears ${b.ccrisWorstArrearsMonths} months`);
    if (b.ctosScore < POLICY.minCtos) decline.push(`CTOS score ${b.ctosScore} < ${POLICY.minCtos}`);
    else if (b.ctosScore < POLICY.referCtos) refer.push(`CTOS score ${b.ctosScore} in manual-review band`);
    if (b.ccrisWorstArrearsMonths > 1 && b.ccrisWorstArrearsMonths <= 3) refer.push('CCRIS recent minor arrears');
  }

  const tier = tierFor(score);
  if (!tier) decline.push(`Alt-score ${score.toFixed(0)} below minimum ${POLICY.tierC}`);

  if (decline.length) return { decision: 'DECLINED', score, tier, metrics, reasons: decline };
  if (refer.length) return { decision: 'REFER', score, tier, metrics, reasons: refer };

  const offer = sizeOffer({
    tier: tier!, avgWeekly: metrics.avgWeekly, tenureMonths: p.requestedTenureMonths,
    stage: ctx.stage ?? 1, requestedAmount: p.requestedAmount,
  });
  if (!offer) return { decision: 'DECLINED', score, tier, metrics, reasons: ['No viable offer for requested tenure / capacity'] };
  reasons.push(`Tier ${tier} (score ${score.toFixed(0)})`, `Installment ≈ ${offer.deductionRatePct}% of RM${metrics.avgWeekly} avg weekly payout`);
  return { decision: 'APPROVED', score, tier, metrics, reasons, offer };
}
