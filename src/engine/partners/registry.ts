import type { ApplicantPayload, FeedFormat, PartnerCategory, RegionCode, TenureMonths } from '../types';

/** Raw feed shapes as partners send them. Each is normalised into ApplicantPayload. */
export interface WeeklyArrayFeed {
  worker_id: string; name: string; ic_last4: string; phone?: string; region: string; tenure_months: number;
  weekly_earnings: number[]; weekly_days_active: number[]; rating: number; cancel_rate: number;
  loan_tenure: number; loan_amount?: number;
}
export interface MonthlyTotalsFeed {
  driverRef: string; fullName: string; nric4: string; msisdn?: string; state: string; joinedMonthsAgo: number;
  monthly: { month: string; gross: number; activeDays: number }[]; // 6 entries
  score: { rating: number; cancelPct: number }; ask: { months: number; rm?: number };
}
export interface TripLedgerFeed {
  courier: { id: string; name: string; icTail: string; phone?: string; homeState: string; sinceMonths: number };
  trips: { ts: string; payout: number }[];           // individual trips/jobs, 26 weeks
  ratingAvg: number; cancelled: number; completed: number;
  request: { tenure: number; amount?: number };
}

const REGION_ALIASES: Record<string, RegionCode> = {
  'kuala lumpur': 'KLANG_VALLEY', selangor: 'KLANG_VALLEY', klang_valley: 'KLANG_VALLEY', kl: 'KLANG_VALLEY',
  johor: 'JOHOR', penang: 'PENANG', 'pulau pinang': 'PENANG', kelantan: 'KELANTAN', terengganu: 'TERENGGANU',
  pahang: 'PAHANG', sabah: 'SABAH', sarawak: 'SARAWAK',
};
export function normaliseRegion(s: string): RegionCode {
  const r = REGION_ALIASES[s.trim().toLowerCase()];
  if (!r) throw new AdapterError(`unknown region "${s}"`);
  return r;
}
export class AdapterError extends Error {}

const tenure = (n: number): TenureMonths => {
  if (n === 3 || n === 6 || n === 12) return n;
  throw new AdapterError(`unsupported tenure ${n}`);
};
const WEEKS = 26;

export const ADAPTERS: Record<FeedFormat, (partnerId: string, raw: any) => ApplicantPayload> = {
  WEEKLY_ARRAY(partnerId, f: WeeklyArrayFeed) {
    if (!Array.isArray(f.weekly_earnings) || f.weekly_earnings.length !== WEEKS) throw new AdapterError(`weekly_earnings must have ${WEEKS} entries`);
    return {
      partnerId, externalWorkerId: f.worker_id, fullName: f.name, nricLast4: f.ic_last4, phone: f.phone,
      homeRegion: normaliseRegion(f.region), platformTenureMonths: f.tenure_months,
      weeklyPayouts: f.weekly_earnings.map(Number), weeklyActiveDays: (f.weekly_days_active ?? []).map(Number),
      avgRating: f.rating, cancellationRate: f.cancel_rate, requestedTenureMonths: tenure(f.loan_tenure), requestedAmount: f.loan_amount,
    };
  },
  MONTHLY_TOTALS(partnerId, f: MonthlyTotalsFeed) {
    if (!f.monthly || f.monthly.length !== 6) throw new AdapterError('monthly must have 6 entries');
    // Spread each month's gross across ~4.33 weeks (no intra-month signal available from this feed).
    const weeklyPayouts: number[] = [], weeklyActiveDays: number[] = [];
    f.monthly.forEach((m, i) => {
      const n = i % 2 === 0 ? 5 : 4; // 5+4+5+4+4+4 = 26
      const weeks = i >= 4 ? 4 : n;
      for (let k = 0; k < weeks; k++) { weeklyPayouts.push(m.gross / (52 / 12)); weeklyActiveDays.push(m.activeDays / (52 / 12)); }
    });
    while (weeklyPayouts.length > WEEKS) { weeklyPayouts.pop(); weeklyActiveDays.pop(); }
    while (weeklyPayouts.length < WEEKS) { weeklyPayouts.push(weeklyPayouts.at(-1)!); weeklyActiveDays.push(weeklyActiveDays.at(-1)!); }
    return {
      partnerId, externalWorkerId: f.driverRef, fullName: f.fullName, nricLast4: f.nric4, phone: f.msisdn,
      homeRegion: normaliseRegion(f.state), platformTenureMonths: f.joinedMonthsAgo,
      weeklyPayouts, weeklyActiveDays, avgRating: f.score.rating, cancellationRate: f.score.cancelPct / 100,
      requestedTenureMonths: tenure(f.ask.months), requestedAmount: f.ask.rm,
    };
  },
  TRIP_LEDGER(partnerId, f: TripLedgerFeed) {
    if (!f.trips?.length) throw new AdapterError('trips empty');
    const end = Math.max(...f.trips.map((t) => Date.parse(t.ts)));
    const payouts = new Array(WEEKS).fill(0);
    const days: Set<string>[] = Array.from({ length: WEEKS }, () => new Set());
    for (const t of f.trips) {
      const ms = Date.parse(t.ts);
      const idx = WEEKS - 1 - Math.floor((end - ms) / (7 * 86_400_000));
      if (idx >= 0 && idx < WEEKS) { payouts[idx] += t.payout; days[idx].add(t.ts.slice(0, 10)); }
    }
    const total = f.cancelled + f.completed;
    return {
      partnerId, externalWorkerId: f.courier.id, fullName: f.courier.name, nricLast4: f.courier.icTail, phone: f.courier.phone,
      homeRegion: normaliseRegion(f.courier.homeState), platformTenureMonths: f.courier.sinceMonths,
      weeklyPayouts: payouts, weeklyActiveDays: days.map((d) => d.size), avgRating: f.ratingAvg,
      cancellationRate: total ? f.cancelled / total : 0, requestedTenureMonths: tenure(f.request.tenure), requestedAmount: f.request.amount,
    };
  },
};

