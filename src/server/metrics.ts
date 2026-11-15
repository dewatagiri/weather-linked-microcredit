import { LADDER, graduationProgress, PD_FEATURES, SLA, quantile } from '@/engine';
import type { Store, LoanRec } from './store';
import { REGION_LABEL } from './store';

const WEEK = 7 * 86_400_000;
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const pct = (n: number, d: number) => (d ? round((n / d) * 100) : 0);

export function outstandingPrincipal(l: LoanRec) {
  if (l.status !== 'ACTIVE') return 0;
  const k = l.weeks.length;
  return k === 0 ? l.offer.principal : l.schedule[k - 1].balanceAfter;
}

export function portfolioMetrics(s: Store) {
  const loans = [...s.loans.values()];
  const active = loans.filter((l) => l.status === 'ACTIVE');
  const apps30 = s.applications.filter((a) => a.receivedAt > s.now - 30 * 86_400_000);
  const disbursed = s.applications.filter((a) => a.status === 'DISBURSED');
  const decided = s.applications.filter((a) => a.status !== 'FAILED');

  // ---- SLA
  const hrs = disbursed.map((a) => a.slaHours).sort((a, b) => a - b);
  const sla = {
    median: round(quantile(hrs, 0.5)), p90: round(quantile(hrs, 0.9)),
    within24: pct(hrs.filter((h) => h <= SLA.targetHours).length, hrs.length),
    within48: pct(hrs.filter((h) => h <= SLA.maxHours).length, hrs.length),
    breaches: hrs.filter((h) => h > SLA.maxHours).length,
    histogram: Array.from({ length: 8 }, (_, i) => ({ label: `${i * 8}–${i * 8 + 8}h`, from: i * 8, count: hrs.filter((h) => h >= i * 8 && h < i * 8 + 8).length })),
  };

  // ---- NPS
  const scores = disbursed.map((a) => a.nps).filter((x): x is number => x != null);
  const nps = scores.length ? round(((scores.filter((x) => x >= 9).length - scores.filter((x) => x <= 6).length) / scores.length) * 100, 0) : 0;

  // ---- weekly collection rate (borrower-collected vs due, last 26 weeks)
  const weeklySeries = Array.from({ length: 26 }, (_, i) => {
    const end = s.now - (25 - i) * WEEK, start = end - WEEK;
    let due = 0, collected = 0, guaranteed = 0;
    for (const l of loans) for (const w of l.weeks) if (w.dueMs > start && w.dueMs <= end) { due += l.schedule[w.installmentNo - 1].installmentDue; collected += w.collected; guaranteed += w.guaranteed; }
    return { weekEnding: new Date(end).toISOString().slice(0, 10), due: round(due, 0), collected: round(collected, 0), guaranteed: round(guaranteed, 0),
      borrowerRate: pct(collected, due), coveredRate: pct(collected + guaranteed, due) };
  });
  const last8 = weeklySeries.slice(-8);
  const collectionRate = pct(last8.reduce((a, w) => a + w.collected, 0), last8.reduce((a, w) => a + w.due, 0));
  const coveredRate = pct(last8.reduce((a, w) => a + w.collected + w.guaranteed, 0), last8.reduce((a, w) => a + w.due, 0));
  const effPcts = loans.flatMap((l) => l.weeks.filter((w) => w.payout > 0 && w.collected > 0).map((w) => w.effectivePct));

  // ---- arrears
  const outstanding = active.reduce((a, l) => a + outstandingPrincipal(l), 0);
  const par = (d: number) => pct(active.filter((l) => l.dpdNow >= d).reduce((a, l) => a + outstandingPrincipal(l), 0), outstanding);

  // ---- parametric
  const ev = s.evaluations;
  const triggered = ev.filter((e) => e.outcome === 'TRIGGERED');
  const paidTotal = triggered.reduce((a, e) => a + e.amount, 0);
  const feesTotal = loans.reduce((a, l) => a + l.policy.quote.fee, 0);
  const trigWeekly = Array.from({ length: 26 }, (_, i) => {
    const end = s.now - (25 - i) * WEEK, start = end - WEEK;
    const inW = ev.filter((e) => e.at > start && e.at <= end);
    return { weekEnding: new Date(end).toISOString().slice(0, 10), triggered: inW.filter((e) => e.outcome === 'TRIGGERED').length,
      paid: round(inW.filter((e) => e.outcome === 'TRIGGERED').reduce((a, e) => a + e.amount, 0), 0), review: inW.filter((e) => e.outcome === 'REVIEW').length,
      events: s.weatherEvents.filter((x) => x.observedAt > start && x.observedAt <= end).length };
  });
  const blockers: Record<string, number> = {};
  ev.filter((e) => e.outcome !== 'TRIGGERED').forEach((e) => e.checks.filter((c) => !c.pass).forEach((c) => { blockers[c.code] = (blockers[c.code] ?? 0) + 1; }));
  const byRegion = Object.entries(REGION_LABEL).map(([code, label]) => {
    const list = triggered.filter((e) => s.borrowers.get(e.borrowerId)?.region === code);
    return { code, label, count: list.length, paid: round(list.reduce((a, e) => a + e.amount, 0), 0) };
  }).filter((r) => r.count > 0).sort((a, b) => b.paid - a.paid);

  // ---- graduation
  const borrowers = [...s.borrowers.values()];
  const stageDist = LADDER.map((st) => ({ stage: st.stage, name: st.name, count: borrowers.filter((b) => b.stage === st.stage).length }));
  const graduated = loans.filter((l) => l.graduation?.eligible).length;
  const closed = loans.filter((l) => l.graduation).length;

  return {
    asOf: new Date(s.now).toISOString(),
    kpis: {
      activeLoans: active.length, outstanding: round(outstanding, 0), disbursedTotal: round(disbursed.reduce((a, x) => a + (s.loans.get('loan_' + x.id.slice(4))?.offer.principal ?? 0), 0), 0),
      applications30d: apps30.length, approvalRate: pct(disbursed.length, decided.length),
      medianSla: sla.median, nps, collectionRate, coveredRate, avgEffectiveDeduction: round(effPcts.reduce((a, b) => a + b, 0) / Math.max(1, effPcts.length)),
      par30: par(30), par90: par(90), triggerPayouts: round(paidTotal, 0), triggerCount: triggered.length,
      guaranteeLossRatio: pct(paidTotal, feesTotal), reviewQueue: ev.filter((e) => e.outcome === 'REVIEW').length,
    },
    sla, weeklySeries, trigWeekly, blockers, byRegion, stageDist, graduated, closed,
    funnel: (['DISBURSED', 'DECLINED', 'REFERRED', 'FAILED'] as const).map((st) => ({ status: st, count: s.applications.filter((a) => a.status === st).length })),
  };
}

