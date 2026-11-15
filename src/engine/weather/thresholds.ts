import type { RegionCode } from '../types';
import { quantile, rng } from '../math';

export interface HourlyObs { ts: number; mmHr: number }
export interface CalibratedThreshold {
  regionCode: string;
  years: number;
  triggerMmHr: number;   // parametric trigger level
  extremeMmHr: number;
  expectedTriggerHoursPerYear: number;
  wetHourShare: number;
}

export const DEFAULT_TRIGGER_QUANTILE = 0.985; // of wet hours
export const MIN_YEARS_OF_HISTORY = 8;

/**
 * Calibrate the rainfall trigger from ≥8 years (target 10) of hourly gauge data.
 * Trigger level = `quantile` of *wet-hour* intensities (≥0.1 mm/hr), so it reflects
 * "unusually heavy for this region" rather than the climatological mean, and a
 * wetter region (East Coast) automatically gets a higher bar than a drier one.
 */
export function calibrateRainThreshold(
  regionCode: string, series: HourlyObs[], quantileLevel = DEFAULT_TRIGGER_QUANTILE,
): CalibratedThreshold {
  if (!series.length) throw new Error('empty rainfall history');
  const spanYears = (series[series.length - 1].ts - series[0].ts) / (365.25 * 86_400_000);
  if (spanYears < MIN_YEARS_OF_HISTORY) throw new Error(`need ≥${MIN_YEARS_OF_HISTORY}y of history, got ${spanYears.toFixed(1)}y`);
  const wet = series.filter((o) => o.mmHr >= 0.1).map((o) => o.mmHr).sort((a, b) => a - b);
  const trigger = quantile(wet, quantileLevel);
  const extreme = quantile(wet, 0.997);
  const exceed = wet.filter((x) => x >= trigger).length;
  return {
    regionCode,
    years: spanYears,
    triggerMmHr: Math.round(trigger * 10) / 10,
    extremeMmHr: Math.round(extreme * 10) / 10,
    expectedTriggerHoursPerYear: exceed / spanYears,
    wetHourShare: wet.length / series.length,
  };
}

/** Climate scale per region (relative wetness) — drives the synthetic history below. */
export const REGION_CLIMATE: Record<RegionCode, { wetShare: number; scaleMm: number; monsoonBoost: number }> = {
  KLANG_VALLEY: { wetShare: 0.07, scaleMm: 6.5, monsoonBoost: 1.3 },
  JOHOR:        { wetShare: 0.07, scaleMm: 6.5, monsoonBoost: 1.5 },
  PENANG:       { wetShare: 0.06, scaleMm: 6.0, monsoonBoost: 1.2 },
  KELANTAN:     { wetShare: 0.08, scaleMm: 8.0, monsoonBoost: 2.0 },
  TERENGGANU:   { wetShare: 0.08, scaleMm: 8.5, monsoonBoost: 2.1 },
  PAHANG:       { wetShare: 0.075, scaleMm: 7.5, monsoonBoost: 1.8 },
  SABAH:        { wetShare: 0.07, scaleMm: 7.0, monsoonBoost: 1.4 },
  SARAWAK:      { wetShare: 0.09, scaleMm: 7.5, monsoonBoost: 1.3 },
};

/** Synthetic 10-year hourly series (exponential-tailed wet hours, NE-monsoon boost). For demo/tests only. */
export function syntheticHistory(region: RegionCode, years = 10, seed = 7): HourlyObs[] {
  const c = REGION_CLIMATE[region];
  const r = rng(seed + region.length * 31 + region.charCodeAt(0));
  const start = Date.UTC(2015, 0, 1);
  const out: HourlyObs[] = [];
  for (let i = 0; i < years * 365 * 24; i++) {
    const ts = start + i * 3_600_000;
    const month = new Date(ts).getUTCMonth() + 1;
    const monsoon = month >= 11 || month <= 1 ? c.monsoonBoost : 1;
    const wet = r.next() < c.wetShare * (monsoon > 1 ? 1 + (monsoon - 1) * 0.6 : 1);
    out.push({ ts, mmHr: wet ? -Math.log(1 - r.next()) * c.scaleMm * (1 + (monsoon - 1) * 0.25) : 0 });
  }
  return out;
}

const cache = new Map<string, CalibratedThreshold>();
export function defaultThreshold(region: RegionCode): CalibratedThreshold {
  let t = cache.get(region);
  if (!t) { t = calibrateRainThreshold(region, syntheticHistory(region)); cache.set(region, t); }
  return t;
}
