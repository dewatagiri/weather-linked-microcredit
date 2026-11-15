import {
  type ApplicantPayload, type GraduationResult, type LoanOffer, type PipelineRun, type RegionCode, type ScheduleRow,
  type SimulatedWeek, type UnderwritingResult, type PolicyTerms, type Ring, type FloodAlert, type CheckResult,
  type GuaranteeQuote, type PartnerConfig, type TriggerEvaluation, type CalibratedThreshold,
  PARTNERS, runOriginationPipeline, scheduleFromOffer, priceGuarantee, defaultThreshold, GUARANTEE_TERMS,
  addDays, isoDate, rng, hashString, circlePolygon, evaluateTrigger, simulateCollections, daysPastDue,
  evaluateGraduation, MONTHLY_WEEKLY_TRIGGER_PROB, REGION_FACTOR, buildFeatureSnapshot,
} from '@/engine';

/* ------------------------------------------------------------------ records */
export interface BorrowerRec {
  id: string; partnerId: string; externalWorkerId: string; fullName: string; region: RegionCode;
  stage: number; tier: string | null; score: number; avgWeekly: number;
}
export interface ApplicationRec {
  id: string; idempotencyKey: string; borrowerId: string; partnerId: string;
  status: PipelineRun['status']; receivedAt: number; disbursedAt?: number; slaHours: number;
  pipeline: PipelineRun; underwriting?: UnderwritingResult; nps?: number; tenureMonths: number;
}
export interface PolicyRec {
  id: string; terms: PolicyTerms; region: RegionCode; quote: GuaranteeQuote; threshold: CalibratedThreshold;
}
export interface LoanRec {
  id: string; applicationId: string; borrowerId: string; partnerId: string;
  offer: LoanOffer; schedule: ScheduleRow[]; startMs: number; trailingAvg: number;
  weeks: (SimulatedWeek & { dueMs: number })[];
  policy: PolicyRec; status: 'ACTIVE' | 'CLOSED' | 'DEFAULTED';
  maxDpd: number; dpdNow: number; graduation?: GraduationResult; onTimeWeeks: number; guaranteedWeeks: number;
  pd?: Record<string, number | boolean>;
  payload: ApplicantPayload; ctosScore: number;
}
export interface WeatherEventRec {
  id: string; region: RegionCode; observedAt: number; rainfallMmHr: number; floodAlert: FloodAlert; polygon: Ring;
}
export interface EvaluationRec {
  id: string; policyId: string; loanId: string; borrowerId: string; eventId: string; at: number;
  outcome: TriggerEvaluation['outcome']; amount: number; installmentNo?: number; checks: CheckResult[];
}
export interface PartnerHealth { id: string; status: 'HEALTHY' | 'DEGRADED' | 'DOWN'; p95Ms: number; errorRatePct: number; lastHeartbeatMin: number; uptimePct: number }

export interface Store {
  now: number;
  partners: PartnerConfig[];
  partnerHealth: Map<string, PartnerHealth>;
  borrowers: Map<string, BorrowerRec>;
  applications: ApplicationRec[];
  loans: Map<string, LoanRec>;
  weatherEvents: WeatherEventRec[];
  evaluations: EvaluationRec[];
  idempotency: Map<string, string>;
}

/* ------------------------------------------------------------------ geography */
export const REGION_CENTRE: Record<RegionCode, [number, number]> = {
  KLANG_VALLEY: [101.6869, 3.139], JOHOR: [103.7414, 1.4927], PENANG: [100.3327, 5.4164], KELANTAN: [102.2386, 6.1254],
  TERENGGANU: [103.1324, 5.3302], PAHANG: [103.3256, 3.8077], SABAH: [116.0735, 5.9804], SARAWAK: [110.3593, 1.5533],
};
export const REGION_LABEL: Record<RegionCode, string> = {
  KLANG_VALLEY: 'Klang Valley', JOHOR: 'Johor', PENANG: 'Penang', KELANTAN: 'Kelantan', TERENGGANU: 'Terengganu',
  PAHANG: 'Pahang', SABAH: 'Sabah', SARAWAK: 'Sarawak',
};
export const WEATHER_CELL_RADIUS_M = 10_000;
const DAY = 86_400_000, WEEK = 7 * DAY, MYT = 8 * 3_600_000;
const localMidnight = (ms: number) => Math.floor((ms + MYT) / DAY) * DAY - MYT;

