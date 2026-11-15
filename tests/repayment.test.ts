import { describe, it, expect } from 'vitest';
import { buildSchedule, computeWeeklyCollection, simulateCollections, daysPastDue } from '@/engine';

const params = { deductionRatePct: 9.5, weeklyCapPct: 22, trailingAvgWeekly: 1000 };

describe('repayment schedule', () => {
  const s = buildSchedule({ principal: 2000, aprPct: 20, weeks: 26, firstDueDate: new Date('2026-12-07') });
  it('amortises exactly to zero with 26 weekly rows 7 days apart', () => {
    expect(s).toHaveLength(26);
    expect(s.at(-1)!.balanceAfter).toBe(0);
    expect(s[1].dueDate).toBe('2026-12-14');
    const principal = s.reduce((a, r) => a + r.principalDue, 0);
    expect(principal).toBeCloseTo(2000, 2);
  });
});

describe('fractionalised weekly collection', () => {
  it('collects the full installment in a normal week; effective deduction ≈ 9–10%', () => {
    const c = computeWeeklyCollection({ payout: 1000, installment: 95, arrearsIn: 0, params });
    expect(c.collected).toBe(95);
    expect(c.shortfall).toBe(0);
    expect(c.effectivePct).toBeCloseTo(9.5);
    expect(c.fractionalTarget).toBe(95);
  });
  it('never takes more than cap% of the weekly payout in a slow week; shortfall → arrears', () => {
    const c = computeWeeklyCollection({ payout: 200, installment: 95, arrearsIn: 0, params });
    expect(c.ceiling).toBe(44);
    expect(c.collected).toBe(44);
    expect(c.shortfall).toBe(51);
  });
  it('windfall weeks are capped against the trailing average, not the spike', () => {
    const c = computeWeeklyCollection({ payout: 5000, installment: 95, arrearsIn: 400, params });
    expect(c.ceiling).toBe(220); // 22% × min(5000, 1000)
    expect(c.collected).toBe(220);
    expect(c.shortfall).toBe(275);
  });
  it('zero payout collects nothing', () => {
    expect(computeWeeklyCollection({ payout: 0, installment: 95, arrearsIn: 0, params }).collected).toBe(0);
  });
  it('guarantee payment reduces what is due from the borrower', () => {
    const c = computeWeeklyCollection({ payout: 0, installment: 95, arrearsIn: 0, guaranteed: 95, params });
    expect(c.due).toBe(0);
    expect(c.shortfall).toBe(0);
  });
});

describe('collection simulation', () => {
  const s = buildSchedule({ principal: 1000, aprPct: 20, weeks: 13, firstDueDate: new Date('2026-12-07') });
  it('repays fully on steady income', () => {
    const r = simulateCollections(s, Array(13).fill(1000), params);
    expect(r.arrears).toBe(0);
    expect(r.weeks.every((w) => w.status === 'PAID')).toBe(true);
  });
  it('a guaranteed week keeps the loan current with zero borrower collection', () => {
    const payouts = Array(13).fill(1000); payouts[3] = 0;
    const r = simulateCollections(s, payouts, params, { [s[3].installmentNo]: s[3].installmentDue });
    expect(r.weeks[3].collected).toBe(0);
    expect(r.weeks[3].status).toBe('GUARANTEED');
    expect(r.arrears).toBe(0);
  });
  it('without the guarantee the same shock creates arrears and DPD', () => {
    const payouts = Array(13).fill(1000); payouts[3] = 0;
    const r = simulateCollections(s, payouts, params);
    expect(r.weeks[3].arrearsOut).toBeGreaterThan(0);
    expect(daysPastDue(r.weeks[3].arrearsOut, s[3].installmentDue)).toBe(7);
  });
});
