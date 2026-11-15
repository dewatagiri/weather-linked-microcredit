import { describe, it, expect } from 'vitest';
import { priceGuarantee } from '@/engine';

const q = (month: string, tenure: 3 | 6 | 12, region: any = 'KLANG_VALLEY') =>
  priceGuarantee({ principal: 2400, weeklyInstallment: tenure === 3 ? 195 : 105, tenureMonths: tenure, originationDate: `2026-${month}-10T02:00:00Z`, region });

describe('seasonality-adjusted guarantee pricing', () => {
  it('Q4 (monsoon) origination costs materially more than a dry-season origination of the same loan', () => {
    const nov = q('11', 3), may = q('05', 3), jun = q('06', 3);
    expect(nov.fee).toBeGreaterThan(may.fee * 1.3);
    expect(nov.fee).toBeGreaterThan(jun.fee * 1.5);
    expect(nov.seasonalityIndex).toBeGreaterThan(1.2);
    expect(jun.seasonalityIndex).toBeLessThan(1);
    expect(nov.q4Loading).toBe(1.1);
    expect(may.q4Loading).toBe(1);
  });
  it('tenure matters: 6-month carries more expected claims and a larger max liability than 3-month', () => {
    const a = q('03', 3), b = q('03', 6);
    expect(b.expectedClaims).toBeGreaterThan(a.expectedClaims);
    expect(b.maxClaims).toBeGreaterThan(a.maxClaims);
  });
  it('a 6-month loan originated in June is still exposed to the Q4 monsoon late in tenure', () => {
    const jun6 = q('06', 6), jun3 = q('06', 3);
    expect(jun6.weeklyExposure.some((e) => e.month >= 10)).toBe(true);
    expect(jun3.weeklyExposure.every((e) => e.month < 10)).toBe(true);
  });
  it('East-coast regions are dearer than Penang', () => {
    expect(q('11', 3, 'TERENGGANU').fee).toBeGreaterThan(q('11', 3, 'PENANG').fee);
  });
  it('expected claims never exceed max claims; fee is within min/max guard rails and rounded to sen', () => {
    for (const m of ['01', '04', '07', '11']) for (const t of [3, 6, 12] as const) {
      const r = q(m, t);
      expect(r.expectedClaims).toBeLessThanOrEqual(r.maxClaims);
      expect(r.feePctOfPrincipal).toBeGreaterThanOrEqual(0.59);
      expect(r.feePctOfPrincipal).toBeLessThanOrEqual(10.01);
      expect(Math.round(r.fee * 100)).toBeCloseTo(r.fee * 100, 6);
    }
  });
  it('fee equals expected loss / target loss ratio × Q4 loading when no guard rail binds', () => {
    const r = priceGuarantee({ principal: 4000, weeklyInstallment: 300, tenureMonths: 3, originationDate: '2026-11-10T02:00:00Z', region: 'KLANG_VALLEY' });
    expect(r.capped).toBeNull();
    expect(r.fee).toBeCloseTo((r.expectedLoss / 0.65) * 1.1, 1);
  });
});
