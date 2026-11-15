// CLI walk-through of the whole flow:  npm run demo
import {
  underwrite, priceGuarantee, scheduleFromOffer, simulateCollections, evaluateTrigger, circlePolygon, defaultThreshold, type ApplicantPayload,
} from '../src/engine';

const worker: ApplicantPayload = {
  partnerId: 'ptn_demo', externalWorkerId: 'demo', fullName: 'Demo Rider', nricLast4: '1234', homeRegion: 'KLANG_VALLEY', platformTenureMonths: 14,
  weeklyPayouts: Array.from({ length: 26 }, (_, i) => 900 + ((i * 53) % 160) - 80), weeklyActiveDays: Array(26).fill(5.5),
  avgRating: 4.8, cancellationRate: 0.04, requestedTenureMonths: 3,
};
const uw = underwrite(worker, { bureau: { ctosScore: 690, ccrisWorstArrearsMonths: 0, ccrisActiveFacilities: 1, bankruptcyFlag: false } });
console.log('1. Underwriting →', uw.decision, 'tier', uw.tier, 'score', uw.score.toFixed(0)); console.table(uw.offer);
const o = uw.offer!;
const start = new Date('2026-11-09T02:00:00Z');
const quote = priceGuarantee({ principal: o.principal, weeklyInstallment: o.weeklyInstallment, tenureMonths: o.tenureMonths, originationDate: start, region: 'KLANG_VALLEY' });
console.log(`2. Guarantee fee RM${quote.fee} (${quote.feePctOfPrincipal}% of principal, seasonality ${quote.seasonalityIndex}x, Q4 loading ${quote.q4Loading})`);
const schedule = scheduleFromOffer(o, new Date('2026-11-16'));
const centre: [number, number] = [101.6869, 3.139];
const thr = defaultThreshold('KLANG_VALLEY');
const ev = evaluateTrigger({
  event: { id: 'wx1', observedAt: '2026-11-24T15:10:00+08:00', rainfallMmHr: thr.triggerMmHr + 15, floodAlert: 'NONE', polygon: circlePolygon(centre, 10_000) },
  policy: { policyId: 'pol1', status: 'ACTIVE', timezone: 'Asia/Kuala_Lumpur', windowStart: '08:00', windowEnd: '19:00', rainThresholdMmHr: thr.triggerMmHr, floodAlertLevel: 'WARNING',
    coverageStart: '2026-11-09', coverageEnd: '2027-02-09', waitingPeriodDays: 7, maxClaims: quote.maxClaims, claimsPaid: 0, pingToleranceMin: 20, ipMaxRadiusM: 3000, gpsMaxAccuracyM: 200 },
  pings: [{ ts: '2026-11-24T15:12:00+08:00', lng: centre[0] + 0.01, lat: centre[1], source: 'GPS', accuracyM: 12, onlineOnPlatform: true }],
  installments: [{ scheduleId: 's2', installmentNo: 2, dueDate: schedule[1].dueDate, outstanding: schedule[1].installmentDue, alreadyGuaranteed: false }],
});
console.log('3. Trigger →', ev.outcome, ev.payout); ev.checks.forEach((c) => console.log('   ', c.pass ? '✓' : '✗', c.code, '-', c.detail));
const payouts = Array(13).fill(900); payouts[1] = 250; // storm week hurts income
const sim = simulateCollections(schedule, payouts, { deductionRatePct: o.deductionRatePct, weeklyCapPct: o.weeklyCapPct, trailingAvgWeekly: uw.metrics.avgWeekly }, ev.payout ? { [ev.payout.installmentNo]: ev.payout.amount } : {});
console.log('4. Collections: arrears', sim.arrears, '· guarantee paid to lender', sim.totalGuaranteed, '· week 2 status', sim.weeks[1].status);
