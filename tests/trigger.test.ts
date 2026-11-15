import { describe, it, expect } from 'vitest';
import {
  evaluateTrigger, circlePolygon, pointInPolygon, isWithinWorkingWindow, calibrateRainThreshold, syntheticHistory,
  type PolicyTerms, type WeatherEventInput, type LocationPing, type InstallmentRef,
} from '@/engine';

const KL: [number, number] = [101.6869, 3.139];
const polygon = circlePolygon(KL, 8000);
const policy: PolicyTerms = {
  policyId: 'pol1', status: 'ACTIVE', timezone: 'Asia/Kuala_Lumpur', windowStart: '08:00', windowEnd: '19:00',
  rainThresholdMmHr: 30, floodAlertLevel: 'WARNING', coverageStart: '2026-11-01', coverageEnd: '2027-02-01',
  waitingPeriodDays: 7, maxClaims: 2, claimsPaid: 0, pingToleranceMin: 20, ipMaxRadiusM: 3000, gpsMaxAccuracyM: 200,
};
// 2026-11-20 are +08:00 local times; ISO with offset keeps tests readable.
const ev = (local: string, rain = 45, flood: WeatherEventInput['floodAlert'] = 'NONE'): WeatherEventInput =>
  ({ id: 'ev-' + local, observedAt: `2026-11-20T${local}:00+08:00`, rainfallMmHr: rain, floodAlert: flood, polygon });
const ping = (local: string, over: Partial<LocationPing> = {}): LocationPing =>
  ({ ts: `2026-11-20T${local}:00+08:00`, lng: KL[0] + 0.01, lat: KL[1] + 0.01, source: 'GPS', accuracyM: 15, onlineOnPlatform: true, ...over });
const inst: InstallmentRef[] = [{ scheduleId: 's3', installmentNo: 3, dueDate: '2026-11-23', outstanding: 96.4, alreadyGuaranteed: false }];
const run = (e: WeatherEventInput, pings: LocationPing[], p = policy, i = inst) => evaluateTrigger({ event: e, policy: p, pings, installments: i });
const failing = (r: ReturnType<typeof run>) => r.checks.filter((c) => !c.pass).map((c) => c.code);

describe('geo + window primitives', () => {
  it('point-in-polygon', () => {
    expect(pointInPolygon(KL, polygon)).toBe(true);
    expect(pointInPolygon([102.5, 3.139], polygon)).toBe(false);
  });
  it('08:00 inclusive, 19:00 exclusive, 04:00 outside — in local time regardless of UTC', () => {
    const w = (iso: string) => isWithinWorkingWindow(iso).within;
    expect(w('2026-11-20T08:00:00+08:00')).toBe(true);
    expect(w('2026-11-20T18:59:00+08:00')).toBe(true);
    expect(w('2026-11-20T19:00:00+08:00')).toBe(false);
    expect(w('2026-11-20T04:00:00+08:00')).toBe(false);
    expect(w('2026-11-20T00:30:00Z')).toBe(true); // = 08:30 MYT
    expect(w('2026-11-20T12:00:00Z')).toBe(false); // = 20:00 MYT
  });
});