/* ------------------------------------------------------------------ policy + loan creation */
export function buildPolicy(opts: {
  applicationId: string; region: RegionCode; offer: LoanOffer; startMs: number;
}): PolicyRec {
  const threshold = defaultThreshold(opts.region);
  const quote = priceGuarantee({
    principal: opts.offer.principal, weeklyInstallment: opts.offer.weeklyInstallment,
    tenureMonths: opts.offer.tenureMonths, originationDate: new Date(opts.startMs), region: opts.region,
  });
  const startIso = isoDate(new Date(opts.startMs + MYT));
  const endIso = isoDate(new Date(opts.startMs + MYT + opts.offer.weeks * WEEK));
  const id = 'pol_' + opts.applicationId.slice(4);
  return {
    id, region: opts.region, quote, threshold,
    terms: {
      policyId: id, status: 'ACTIVE', timezone: 'Asia/Kuala_Lumpur', windowStart: '08:00', windowEnd: '19:00',
      rainThresholdMmHr: threshold.triggerMmHr, floodAlertLevel: 'WARNING', coverageStart: startIso, coverageEnd: endIso,
      waitingPeriodDays: GUARANTEE_TERMS.waitingPeriodDays, maxClaims: quote.maxClaims, claimsPaid: 0,
      pingToleranceMin: 20, ipMaxRadiusM: 3000, gpsMaxAccuracyM: 200,
    },
  };
}

export function createLoan(opts: {
  app: ApplicationRec; borrower: BorrowerRec; uw: UnderwritingResult; startMs: number; payload: ApplicantPayload; ctosScore: number;
}): LoanRec {
  const offer = opts.uw.offer!;
  const first = new Date(localMidnight(opts.startMs) + 7 * DAY);
  return {
    id: 'loan_' + opts.app.id.slice(4), applicationId: opts.app.id, borrowerId: opts.borrower.id, partnerId: opts.app.partnerId,
    offer, schedule: scheduleFromOffer(offer, first), startMs: opts.startMs, trailingAvg: opts.uw.metrics.avgWeekly,
    weeks: [], policy: buildPolicy({ applicationId: opts.app.id, region: opts.borrower.region, offer, startMs: opts.startMs }),
    status: 'ACTIVE', maxDpd: 0, dpdNow: 0, onTimeWeeks: 0, guaranteedWeeks: 0,
    payload: opts.payload, ctosScore: opts.ctosScore,
  };
}

/* ------------------------------------------------------------------ ingest (webhook path) */
let seq = 0;
const newId = (p: string, r?: () => number) => `${p}_${(hashString(String(++seq) + (r?.() ?? Math.random())) >>> 0).toString(36)}${seq.toString(36)}`;

export async function ingestApplication(store: Store, payload: ApplicantPayload, idempotencyKey: string, opts: { seed?: number } = {}) {
  const key = payload.partnerId + ':' + idempotencyKey;
  const existing = store.idempotency.get(key);
  if (existing) return { duplicate: true as const, application: store.applications.find((a) => a.id === existing)! };

  const run = await runOriginationPipeline(payload, { seed: opts.seed });
  const bid = 'bor_' + hashString(payload.partnerId + payload.externalWorkerId).toString(36);
  const borrower: BorrowerRec = store.borrowers.get(bid) ?? {
    id: bid, partnerId: payload.partnerId, externalWorkerId: payload.externalWorkerId, fullName: payload.fullName,
    region: payload.homeRegion, stage: 1, tier: run.underwriting?.tier ?? null, score: run.underwriting?.score ?? 0,
    avgWeekly: run.underwriting?.metrics.avgWeekly ?? 0,
  };
  store.borrowers.set(bid, borrower);

  const receivedAt = store.now;
  const app: ApplicationRec = {
    id: newId('app'), idempotencyKey, borrowerId: bid, partnerId: payload.partnerId, status: run.status, receivedAt,
    disbursedAt: run.status === 'DISBURSED' ? receivedAt + run.totalHours * 3_600_000 : undefined,
    slaHours: run.totalHours, pipeline: run, underwriting: run.underwriting, tenureMonths: payload.requestedTenureMonths,
  };
  store.applications.unshift(app);
  store.idempotency.set(key, app.id);
  let loan: LoanRec | undefined;
  if (run.status === 'DISBURSED' && run.underwriting?.offer) {
    loan = createLoan({ app, borrower, uw: run.underwriting, startMs: app.disbursedAt!, payload, ctosScore: run.bureau?.ctosScore ?? 0 });
    store.loans.set(loan.id, loan);
  }
  return { duplicate: false as const, application: app, loan, borrower };
}

/* ------------------------------------------------------------------ seed simulation */
export const SEED_COUNT = 260;

