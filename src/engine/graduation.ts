import type { TenureMonths } from './types';
import { clamp } from './math';

export interface FacilityStage {
  stage: number;
  name: string;
  tenures: TenureMonths[];
  maxPrincipal: number;
  minScore: number; // refreshed alt-score required to *enter* this stage
}

/** Illustrative ladder: start with 3/6-month micro-financing, graduate upward. */
export const LADDER: FacilityStage[] = [
  { stage: 1, name: 'Starter',     tenures: [3, 6],  maxPrincipal: 4000,  minScore: 45 },
  { stage: 2, name: 'Builder',     tenures: [6, 12], maxPrincipal: 8000,  minScore: 55 },
  { stage: 3, name: 'Established', tenures: [12],    maxPrincipal: 15000, minScore: 65 },
  { stage: 4, name: 'Prime',       tenures: [12],    maxPrincipal: 25000, minScore: 72 },
];
export const stageOf = (n: number) => LADDER.find((s) => s.stage === n) ?? LADDER[0];

export interface CompletedLoanSummary {
  weeksTotal: number;
  onTimeWeeks: number;        // paid in full by borrower collection
  guaranteeCoveredWeeks: number; // paid by weather guarantee — neutral, not a miss
  maxDaysPastDue: number;
  defaulted: boolean;
  fullyRepaid: boolean;
}

export interface GraduationInput {
  currentStage: number;
  loan: CompletedLoanSummary;
  refreshedScore: number;
  refreshedAvgWeekly: number;
}

export interface GraduationResult {
  eligible: boolean;
  fromStage: number;
  toStage: number;
  newLimit: number;
  onTimeRatio: number;
  checks: { rule: string; pass: boolean; detail: string }[];
}

export const GRADUATION_RULES = {
  minOnTimeRatio: 0.9,
  maxDaysPastDue: 7,
};

/**
 * Graduation: loan fully repaid, ≥90 % weeks on time (weather-guaranteed weeks
 * are neutral — they are excluded from numerator and denominator), no default,
 * worst delinquency ≤7 DPD, and refreshed score clears the next stage's bar.
 * The new limit is also bounded by capacity (≈ 26 × 9.5 % of weekly earnings
 * discounted for interest ≈ 20 × avg weekly) so a stage cap never over-lends.
 */
export function evaluateGraduation(inp: GraduationInput): GraduationResult {
  const { loan } = inp;
  const counted = Math.max(1, loan.weeksTotal - loan.guaranteeCoveredWeeks);
  const onTimeRatio = loan.onTimeWeeks / counted;
  const next = LADDER.find((s) => s.stage === inp.currentStage + 1);
  const target = next ?? stageOf(inp.currentStage);

  const checks = [
    { rule: 'Loan fully repaid', pass: loan.fullyRepaid, detail: loan.fullyRepaid ? 'closed' : 'still open' },
    { rule: 'No default', pass: !loan.defaulted, detail: loan.defaulted ? 'defaulted' : 'clean' },
    {
      rule: `On-time ≥ ${GRADUATION_RULES.minOnTimeRatio * 100}%`,
      pass: onTimeRatio >= GRADUATION_RULES.minOnTimeRatio,
      detail: `${(onTimeRatio * 100).toFixed(0)}% of ${counted} counted weeks`,
    },
    {
      rule: `Worst DPD ≤ ${GRADUATION_RULES.maxDaysPastDue}`,
      pass: loan.maxDaysPastDue <= GRADUATION_RULES.maxDaysPastDue,
      detail: `${loan.maxDaysPastDue} days`,
    },
    {
      rule: `Refreshed score ≥ ${target.minScore}`,
      pass: inp.refreshedScore >= target.minScore,
      detail: `score ${inp.refreshedScore.toFixed(0)}`,
    },
    { rule: 'Higher stage available', pass: !!next, detail: next ? next.name : 'already top stage' },
  ];
  const eligible = checks.every((c) => c.pass);
  const capacity = Math.floor((inp.refreshedAvgWeekly * 20) / 50) * 50;
  const newLimit = eligible ? clamp(Math.min(target.maxPrincipal, capacity), 0, target.maxPrincipal) : stageOf(inp.currentStage).maxPrincipal;
  return {
    eligible,
    fromStage: inp.currentStage,
    toStage: eligible ? target.stage : inp.currentStage,
    newLimit,
    onTimeRatio,
    checks,
  };
}

/** Progress (0–1) of an in-flight loan towards graduation based on weeks paid on time. */
export function graduationProgress(paidOnTimeWeeks: number, weeksTotal: number, minRatio = GRADUATION_RULES.minOnTimeRatio) {
  if (weeksTotal <= 0) return 0;
  return clamp(paidOnTimeWeeks / (weeksTotal * minRatio), 0, 1);
}