export interface PartnerConfig { id: string; name: string; category: PartnerCategory; feedFormat: FeedFormat; region: RegionCode; baseLatencyMs: number }

const NAMES: [string, PartnerCategory, FeedFormat, RegionCode][] = [
  ['RideKita', 'E_HAILING', 'WEEKLY_ARRAY', 'KLANG_VALLEY'], ['GoCab MY', 'E_HAILING', 'MONTHLY_TOTALS', 'KLANG_VALLEY'],
  ['Tumpang', 'E_HAILING', 'WEEKLY_ARRAY', 'JOHOR'], ['PenangRide', 'E_HAILING', 'TRIP_LEDGER', 'PENANG'],
  ['SabahGo', 'E_HAILING', 'WEEKLY_ARRAY', 'SABAH'], ['KuchingCab', 'E_HAILING', 'MONTHLY_TOTALS', 'SARAWAK'],
  ['Ekspres Ride', 'E_HAILING', 'WEEKLY_ARRAY', 'PAHANG'], ['Pantai Ride', 'E_HAILING', 'TRIP_LEDGER', 'TERENGGANU'],
  ['MakanDash', 'DELIVERY', 'TRIP_LEDGER', 'KLANG_VALLEY'], ['LekasBites', 'DELIVERY', 'WEEKLY_ARRAY', 'KLANG_VALLEY'],
  ['AntarKu', 'DELIVERY', 'MONTHLY_TOTALS', 'JOHOR'], ['PenangEats', 'DELIVERY', 'TRIP_LEDGER', 'PENANG'],
  ['KedaiTerus', 'DELIVERY', 'WEEKLY_ARRAY', 'KELANTAN'], ['DapurGo', 'DELIVERY', 'TRIP_LEDGER', 'TERENGGANU'],
  ['SarawakMeals', 'DELIVERY', 'MONTHLY_TOTALS', 'SARAWAK'], ['JomHantar', 'DELIVERY', 'WEEKLY_ARRAY', 'KLANG_VALLEY'],
  ['PasarExpress', 'DELIVERY', 'TRIP_LEDGER', 'PAHANG'], ['BorneoBites', 'DELIVERY', 'WEEKLY_ARRAY', 'SABAH'],
  ['LorryLink', 'LOGISTICS', 'MONTHLY_TOTALS', 'KLANG_VALLEY'], ['TrukKita', 'LOGISTICS', 'TRIP_LEDGER', 'JOHOR'],
  ['MuatMY', 'LOGISTICS', 'WEEKLY_ARRAY', 'KLANG_VALLEY'], ['HaulMate', 'LOGISTICS', 'MONTHLY_TOTALS', 'PENANG'],
  ['EastCoast Freight', 'LOGISTICS', 'TRIP_LEDGER', 'KELANTAN'], ['KargoPantas', 'LOGISTICS', 'WEEKLY_ARRAY', 'PAHANG'],
  ['SabahHaul', 'LOGISTICS', 'MONTHLY_TOTALS', 'SABAH'], ['PosLaju Gig', 'LOGISTICS', 'TRIP_LEDGER', 'KLANG_VALLEY'],
  ['LastMile MY', 'DELIVERY', 'WEEKLY_ARRAY', 'JOHOR'], ['ParcelPal', 'DELIVERY', 'TRIP_LEDGER', 'KLANG_VALLEY'],
  ['AngkutGo', 'LOGISTICS', 'WEEKLY_ARRAY', 'SARAWAK'], ['SiakapRide', 'E_HAILING', 'MONTHLY_TOTALS', 'KELANTAN'],
];
// Fictional partner names — no real platform is implied.
export const PARTNERS: PartnerConfig[] = NAMES.map(([name, category, feedFormat, region], i) => ({
  id: 'ptn_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/_$/, ''),
  name, category, feedFormat, region, baseLatencyMs: 90 + ((i * 37) % 160),
}));
export const getPartner = (id: string) => PARTNERS.find((p) => p.id === id);

export function normalisePartnerPayload(partnerId: string, raw: unknown): ApplicantPayload {
  const p = getPartner(partnerId);
  if (!p) throw new AdapterError(`unknown partner ${partnerId}`);
  return ADAPTERS[p.feedFormat](partnerId, raw);
}