function genPayload(r: ReturnType<typeof rng>, i: number, partner: PartnerConfig): ApplicantPayload {
  const base = Math.exp(r.normal(Math.log(820), 0.42));
  const cv = r.range(0.06, 0.4);
  const season = r.range(-0.05, 0.05);
  const stable = r.next() > 0.12;
  const weekly = Array.from({ length: 26 }, (_, k) => {
    if (!stable && r.next() < 0.22) return 0;
    return Math.max(0, Math.round(base * (1 + season * (k - 13) / 13) * Math.exp(r.normal(0, cv))));
  });
  const regions: RegionCode[] = [partner.region, partner.region, partner.region, r.pick(['KLANG_VALLEY', 'JOHOR', 'PENANG'] as RegionCode[])];
  return {
    partnerId: partner.id, externalWorkerId: `${partner.id.slice(4, 8)}-${1000 + i}`,
    fullName: `Worker ${String(i + 1).padStart(3, '0')}`, nricLast4: String(r.int(1000, 9999)),
    homeRegion: r.pick(regions), platformTenureMonths: r.int(4, 40),
    weeklyPayouts: weekly, weeklyActiveDays: weekly.map((w) => (w === 0 ? 0 : Math.min(7, Math.max(2, r.normal(5.2, 0.9))))),
    avgRating: Math.min(5, Math.max(3.6, r.normal(4.72, 0.22))), cancellationRate: Math.max(0, r.normal(0.06, 0.05)),
    requestedTenureMonths: r.next() < 0.55 ? 3 : 6,
  };
}

function generateWeather(now: number, r: ReturnType<typeof rng>): WeatherEventRec[] {
  const out: WeatherEventRec[] = [];
  const start = localMidnight(now - 60 * WEEK);
  (Object.keys(REGION_CENTRE) as RegionCode[]).forEach((region) => {
    const thr = defaultThreshold(region).triggerMmHr;
    const poly = circlePolygon(REGION_CENTRE[region], WEATHER_CELL_RADIUS_M);
    for (let w = 0; start + w * WEEK < now; w++) {
      const wkStart = start + w * WEEK;
      const month = new Date(wkStart + MYT).getUTCMonth();
      // slightly wetter than the pricing assumption (x1.0) so the demo has signal
      const p = Math.min(0.9, MONTHLY_WEEKLY_TRIGGER_PROB[month] * REGION_FACTOR[region] * 1.5);
      const n = r.next() < p ? (r.next() < 0.25 ? 2 : 1) : 0;
      for (let k = 0; k < n; k++) {
        const day = r.int(0, 6);
        const inWindow = r.next() < 0.72;
        const hour = inWindow ? r.int(8, 18) : r.pick([0, 1, 2, 3, 4, 5, 6, 7, 19, 20, 21, 22, 23]);
        const ts = localMidnight(wkStart) + day * DAY + hour * 3_600_000 + r.int(0, 59) * 60_000;
        if (ts > now) continue;
        out.push({
          id: `wx_${region.slice(0, 3)}_${(ts / 60000).toString(36)}`, region, observedAt: ts,
          rainfallMmHr: Math.round(thr * r.range(0.85, 2.1) * 10) / 10,
          floodAlert: r.next() < 0.14 ? (r.next() < 0.3 ? 'DANGER' : 'WARNING') : r.next() < 0.2 ? 'ADVISORY' : 'NONE',
          polygon: poly,
        });
      }
    }
  });
  return out.sort((a, b) => a.observedAt - b.observedAt);
}

