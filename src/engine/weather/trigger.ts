import type { FloodAlert } from '../types';
import { money } from '../math';
import { type LngLat, type Ring, pointInPolygon, haversineM } from './geo';
import { isWithinWorkingWindow } from './window';

const ALERT_RANK: Record<FloodAlert, number> = { NONE: 0, ADVISORY: 1, WARNING: 2, DANGER: 3 };

export interface WeatherEventInput {
  id: string;
  observedAt: string | number | Date;
  rainfallMmHr: number;
  floodAlert: FloodAlert;
  polygon: Ring;
}
export interface PolicyTerms {
  policyId: string;
  status: 'PENDING' | 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED' | 'CANCELLED';
  timezone: string;
  windowStart: string;
  windowEnd: string;
  rainThresholdMmHr: number;
  floodAlertLevel: FloodAlert;
  coverageStart: string; // YYYY-MM-DD (inclusive)
  coverageEnd: string;   // YYYY-MM-DD (inclusive)
  waitingPeriodDays: number;
  maxClaims: number;
  claimsPaid: number;
  pingToleranceMin: number;
  ipMaxRadiusM: number;
  gpsMaxAccuracyM: number;
}
export interface LocationPing {
  ts: string | number | Date;
  lng: number; lat: number;
  source: 'GPS' | 'IP';
  accuracyM: number;
  onlineOnPlatform: boolean;
}
export interface InstallmentRef {
  scheduleId: string;
  installmentNo: number;
  dueDate: string;        // YYYY-MM-DD
  outstanding: number;    // unpaid portion of the installment
  alreadyGuaranteed: boolean;
}

export type CheckCode =
  | 'POLICY_ACTIVE' | 'WAITING_PERIOD' | 'CLAIMS_REMAINING' | 'WEATHER_SEVERITY'
  | 'WORKING_WINDOW' | 'LOCATION_EVIDENCE' | 'GEOFENCE' | 'INSTALLMENT_AVAILABLE';
export interface CheckResult { code: CheckCode; pass: boolean; inconclusive?: boolean; detail: string }

export interface TriggerEvaluation {
  outcome: 'TRIGGERED' | 'NOT_TRIGGERED' | 'REVIEW';
  checks: CheckResult[];
  payout?: {
    payee: 'LENDER';          // guarantee — NEVER the rider
    amount: number;
    scheduleId: string;
    installmentNo: number;
    idempotencyKey: string;
  };
}

const DAY = 86_400_000;
const dayStart = (iso: string) => Date.parse(iso + 'T00:00:00+08:00');

/**
 * Parametric trigger evaluator. All checks are always computed (for audit),
 * then combined:
 *   TRIGGERED     – every check passed
 *   REVIEW        – only failures are inconclusive location evidence (coarse IP, stale ping)
 *   NOT_TRIGGERED – anything else
 */
