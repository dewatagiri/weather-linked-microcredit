import { describe, it, expect } from 'vitest';
import { underwrite, sizeOffer, annuityPayment, earningsMetrics, TIER_TERMS } from '@/engine';
import { applicant } from './helpers';

describe('underwriting', () => {
  it('approves a strong earner and sizes the installment at the tier deduction rate (9–10%)', () => {
    const r = underwrite(applicant({ weekly: 1200 }));
    expect(r.decision).toBe('APPROVED');
    const o = r.offer!;
    expect(o.deductionRatePct).toBeGreaterThanOrEqual(9);
    expect(o.deductionRatePct).toBeLessThanOrEqual(10);
    // installment never exceeds the deduction rate share of avg weekly by more than rounding of principal
    expect(o.weeklyInstallment).toBeLessThanOrEqual((o.deductionRatePct / 100) * r.metrics.avgWeekly + 0.5);
    expect(o.weeklyCapPct).toBeGreaterThanOrEqual(15);
    expect(o.weeklyCapPct).toBeLessThanOrEqual(30);
    expect(o.principal % 50).toBe(0);
  });

  it('declines on thin / inconsistent earnings and says why', () => {
    const r = underwrite(applicant({ weekly: 250 }));
    expect(r.decision).toBe('DECLINED');
    expect(r.reasons.join(' ')).toMatch(/Avg weekly payout/);
    const gaps = applicant({ weekly: 900 });
    gaps.weeklyPayouts = gaps.weeklyPayouts.map((x, i) => (i % 3 === 0 ? 0 : x));
    expect(underwrite(gaps).reasons.join(' ')).toMatch(/Active weeks/);
  });

  it('requires 26 weeks of history and 6 months tenure', () => {
    const r = underwrite(applicant({ weeklyPayouts: Array(12).fill(900), platformTenureMonths: 3 }));
    expect(r.decision).toBe('DECLINED');
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it('applies bureau gates: decline on bad CCRIS, refer on borderline CTOS', () => {
    const bad = underwrite(applicant(), { bureau: { ctosScore: 700, ccrisWorstArrearsMonths: 5, ccrisActiveFacilities: 1, bankruptcyFlag: false } });
    expect(bad.decision).toBe('DECLINED');
    const mid = underwrite(applicant(), { bureau: { ctosScore: 490, ccrisWorstArrearsMonths: 0, ccrisActiveFacilities: 1, bankruptcyFlag: false } });
    expect(mid.decision).toBe('REFER');
  });

  it('caps principal at the stage-1 limit and honours requested amount', () => {
    const big = sizeOffer({ tier: 'A', avgWeekly: 5000, tenureMonths: 6, stage: 1 })!;
    expect(big.principal).toBe(4000);
    const asked = sizeOffer({ tier: 'A', avgWeekly: 5000, tenureMonths: 6, stage: 1, requestedAmount: 1500 })!;
    expect(asked.principal).toBe(1500);
  });

  it('rejects tenures outside the facility stage (12m not allowed at stage 1)', () => {
    expect(sizeOffer({ tier: 'A', avgWeekly: 1500, tenureMonths: 12, stage: 1 })).toBeNull();
    expect(sizeOffer({ tier: 'A', avgWeekly: 1500, tenureMonths: 12, stage: 2 })).not.toBeNull();
  });

  it('higher tiers get lower APR and a higher collection cap', () => {
    expect(TIER_TERMS.A.aprPct).toBeLessThan(TIER_TERMS.C.aprPct);
    expect(TIER_TERMS.A.weeklyCapPct).toBeGreaterThan(TIER_TERMS.C.weeklyCapPct);
  });

  it('annuity payment amortises to ~0 and metrics are sane', () => {
    expect(annuityPayment(1300, 0, 13)).toBeCloseTo(100);
    const m = earningsMetrics(applicant({ weekly: 1000 }));
    expect(m.activeWeekRatio).toBe(1);
    expect(m.cv).toBeLessThan(0.1);
  });
});