describe('parametric trigger evaluator', () => {
  it('TRIGGERS: heavy rain, 14:00 local, GPS inside the polygon → pays the LENDER the outstanding installment', () => {
    const r = run(ev('14:00'), [ping('14:05')]);
    expect(r.outcome).toBe('TRIGGERED');
    expect(r.payout).toMatchObject({ payee: 'LENDER', amount: 96.4, installmentNo: 3, scheduleId: 's3' });
    expect(r.payout!.idempotencyKey).toBe('pol1:ev-14:00:3');
  });
  it('ignores off-peak events: same storm at 04:00 does not trigger', () => {
    const r = run(ev('04:00', 80), [ping('04:00')]);
    expect(r.outcome).toBe('NOT_TRIGGERED');
    expect(failing(r)).toEqual(['WORKING_WINDOW']);
  });
  it('rain below calibrated threshold does not trigger; flood alert alone does', () => {
    expect(failing(run(ev('10:00', 12), [ping('10:00')]))).toEqual(['WEATHER_SEVERITY']);
    expect(run(ev('10:00', 12, 'WARNING'), [ping('10:00')]).outcome).toBe('TRIGGERED');
    expect(run(ev('10:00', 12, 'ADVISORY'), [ping('10:00')]).outcome).toBe('NOT_TRIGGERED');
  });
  it('geofence: worker outside the weather polygon → NOT_TRIGGERED', () => {
    const r = run(ev('14:00'), [ping('14:00', { lng: 102.4 })]);
    expect(r.outcome).toBe('NOT_TRIGGERED');
    expect(failing(r)).toContain('GEOFENCE');
  });
  it('requires the worker to be online on the platform', () => {
    expect(run(ev('14:00'), [ping('14:00', { onlineOnPlatform: false })]).outcome).toBe('NOT_TRIGGERED');
  });
  it('location ping must be near the event timestamp; stale/no ping → REVIEW, not silent drop', () => {
    const r = run(ev('14:00'), [ping('13:00')]);
    expect(r.outcome).toBe('REVIEW');
    expect(run(ev('14:00'), []).outcome).toBe('REVIEW');
  });
  it('coarse IP fix: inside polygon but radius too large → REVIEW; precise IP → TRIGGERED', () => {
    expect(run(ev('14:00'), [ping('14:00', { source: 'IP', accuracyM: 25_000 })]).outcome).toBe('REVIEW');
    expect(run(ev('14:00'), [ping('14:00', { source: 'IP', accuracyM: 1500 })]).outcome).toBe('TRIGGERED');
  });
  it('picks the ping closest in time to the event', () => {
    const r = run(ev('14:00'), [ping('13:50', { lng: 102.4 }), ping('14:01')]);
    expect(r.outcome).toBe('TRIGGERED');
  });
  it('waiting period, expired coverage, exhausted claims and no outstanding installment all block', () => {
    const e = ev('14:00'), p = [ping('14:00')];
    expect(run(e, p, { ...policy, coverageStart: '2026-11-18' }).outcome).toBe('NOT_TRIGGERED');
    expect(run(e, p, { ...policy, coverageEnd: '2026-11-19' }).outcome).toBe('NOT_TRIGGERED');
    expect(run(e, p, { ...policy, claimsPaid: 2 }).outcome).toBe('NOT_TRIGGERED');
    expect(run(e, p, policy, [{ ...inst[0], alreadyGuaranteed: true }]).outcome).toBe('NOT_TRIGGERED');
    expect(run(e, p, { ...policy, status: 'CANCELLED' }).outcome).toBe('NOT_TRIGGERED');
  });
  it('pays only what is outstanding and targets the earliest unguaranteed installment', () => {
    const i: InstallmentRef[] = [
      { scheduleId: 's4', installmentNo: 4, dueDate: '2026-11-30', outstanding: 96, alreadyGuaranteed: false },
      { scheduleId: 's3', installmentNo: 3, dueDate: '2026-11-23', outstanding: 40, alreadyGuaranteed: false },
    ];
    const r = run(ev('14:00'), [ping('14:00')], policy, i);
    expect(r.payout).toMatchObject({ installmentNo: 3, amount: 40 });
  });
  it('every evaluation reports all checks for audit', () => {
    expect(run(ev('04:00', 1), []).checks.map((c) => c.code)).toEqual([
      'POLICY_ACTIVE', 'WAITING_PERIOD', 'CLAIMS_REMAINING', 'WEATHER_SEVERITY', 'WORKING_WINDOW', 'LOCATION_EVIDENCE', 'GEOFENCE', 'INSTALLMENT_AVAILABLE',
    ]);
  });
});

describe('threshold calibration', () => {
  const hist = syntheticHistory('KLANG_VALLEY');
  it('calibrates a trigger from ~10 years of hourly data with a sensible exceedance frequency', () => {
    const t = calibrateRainThreshold('KLANG_VALLEY', hist);
    expect(t.years).toBeGreaterThan(9.9);
    expect(t.triggerMmHr).toBeGreaterThan(15);
    expect(t.extremeMmHr).toBeGreaterThan(t.triggerMmHr);
    expect(t.expectedTriggerHoursPerYear).toBeGreaterThan(5);
    expect(t.expectedTriggerHoursPerYear).toBeLessThan(200);
  });
  it('wetter East Coast gets a higher bar than Penang; refuses short histories', () => {
    expect(calibrateRainThreshold('K', syntheticHistory('KELANTAN')).triggerMmHr).toBeGreaterThan(calibrateRainThreshold('P', syntheticHistory('PENANG')).triggerMmHr);
    expect(() => calibrateRainThreshold('X', hist.slice(0, 24 * 365 * 3))).toThrow(/history/);
  });
});
