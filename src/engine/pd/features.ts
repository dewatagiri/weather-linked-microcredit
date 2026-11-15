import { mean, stdev } from '../math';

export interface PdFeatureDef { name: string; family: 'EARNINGS' | 'ACTIVITY' | 'REPAYMENT' | 'WEATHER' | 'BUREAU' | 'PROFILE'; dtype: 'float' | 'int' | 'bool'; description: string }

export const PD_FEATURES: PdFeatureDef[] = [
  { name: 'avg_weekly_payout_26w', family: 'EARNINGS', dtype: 'float', description: 'Mean weekly platform payout, trailing 26 weeks at origination' },
  { name: 'payout_cv_26w', family: 'EARNINGS', dtype: 'float', description: 'Coefficient of variation of weekly payouts' },
  { name: 'payout_trend_8v18', family: 'EARNINGS', dtype: 'float', description: 'Mean of last 8 weeks ÷ mean of previous 18' },
  { name: 'active_week_ratio', family: 'ACTIVITY', dtype: 'float', description: 'Share of weeks with any payout' },
  { name: 'avg_active_days', family: 'ACTIVITY', dtype: 'float', description: 'Mean days worked per week' },
  { name: 'platform_rating', family: 'PROFILE', dtype: 'float', description: 'Partner-reported rating (0–5)' },
  { name: 'cancellation_rate', family: 'PROFILE', dtype: 'float', description: 'Partner-reported cancellation share' },
  { name: 'platform_tenure_months', family: 'PROFILE', dtype: 'int', description: 'Months on the platform' },
  { name: 'ctos_score', family: 'BUREAU', dtype: 'int', description: 'CTOS score at origination' },
  { name: 'installment_to_income', family: 'REPAYMENT', dtype: 'float', description: 'Weekly installment ÷ trailing mean payout' },
  { name: 'weeks_on_book', family: 'REPAYMENT', dtype: 'int', description: 'Observation point in loan life' },
  { name: 'paid_on_time_ratio_to_date', family: 'REPAYMENT', dtype: 'float', description: 'On-time weeks ÷ weeks elapsed' },
  { name: 'max_dpd_to_date', family: 'REPAYMENT', dtype: 'int', description: 'Worst days-past-due so far' },
  { name: 'avg_collection_pct_to_date', family: 'REPAYMENT', dtype: 'float', description: 'Mean collected ÷ payout (%), weeks elapsed' },
  { name: 'payout_drop_events_to_date', family: 'REPAYMENT', dtype: 'int', description: 'Weeks where payout < 50% of trailing mean' },
  { name: 'rain_trigger_weeks_to_date', family: 'WEATHER', dtype: 'int', description: 'Weeks with a qualifying or attempted weather trigger' },
  { name: 'guarantee_paid_to_date', family: 'WEATHER', dtype: 'float', description: 'MYR paid by guarantee so far' },
  { name: 'rain_hours_in_window_4w', family: 'WEATHER', dtype: 'float', description: 'Heavy-rain hours in 08–19 window, last 4 weeks, home region' },
  { name: 'income_loss_vs_rain_elasticity', family: 'WEATHER', dtype: 'float', description: 'Payout change in heavy-rain weeks vs dry weeks (relative)' },
  { name: 'origination_in_q4', family: 'WEATHER', dtype: 'bool', description: 'Loan originated Oct–Dec' },
];

export interface FeatureSnapshotInput {
  weeklyPayouts26: number[]; weeklyActiveDays: number[]; rating: number; cancellationRate: number; tenureMonths: number;
  ctosScore: number; installment: number;
  realisedPayouts: number[]; collected: number[]; dpdByWeek: number[]; guaranteeWeeks: number[]; guaranteePaid: number;
  rainHoursLast4w: number; rainWeekFlags: boolean[]; originationMonth: number;
}

export function buildFeatureSnapshot(i: FeatureSnapshotInput): Record<string, number | boolean> {
  const avg = mean(i.weeklyPayouts26);
  const last8 = i.weeklyPayouts26.slice(-8), prior = i.weeklyPayouts26.slice(0, -8);
  const weeks = i.realisedPayouts.length;
  const rainy = i.realisedPayouts.filter((_, k) => i.rainWeekFlags[k]);
  const dry = i.realisedPayouts.filter((_, k) => !i.rainWeekFlags[k]);
  const onTime = i.collected.filter((c, k) => c + (i.guaranteeWeeks.includes(k) ? 1e9 : 0) >= i.installment - 0.01).length;
  return {
    avg_weekly_payout_26w: avg,
    payout_cv_26w: avg ? stdev(i.weeklyPayouts26) / avg : 0,
    payout_trend_8v18: prior.length && mean(prior) ? mean(last8) / mean(prior) : 1,
    active_week_ratio: i.weeklyPayouts26.filter((x) => x > 0).length / Math.max(1, i.weeklyPayouts26.length),
    avg_active_days: mean(i.weeklyActiveDays),
    platform_rating: i.rating, cancellation_rate: i.cancellationRate, platform_tenure_months: i.tenureMonths,
    ctos_score: i.ctosScore, installment_to_income: avg ? i.installment / avg : 0,
    weeks_on_book: weeks,
    paid_on_time_ratio_to_date: weeks ? onTime / weeks : 1,
    max_dpd_to_date: Math.max(0, ...i.dpdByWeek),
    avg_collection_pct_to_date: weeks ? mean(i.collected.map((c, k) => (i.realisedPayouts[k] > 0 ? (c / i.realisedPayouts[k]) * 100 : 0))) : 0,
    payout_drop_events_to_date: i.realisedPayouts.filter((p) => p < 0.5 * avg).length,
    rain_trigger_weeks_to_date: i.rainWeekFlags.filter(Boolean).length,
    guarantee_paid_to_date: i.guaranteePaid,
    rain_hours_in_window_4w: i.rainHoursLast4w,
    income_loss_vs_rain_elasticity: rainy.length && dry.length && mean(dry) ? mean(rainy) / mean(dry) - 1 : 0,
    origination_in_q4: i.originationMonth >= 10,
  };
}

/** Default-label rule: ≥90 DPD or write-off within horizon; guarantee-covered weeks do NOT count as delinquency. */
export const defaultLabel = (maxDpd: number, writtenOff: boolean) => writtenOff || maxDpd >= 90;
