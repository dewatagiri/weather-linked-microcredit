import { PARTNERS, rng, type ApplicantPayload, type PartnerConfig } from '@/engine';

const STATE: Record<string, string> = { KLANG_VALLEY: 'Selangor', JOHOR: 'Johor', PENANG: 'Penang', KELANTAN: 'Kelantan', TERENGGANU: 'Terengganu', PAHANG: 'Pahang', SABAH: 'Sabah', SARAWAK: 'Sarawak' };

/** Build a synthetic worker and render it in the partner's *native* feed format (inverse of the adapters). */
export function demoWorker(p: PartnerConfig, o: { weeklyAvg: number; volatility: number; tenureMonths: 3 | 6; seed: number; rating?: number; workerId?: string }): { raw: unknown; payload: Partial<ApplicantPayload> } {
  const r = rng(o.seed);
  const weekly = Array.from({ length: 26 }, () => Math.max(0, Math.round(o.weeklyAvg * Math.exp(r.normal(0, o.volatility)))));
  const id = o.workerId ?? `demo-${o.seed}`;
  const rating = o.rating ?? 4.7;
  const common = { name: 'Demo Worker', ic: '4321', region: STATE[p.region] };
  switch (p.feedFormat) {
    case 'WEEKLY_ARRAY':
      return { payload: {}, raw: { worker_id: id, name: common.name, ic_last4: common.ic, region: common.region, tenure_months: 14, weekly_earnings: weekly, weekly_days_active: weekly.map((w) => (w > 0 ? 5.5 : 0)), rating, cancel_rate: 0.04, loan_tenure: o.tenureMonths } };
    case 'MONTHLY_TOTALS': {
      const per = [5, 4, 5, 4, 4, 4]; let idx = 0;
      const monthly = per.map((n, i) => { const g = weekly.slice(idx, idx + n).reduce((a, b) => a + b, 0) * (52 / 12 / n); idx += n; return { month: `2026-0${i + 1}`, gross: Math.round(g), activeDays: 22 }; });
      return { payload: {}, raw: { driverRef: id, fullName: common.name, nric4: common.ic, state: common.region, joinedMonthsAgo: 14, monthly, score: { rating, cancelPct: 4 }, ask: { months: o.tenureMonths } } };
    }
    case 'TRIP_LEDGER': {
      const end = Date.now();
      const trips = weekly.flatMap((w, k) => (w > 0 ? Array.from({ length: 10 }, (_, j) => ({ ts: new Date(end - (25 - k) * 7 * 86_400_000 - j * 3 * 3_600_000).toISOString(), payout: w / 10 })) : []));
      return { payload: {}, raw: { courier: { id, name: common.name, icTail: common.ic, homeState: common.region, sinceMonths: 14 }, trips, ratingAvg: rating, cancelled: 4, completed: 96, request: { tenure: o.tenureMonths } } };
    }
  }
}
export const partnerById = (id: string) => PARTNERS.find((p) => p.id === id);
