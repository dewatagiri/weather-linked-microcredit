import type { LoanOffer, ScheduleRow } from './types';
import { addDays, isoDate, money } from './math';
import { annuityPayment } from './underwriting';

/** Level weekly amortisation; final row absorbs rounding so balance ends at exactly 0. */
export function buildSchedule(opts: { principal: number; aprPct: number; weeks: number; firstDueDate: Date }): ScheduleRow[] {
  const r = opts.aprPct / 100 / 52;
  const pay = Math.ceil(annuityPayment(opts.principal, opts.aprPct, opts.weeks) * 100) / 100;
  const rows: ScheduleRow[] = [];
  let bal = opts.principal;
  for (let n = 1; n <= opts.weeks; n++) {
    const interest = money(bal * r);
    let principalPart = money(pay - interest);
    let inst = pay;
    if (n === opts.weeks || principalPart > bal) { principalPart = money(bal); inst = money(principalPart + interest); }
    bal = money(bal - principalPart);
    rows.push({
      installmentNo: n,
      dueDate: isoDate(addDays(opts.firstDueDate, 7 * (n - 1))),
      principalDue: principalPart, interestDue: interest, installmentDue: inst, balanceAfter: bal,
    });
  }
  return rows;
}
export const scheduleFromOffer = (o: LoanOffer, firstDueDate: Date) =>
  buildSchedule({ principal: o.principal, aprPct: o.aprPct, weeks: o.weeks, firstDueDate });

export interface CollectionParams {
  deductionRatePct: number;
  weeklyCapPct: number;
  trailingAvgWeekly: number;
}
export interface WeeklyCollection {
  due: number;            // installment + arrears carried in − guarantee payment
  fractionalTarget: number; // deductionRate × payout (informational: nominal 9–10 % slice)
  ceiling: number;        // capPct × min(payout, trailing avg)
  collected: number;
  shortfall: number;      // carried forward as arrears
  effectivePct: number;   // collected / payout × 100
}

/**
 * Fractionalised weekly auto-deduction for ONE week.
 *  - the lender is owed `installment + arrears − guaranteed`
 *  - we may debit at most capPct × min(payout, trailing 6m avg)  ← affordability cap
 *  - whatever cannot be collected rolls into arrears (never above the cap later either)
 */
export function computeWeeklyCollection(opts: {
  payout: number; installment: number; arrearsIn: number; guaranteed?: number; params: CollectionParams;
}): WeeklyCollection {
  const { payout, installment, arrearsIn, params } = opts;
  const due = money(Math.max(0, installment + arrearsIn - (opts.guaranteed ?? 0)));
  const ceiling = money((params.weeklyCapPct / 100) * Math.min(Math.max(payout, 0), params.trailingAvgWeekly));
  const collected = money(Math.min(due, ceiling));
  return {
    due,
    fractionalTarget: money((params.deductionRatePct / 100) * Math.max(payout, 0)),
    ceiling,
    collected,
    shortfall: money(due - collected),
    effectivePct: payout > 0 ? (collected / payout) * 100 : 0,
  };
}

export interface SimulatedWeek extends WeeklyCollection {
  installmentNo: number;
  dueDate: string;
  payout: number;
  guaranteed: number;
  arrearsOut: number;
  status: 'PAID' | 'PARTIAL' | 'OVERDUE' | 'GUARANTEED';
}

/** Run the collection engine across a schedule given realised payouts (and guarantee payouts by installment no). */
export function simulateCollections(
  schedule: ScheduleRow[], payouts: number[], params: CollectionParams, guaranteed: Record<number, number> = {},
): { weeks: SimulatedWeek[]; arrears: number; totalCollected: number; totalGuaranteed: number } {
  let arrears = 0, totalCollected = 0, totalGuaranteed = 0;
  const weeks: SimulatedWeek[] = [];
  schedule.forEach((row, i) => {
    if (i >= payouts.length) return;
    const g = guaranteed[row.installmentNo] ?? 0;
    const c = computeWeeklyCollection({ payout: payouts[i], installment: row.installmentDue, arrearsIn: arrears, guaranteed: g, params });
    arrears = c.shortfall;
    totalCollected += c.collected;
    totalGuaranteed += g;
    const status: SimulatedWeek['status'] =
      g > 0 && c.shortfall === 0 && c.collected < row.installmentDue ? 'GUARANTEED'
      : c.shortfall === 0 ? 'PAID' : c.collected > 0 ? 'PARTIAL' : 'OVERDUE';
    weeks.push({ ...c, installmentNo: row.installmentNo, dueDate: row.dueDate, payout: payouts[i], guaranteed: g, arrearsOut: arrears, status });
  });
  return { weeks, arrears, totalCollected: money(totalCollected), totalGuaranteed: money(totalGuaranteed) };
}

/** Days past due given arrears expressed in weeks of installment. */
export const daysPastDue = (arrears: number, installment: number) =>
  installment > 0 && arrears > 0.005 ? Math.ceil(arrears / installment) * 7 : 0;