export function partnerMetrics(s: Store) {
  return s.partners.map((p) => {
    const apps = s.applications.filter((a) => a.partnerId === p.id);
    const disb = apps.filter((a) => a.status === 'DISBURSED');
    const loans = [...s.loans.values()].filter((l) => l.partnerId === p.id);
    const h = s.partnerHealth.get(p.id)!;
    return {
      id: p.id, name: p.name, category: p.category, feedFormat: p.feedFormat, region: p.region,
      apps: apps.length, disbursed: disb.length, approvalRate: pct(disb.length, apps.length),
      medianSla: round(quantile(disb.map((a) => a.slaHours).sort((a, b) => a - b), 0.5)) || 0,
      active: loans.filter((l) => l.status === 'ACTIVE').length,
      par30: pct(loans.filter((l) => l.dpdNow >= 30).length, Math.max(1, loans.filter((l) => l.status === 'ACTIVE').length)),
      health: h,
    };
  });
}

export function recentApplications(s: Store, n = 25) {
  return s.applications.slice(0, n).map((a) => ({
    id: a.id, partner: s.partners.find((p) => p.id === a.partnerId)?.name ?? a.partnerId, borrower: s.borrowers.get(a.borrowerId)?.fullName ?? '—',
    status: a.status, slaHours: a.slaHours, slaBand: a.pipeline.slaBand, tier: a.underwriting?.tier ?? null,
    principal: a.underwriting?.offer?.principal ?? null, tenure: a.tenureMonths, receivedAt: a.receivedAt,
    reasons: a.underwriting?.reasons ?? [], steps: a.pipeline.steps,
  }));
}

export function borrowerRows(s: Store) {
  const rows = [...s.loans.values()].map((l) => {
    const b = s.borrowers.get(l.borrowerId)!;
    const partner = s.partners.find((p) => p.id === l.partnerId)!;
    const paidWeeks = l.weeks.filter((w) => w.status === 'PAID' || w.status === 'GUARANTEED').length;
    return {
      loanId: l.id, borrower: b.fullName, partner: partner.name, region: REGION_LABEL[b.region], tier: b.tier, score: Math.round(b.score),
      stage: b.stage, stageName: LADDER.find((x) => x.stage === b.stage)?.name ?? '', tenure: l.offer.tenureMonths, principal: l.offer.principal,
      installment: l.offer.weeklyInstallment, status: l.status, weeksDone: l.weeks.length, weeksTotal: l.offer.weeks, dpd: l.dpdNow,
      onTime: l.onTimeWeeks, guaranteed: l.guaranteedWeeks, claims: l.policy.terms.claimsPaid, maxClaims: l.policy.terms.maxClaims,
      progress: graduationProgress(l.onTimeWeeks + l.guaranteedWeeks, l.offer.weeks), graduation: l.graduation ?? null,
      onTrack: l.status === 'ACTIVE' && l.maxDpd <= 7 && paidWeeks >= l.weeks.length * 0.9,
      startMs: l.startMs,
    };
  });
  return rows.sort((a, b) => b.startMs - a.startMs);
}

/** Feature-store view: definitions + population stats + label maturity for the PD dashboard. */
export function pdPipelineView(s: Store) {
  const loans = [...s.loans.values()].filter((l) => l.pd);
  const mature = loans.filter((l) => l.status !== 'ACTIVE');
  const defaults = mature.filter((l) => l.status === 'DEFAULTED' || l.maxDpd >= 30);
  const stats = PD_FEATURES.map((f) => {
    const vals = loans.map((l) => Number(l.pd![f.name])).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    return { ...f, n: vals.length, mean: round(vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length), 3), p10: round(quantile(vals, 0.1), 3), p90: round(quantile(vals, 0.9), 3) };
  });
  const sample = loans.slice(0, 5).map((l) => ({ loanId: l.id, features: l.pd! }));
  const weatherAssisted = loans.filter((l) => l.guaranteedWeeks > 0);
  return {
    stats, sample,
    dataset: {
      snapshots: loans.length, matured: mature.length, labelledBad30: defaults.length,
      badRate: pct(defaults.length, mature.length), weatherAssisted: weatherAssisted.length,
      weatherAssistedBadRate: pct(weatherAssisted.filter((l) => l.maxDpd >= 30).length, weatherAssisted.length),
      minLabelsForFirstModel: 500,
    },
  };
}