export function evaluateTrigger(input: {
  event: WeatherEventInput;
  policy: PolicyTerms;
  pings: LocationPing[];
  installments: InstallmentRef[];
}): TriggerEvaluation {
  const { event, policy, pings, installments } = input;
  const t = new Date(event.observedAt).getTime();
  const checks: CheckResult[] = [];

  // 1. policy active & inside coverage dates
  const evDate = new Date(t + 8 * 3600_000).toISOString().slice(0, 10); // MY local date (UTC+8, no DST)
  const inCoverage = evDate >= policy.coverageStart && evDate <= policy.coverageEnd;
  checks.push({
    code: 'POLICY_ACTIVE',
    pass: policy.status === 'ACTIVE' && inCoverage,
    detail: `status ${policy.status}, coverage ${policy.coverageStart}→${policy.coverageEnd}, event ${evDate}`,
  });

  // 2. waiting period (anti-adverse-selection)
  const waitEnd = dayStart(policy.coverageStart) + policy.waitingPeriodDays * DAY;
  checks.push({
    code: 'WAITING_PERIOD', pass: t >= waitEnd,
    detail: t >= waitEnd ? 'waiting period served' : `still in ${policy.waitingPeriodDays}-day waiting period`,
  });

  // 3. claims remaining
  checks.push({
    code: 'CLAIMS_REMAINING', pass: policy.claimsPaid < policy.maxClaims,
    detail: `${policy.claimsPaid}/${policy.maxClaims} claims used`,
  });

  // 4. weather severity: rain ≥ threshold OR flood alert ≥ policy level
  const rainHit = event.rainfallMmHr >= policy.rainThresholdMmHr;
  const floodHit = ALERT_RANK[event.floodAlert] >= ALERT_RANK[policy.floodAlertLevel];
  checks.push({
    code: 'WEATHER_SEVERITY', pass: rainHit || floodHit,
    detail: `rain ${event.rainfallMmHr} mm/hr vs ${policy.rainThresholdMmHr}${rainHit ? ' ✔' : ''}; flood ${event.floodAlert} vs ${policy.floodAlertLevel}${floodHit ? ' ✔' : ''}`,
  });

  // 5. active working window (local time)
  const w = isWithinWorkingWindow(t, policy.timezone, policy.windowStart, policy.windowEnd);
  checks.push({
    code: 'WORKING_WINDOW', pass: w.within,
    detail: `local ${w.localTime} ${w.within ? 'inside' : 'outside'} ${policy.windowStart}–${policy.windowEnd}`,
  });

  // 6/7. location evidence at the event timestamp
  const tolMs = policy.pingToleranceMin * 60_000;
  const nearest = pings
    .map((p) => ({ p, dt: Math.abs(new Date(p.ts).getTime() - t) }))
    .filter((x) => x.dt <= tolMs)
    .sort((a, b) => a.dt - b.dt)[0];
  if (!nearest) {
    checks.push({ code: 'LOCATION_EVIDENCE', pass: false, inconclusive: true, detail: `no ping within ±${policy.pingToleranceMin} min of event` });
    checks.push({ code: 'GEOFENCE', pass: false, inconclusive: true, detail: 'skipped — no location evidence' });
  } else {
    const { p, dt } = nearest;
    const maxAcc = p.source === 'GPS' ? policy.gpsMaxAccuracyM : policy.ipMaxRadiusM;
    const precise = p.accuracyM <= maxAcc;
    checks.push({
      code: 'LOCATION_EVIDENCE', pass: precise && p.onlineOnPlatform, inconclusive: !precise,
      detail: `${p.source} ping ${Math.round(dt / 1000)}s from event, ±${p.accuracyM}m (max ${maxAcc}m), ${p.onlineOnPlatform ? 'online' : 'OFFLINE'} on platform`,
    });
    const pt: LngLat = [p.lng, p.lat];
    const inside = pointInPolygon(pt, event.polygon);
    const cx = event.polygon.reduce((a, c) => a + c[0], 0) / event.polygon.length;
    const cy = event.polygon.reduce((a, c) => a + c[1], 0) / event.polygon.length;
    checks.push({
      code: 'GEOFENCE', pass: inside, inconclusive: false,
      detail: `${inside ? 'inside' : 'OUTSIDE'} weather polygon (${Math.round(haversineM(pt, [cx, cy]))}m from cell centre)`,
    });
  }

  // 8. an unsettled installment to guarantee (earliest unguaranteed, not-yet-paid)
  const target = installments
    .filter((i) => !i.alreadyGuaranteed && i.outstanding > 0.005)
    .sort((a, b) => a.installmentNo - b.installmentNo)[0];
  checks.push({
    code: 'INSTALLMENT_AVAILABLE', pass: !!target,
    detail: target ? `installment #${target.installmentNo} outstanding RM${target.outstanding.toFixed(2)}` : 'nothing outstanding / already guaranteed',
  });

  const failed = checks.filter((c) => !c.pass);
  if (failed.length === 0 && target) {
    return {
      outcome: 'TRIGGERED', checks,
      payout: {
        payee: 'LENDER',
        amount: money(target.outstanding),
        scheduleId: target.scheduleId,
        installmentNo: target.installmentNo,
        idempotencyKey: `${policy.policyId}:${event.id}:${target.installmentNo}`,
      },
    };
  }
  const onlyInconclusive = failed.length > 0 && failed.every((c) => c.inconclusive);
  return { outcome: onlyInconclusive ? 'REVIEW' : 'NOT_TRIGGERED', checks };
}
