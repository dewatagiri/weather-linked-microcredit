import { evaluateTrigger, circlePolygon, defaultThreshold, GUARANTEE_TERMS, type RegionCode, type PolicyTerms } from '@/engine';
import { REGION_CENTRE, WEATHER_CELL_RADIUS_M } from '@/server/store';

/** Evaluate one hypothetical weather event against a hypothetical policy + worker ping. */
export async function POST(req: Request) {
  const b = await req.json();
  const region: RegionCode = b.region ?? 'KLANG_VALLEY';
  const centre = REGION_CENTRE[region];
  const threshold = defaultThreshold(region);
  const polygon = circlePolygon(centre, WEATHER_CELL_RADIUS_M);
  const localTime: string = b.localTime ?? '14:00';                    // HH:mm Malaysia time
  const date: string = b.date ?? '2026-11-20';
  const ts = `${date}T${localTime}:00+08:00`;
  const policy: PolicyTerms = {
    policyId: 'pol_sim', status: 'ACTIVE', timezone: 'Asia/Kuala_Lumpur', windowStart: '08:00', windowEnd: '19:00',
    rainThresholdMmHr: threshold.triggerMmHr, floodAlertLevel: 'WARNING', coverageStart: b.coverageStart ?? '2026-11-01', coverageEnd: b.coverageEnd ?? '2027-02-28',
    waitingPeriodDays: GUARANTEE_TERMS.waitingPeriodDays, maxClaims: 2, claimsPaid: Number(b.claimsPaid ?? 0), pingToleranceMin: 20, ipMaxRadiusM: 3000, gpsMaxAccuracyM: 200,
  };
  const dKm = Number(b.distanceKm ?? 2), bearing = (Number(b.bearingDeg ?? 45) * Math.PI) / 180;
  const lat = centre[1] + (dKm * 1000 * Math.cos(bearing)) / 111_320;
  const lng = centre[0] + (dKm * 1000 * Math.sin(bearing)) / (111_320 * Math.cos((centre[1] * Math.PI) / 180));
  const pingOffsetMin = Number(b.pingOffsetMin ?? 0);
  const pings = b.noPing ? [] : [{
    ts: new Date(Date.parse(ts) + pingOffsetMin * 60_000).toISOString(), lng, lat, source: (b.source ?? 'GPS') as 'GPS' | 'IP',
    accuracyM: Number(b.accuracyM ?? (b.source === 'IP' ? 1500 : 20)), onlineOnPlatform: b.online !== false,
  }];
  const evaluation = evaluateTrigger({
    event: { id: 'sim', observedAt: ts, rainfallMmHr: Number(b.rainMmHr ?? 40), floodAlert: b.floodAlert ?? 'NONE', polygon }, policy, pings,
    installments: [{ scheduleId: 'sched_sim', installmentNo: 4, dueDate: '2026-11-23', outstanding: Number(b.installment ?? 96.4), alreadyGuaranteed: false }],
  });
  return Response.json({ evaluation, threshold, centre, polygon, ping: pings[0] ? { lng, lat } : null, radiusM: WEATHER_CELL_RADIUS_M });
}