/** Replay a loan's life: realised income, weather events, trigger evaluation, collections. */
function simulateLoanLife(store: Store, loan: LoanRec, borrower: BorrowerRec, r: ReturnType<typeof rng>, nowMs: number) {
  const o = loan.offer;
  const elapsed = Math.min(o.weeks, Math.floor((nowMs - loan.startMs) / WEEK));
  const base = loan.trailingAvg;
  const dropout = r.next() < 0.07 ? r.int(2, Math.max(3, o.weeks - 3)) : Infinity;
  const centre = REGION_CENTRE[borrower.region];
  const events = store.weatherEvents.filter((e) => e.region === borrower.region && e.observedAt >= loan.startMs && e.observedAt < loan.startMs + elapsed * WEEK);
  const payouts: number[] = [];
  const guaranteed: Record<number, number> = {};
  let rainWeeks = 0;
  const rainFlags: boolean[] = [];

  for (let k = 0; k < elapsed; k++) {
    const wkEvents = events.filter((e) => e.observedAt >= loan.startMs + k * WEEK && e.observedAt < loan.startMs + (k + 1) * WEEK);
    const rainy = wkEvents.some((e) => e.rainfallMmHr >= loan.policy.terms.rainThresholdMmHr * 0.9);
    rainFlags.push(rainy);
    let payout = base * Math.exp(r.normal(0, 0.14)) * (r.next() < 0.03 ? 0.3 : 1);
    if (rainy) payout *= r.range(0.45, 0.8);
    if (k >= dropout) payout = 0;
    payouts.push(Math.round(payout));
    if (rainy) rainWeeks++;

    const inst = loan.schedule[k];
    for (const e of wkEvents) {
      if (guaranteed[inst.installmentNo]) break;
      const roll = r.next();
      const offset = (roll < 0.86 ? r.range(0, 6000) : r.range(14000, 30000)); // metres from cell centre
      const theta = r.range(0, 2 * Math.PI);
      const lat = centre[1] + (offset * Math.sin(theta)) / 111_320;
      const lng = centre[0] + (offset * Math.cos(theta)) / (111_320 * Math.cos((centre[1] * Math.PI) / 180));
      const pingRoll = r.next();
      const pings = pingRoll < 0.06 ? [] : [{
        ts: e.observedAt + r.int(-8, 8) * 60_000, lng, lat,
        source: (pingRoll < 0.2 ? 'IP' : 'GPS') as 'IP' | 'GPS',
        accuracyM: pingRoll < 0.2 ? (r.next() < 0.5 ? 1800 : 9000) : r.int(5, 60),
        onlineOnPlatform: r.next() > 0.08,
      }];
      const ev = evaluateTrigger({
        event: e, policy: loan.policy.terms, pings,
        installments: [{ scheduleId: `${loan.id}#${inst.installmentNo}`, installmentNo: inst.installmentNo, dueDate: inst.dueDate, outstanding: inst.installmentDue, alreadyGuaranteed: false }],
      });
      store.evaluations.push({
        id: `ev_${store.evaluations.length}`, policyId: loan.policy.id, loanId: loan.id, borrowerId: borrower.id, eventId: e.id,
        at: e.observedAt, outcome: ev.outcome, amount: ev.payout?.amount ?? 0, installmentNo: ev.payout?.installmentNo, checks: ev.checks,
      });
      if (ev.outcome === 'TRIGGERED' && ev.payout) {
        guaranteed[ev.payout.installmentNo] = ev.payout.amount;
        loan.policy.terms.claimsPaid++;
        if (loan.policy.terms.claimsPaid >= loan.policy.terms.maxClaims) loan.policy.terms.status = 'EXHAUSTED';
      }
    }
  }

  const sim = simulateCollections(loan.schedule, payouts, { deductionRatePct: o.deductionRatePct, weeklyCapPct: o.weeklyCapPct, trailingAvgWeekly: loan.trailingAvg }, guaranteed);
  loan.weeks = sim.weeks.map((w) => ({ ...w, dueMs: Date.parse(w.dueDate + 'T00:00:00+08:00') }));
  let maxDpd = 0, onTime = 0, gw = 0;
  const dpdByWeek: number[] = [];
  sim.weeks.forEach((w) => {
    const d = daysPastDue(w.arrearsOut, o.weeklyInstallment);
    dpdByWeek.push(d); maxDpd = Math.max(maxDpd, d);
    if (w.guaranteed > 0) gw++; else if (w.status === 'PAID') onTime++;
  });
  loan.maxDpd = maxDpd; loan.dpdNow = dpdByWeek.at(-1) ?? 0; loan.onTimeWeeks = onTime; loan.guaranteedWeeks = gw;
  const finished = elapsed >= o.weeks;
  const fullyRepaid = finished && sim.arrears < 0.01;
  loan.status = maxDpd >= 90 ? 'DEFAULTED' : finished ? 'CLOSED' : 'ACTIVE';
  if (loan.policy.terms.status === 'ACTIVE' && finished) loan.policy.terms.status = 'EXPIRED';

  // graduation on closed loans (and a "would-be" evaluation for the active loans nearing the end)
  const refreshedAvg = payouts.length ? payouts.slice(-13).reduce((a, b) => a + b, 0) / Math.min(13, payouts.length) : base;
  const refreshedScore = Math.min(100, borrower.score + (onTime / Math.max(1, elapsed)) * 12 - maxDpd / 7);
  if (finished) {
    loan.graduation = evaluateGraduation({
      currentStage: borrower.stage,
      loan: { weeksTotal: o.weeks, onTimeWeeks: onTime, guaranteeCoveredWeeks: gw, maxDaysPastDue: maxDpd, defaulted: loan.status === 'DEFAULTED', fullyRepaid },
      refreshedScore, refreshedAvgWeekly: refreshedAvg,
    });
    if (loan.graduation.eligible) borrower.stage = loan.graduation.toStage;
  }

  loan.pd = buildFeatureSnapshot({
    weeklyPayouts26: loan.payload.weeklyPayouts, weeklyActiveDays: loan.payload.weeklyActiveDays, rating: loan.payload.avgRating,
    cancellationRate: loan.payload.cancellationRate, tenureMonths: loan.payload.platformTenureMonths, ctosScore: loan.ctosScore,
    installment: o.weeklyInstallment, realisedPayouts: payouts, collected: sim.weeks.map((w) => w.collected + w.guaranteed),
    dpdByWeek, guaranteeWeeks: Object.keys(guaranteed).map((n) => Number(n) - 1), guaranteePaid: sim.totalGuaranteed,
    rainHoursLast4w: rainWeeks, rainWeekFlags: rainFlags, originationMonth: new Date(loan.startMs + MYT).getUTCMonth() + 1,
  });
}

