import { describe, it, expect } from 'vitest';
import { evaluateGraduation } from '@/engine';

const clean = { weeksTotal: 26, onTimeWeeks: 25, guaranteeCoveredWeeks: 0, maxDaysPastDue: 0, defaulted: false, fullyRepaid: true };
describe('graduation', () => {
  it('graduates a clean repayer to the next stage with a larger limit', () => {
    const g = evaluateGraduation({ currentStage: 1, loan: clean, refreshedScore: 70, refreshedAvgWeekly: 900 });
    expect(g.eligible).toBe(true);
    expect(g.toStage).toBe(2);
    expect(g.newLimit).toBeGreaterThan(4000);
  });
  it('blocks on late payments, delinquency, default or open loan', () => {
    const base = { currentStage: 1, refreshedScore: 70, refreshedAvgWeekly: 900 };
    expect(evaluateGraduation({ ...base, loan: { ...clean, onTimeWeeks: 20 } }).eligible).toBe(false);
    expect(evaluateGraduation({ ...base, loan: { ...clean, maxDaysPastDue: 14 } }).eligible).toBe(false);
    expect(evaluateGraduation({ ...base, loan: { ...clean, defaulted: true } }).eligible).toBe(false);
    expect(evaluateGraduation({ ...base, loan: { ...clean, fullyRepaid: false } }).eligible).toBe(false);
  });
  it('weather-guaranteed weeks are neutral — they do not count as misses', () => {
    const loan = { ...clean, onTimeWeeks: 21, guaranteeCoveredWeeks: 3 }; // 21 of 23 counted = 91%
    expect(evaluateGraduation({ currentStage: 1, loan, refreshedScore: 70, refreshedAvgWeekly: 900 }).eligible).toBe(true);
  });
  it('requires the refreshed score to clear the next stage bar; top stage cannot graduate', () => {
    expect(evaluateGraduation({ currentStage: 1, loan: clean, refreshedScore: 50, refreshedAvgWeekly: 900 }).eligible).toBe(false);
    expect(evaluateGraduation({ currentStage: 4, loan: clean, refreshedScore: 99, refreshedAvgWeekly: 3000 }).eligible).toBe(false);
  });
  it('limit is bounded by earning capacity', () => {
    const g = evaluateGraduation({ currentStage: 1, loan: clean, refreshedScore: 70, refreshedAvgWeekly: 450 });
    expect(g.newLimit).toBe(8000); // capacity 20×450=9000 → stage-2 cap binds
    const thin = evaluateGraduation({ currentStage: 1, loan: clean, refreshedScore: 70, refreshedAvgWeekly: 300 });
    expect(thin.newLimit).toBe(6000); // capacity binds
  });
});
