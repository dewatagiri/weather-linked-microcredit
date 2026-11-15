import { describe, it, expect } from 'vitest';
import { runOriginationPipeline, PARTNERS, normalisePartnerPayload, AdapterError, type TripLedgerFeed } from '@/engine';
import { applicant } from './helpers';

describe('origination pipeline', () => {
  it('runs all agents in order and disburses an eligible applicant inside the 48h SLA', async () => {
    const runs = await Promise.all(Array.from({ length: 40 }, (_, i) => runOriginationPipeline(applicant({ externalWorkerId: 'w' + i, weekly: 1000 }), { failureRate: 0 })));
    const done = runs.filter((r) => r.status === 'DISBURSED');
    expect(done.length).toBeGreaterThan(30);
    expect(done[0].steps.map((s) => s.step)).toEqual(['INGEST', 'EKYC', 'CTOS', 'CCRIS', 'UNDERWRITE', 'ESIGN_PACKET', 'BORROWER_SIGN', 'DISBURSE']);
    const within48 = done.filter((r) => r.totalHours <= 48).length / done.length;
    expect(within48).toBeGreaterThan(0.9);
    expect(done.every((r) => r.totalHours > 0)).toBe(true);
  });
  it('is deterministic for a given worker / seed', async () => {
    const a = await runOriginationPipeline(applicant(), { seed: 5 });
    const b = await runOriginationPipeline(applicant(), { seed: 5 });
    expect(a).toEqual(b);
  });
  it('declined applicants stop before e-sign / disbursement', async () => {
    const r = await runOriginationPipeline(applicant({ weekly: 200 }), { failureRate: 0 });
    expect(r.status).toBe('DECLINED');
    expect(r.steps.some((s) => s.step === 'DISBURSE')).toBe(false);
  });
  it('surfaces agent failure when retries are exhausted', async () => {
    const r = await runOriginationPipeline(applicant(), { failureRate: 1 });
    expect(r.status).toBe('FAILED');
  });
});

describe('partner adapters', () => {
  it('registers ~30 partners across the three categories and all feed formats', () => {
    expect(PARTNERS).toHaveLength(30);
    expect(new Set(PARTNERS.map((p) => p.category)).size).toBe(3);
    expect(new Set(PARTNERS.map((p) => p.feedFormat)).size).toBe(3);
    expect(new Set(PARTNERS.map((p) => p.id)).size).toBe(30);
  });
  it('normalises each feed format to 26-week payload', () => {
    const wk = PARTNERS.find((p) => p.feedFormat === 'WEEKLY_ARRAY')!;
    const a = normalisePartnerPayload(wk.id, { worker_id: 'a', name: 'A', ic_last4: '1111', region: 'Selangor', tenure_months: 12, weekly_earnings: Array(26).fill(800), weekly_days_active: Array(26).fill(5), rating: 4.7, cancel_rate: 0.03, loan_tenure: 3 });
    expect(a.homeRegion).toBe('KLANG_VALLEY'); expect(a.weeklyPayouts).toHaveLength(26);

    const mo = PARTNERS.find((p) => p.feedFormat === 'MONTHLY_TOTALS')!;
    const b = normalisePartnerPayload(mo.id, { driverRef: 'b', fullName: 'B', nric4: '2222', state: 'Johor', joinedMonthsAgo: 10, monthly: Array.from({ length: 6 }, (_, i) => ({ month: '2026-0' + (i + 1), gross: 3466, activeDays: 22 })), score: { rating: 4.5, cancelPct: 6 }, ask: { months: 6 } });
    expect(b.weeklyPayouts).toHaveLength(26);
    expect(b.weeklyPayouts[0]).toBeCloseTo(800, 0);

    const tr = PARTNERS.find((p) => p.feedFormat === 'TRIP_LEDGER')!;
    const end = Date.parse('2026-11-10T00:00:00Z');
    const feed: TripLedgerFeed = { courier: { id: 'c', name: 'C', icTail: '3333', homeState: 'Penang', sinceMonths: 9 }, ratingAvg: 4.6, cancelled: 5, completed: 95, request: { tenure: 3 },
      trips: Array.from({ length: 26 * 10 }, (_, i) => ({ ts: new Date(end - Math.floor(i / 10) * 7 * 86_400_000 - (i % 5) * 86_400_000).toISOString(), payout: 10 })) };
    const c = normalisePartnerPayload(tr.id, feed);
    expect(c.weeklyPayouts).toHaveLength(26);
    expect(c.cancellationRate).toBeCloseTo(0.05);
    expect(c.weeklyPayouts.reduce((a, b) => a + b, 0)).toBe(2600);
  });
  it('rejects malformed feeds / unknown partners', () => {
    const wk = PARTNERS.find((p) => p.feedFormat === 'WEEKLY_ARRAY')!;
    expect(() => normalisePartnerPayload(wk.id, { weekly_earnings: [1, 2] })).toThrow(AdapterError);
    expect(() => normalisePartnerPayload('ptn_nope', {})).toThrow(AdapterError);
  });
});