async function buildSeed(): Promise<Store> {
  const now = Date.now();
  const r = rng(20261114);
  const store: Store = {
    now, partners: PARTNERS, partnerHealth: new Map(), borrowers: new Map(), applications: [], loans: new Map(),
    weatherEvents: [], evaluations: [], idempotency: new Map(),
  };
  store.weatherEvents = generateWeather(now, r);

  // partner health (simulated heartbeat telemetry)
  PARTNERS.forEach((p, i) => {
    const roll = r.next();
    const status: PartnerHealth['status'] = i === 7 ? 'DEGRADED' : i === 21 ? 'DOWN' : roll < 0.07 ? 'DEGRADED' : 'HEALTHY';
    store.partnerHealth.set(p.id, {
      id: p.id, status,
      p95Ms: Math.round(p.baseLatencyMs * (status === 'HEALTHY' ? r.range(1.5, 2.6) : status === 'DEGRADED' ? r.range(4, 7) : 0)),
      errorRatePct: status === 'HEALTHY' ? Math.round(r.range(0, 1.2) * 10) / 10 : status === 'DEGRADED' ? Math.round(r.range(4, 9) * 10) / 10 : 100,
      lastHeartbeatMin: status === 'DOWN' ? r.int(55, 190) : r.int(0, 3),
      uptimePct: status === 'HEALTHY' ? Math.round(r.range(99.5, 99.99) * 100) / 100 : status === 'DEGRADED' ? 97.8 : 91.2,
    });
  });

  const weights = PARTNERS.map((_, i) => (i < 12 ? 3 : 1));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const pickPartner = () => { let x = r.next() * totalW; for (let i = 0; i < PARTNERS.length; i++) { x -= weights[i]; if (x <= 0) return PARTNERS[i]; } return PARTNERS[0]; };

  const payloads: { payload: ApplicantPayload; receivedAt: number }[] = [];
  for (let i = 0; i < SEED_COUNT; i++) {
    const age = Math.pow(r.next(), 0.8) * 46 * WEEK; // skew toward recent
    payloads.push({ payload: genPayload(r, i, pickPartner()), receivedAt: now - age });
  }
  payloads.sort((a, b) => a.receivedAt - b.receivedAt);

  for (const { payload, receivedAt } of payloads) {
    store.now = receivedAt; // virtual clock so created ids/times are historical
    const res = await ingestApplication(store, payload, 'seed-' + payload.externalWorkerId);
    if (res.duplicate) continue;
    const app = res.application;
    if (app.status === 'DISBURSED') {
      const lr = rng(hashString(app.id));
      app.nps = (() => { const x = lr.next(); return x < 0.58 ? lr.int(9, 10) : x < 0.84 ? lr.int(7, 8) : lr.int(2, 6); })();
    }
  }
  store.now = now;

  // Replay each loan's life now that all weather exists
  for (const loan of store.loans.values()) {
    const b = store.borrowers.get(loan.borrowerId)!;
    simulateLoanLife(store, loan, b, rng(hashString(loan.id)), now);
  }
  store.applications.sort((a, b) => b.receivedAt - a.receivedAt);
  return store;
}

const g = globalThis as unknown as { __gigRainStore?: Promise<Store> };
export function getStore(): Promise<Store> {
  return (g.__gigRainStore ??= buildSeed());
}
