// Shared domain types. Money is MYR as JS numbers rounded to sen via money().

export type PartnerCategory = 'E_HAILING' | 'DELIVERY' | 'LOGISTICS';
export type FeedFormat = 'WEEKLY_ARRAY' | 'MONTHLY_TOTALS' | 'TRIP_LEDGER';
export type CreditTier = 'A' | 'B' | 'C';
export type TenureMonths = 3 | 6 | 12;
export type FloodAlert = 'NONE' | 'ADVISORY' | 'WARNING' | 'DANGER';

export type RegionCode =
  | 'KLANG_VALLEY' | 'JOHOR' | 'PENANG' | 'KELANTAN'
  | 'TERENGGANU' | 'PAHANG' | 'SABAH' | 'SARAWAK';

/** Normalised applicant payload — what every partner adapter must produce. */
export interface ApplicantPayload {
  partnerId: string;
  externalWorkerId: string;
  fullName: string;
  nricLast4: string;
  phone?: string;
  homeRegion: RegionCode;
  platformTenureMonths: number;
  /** Trailing 26 weeks of platform payouts in MYR, oldest → newest. */
  weeklyPayouts: number[];
  /** Days worked per week, same length/order as weeklyPayouts. */
  weeklyActiveDays: number[];
  avgRating: number;        // 0–5
  cancellationRate: number; // 0–1
  requestedTenureMonths: TenureMonths;
  requestedAmount?: number;
}

export interface BureauResult {
  ctosScore: number;            // 300–850
  ccrisWorstArrearsMonths: number; // worst months-in-arrears over last 12m
  ccrisActiveFacilities: number;
  bankruptcyFlag: boolean;
}

export interface Money { amount: number }

export interface LoanOffer {
  principal: number;
  tenureMonths: TenureMonths;
  weeks: number;
  aprPct: number;
  weeklyInstallment: number;
  deductionRatePct: number; // 9–10
  weeklyCapPct: number;     // 15–30
  totalRepayable: number;
  stage: number;
}

export interface EarningsMetrics {
  weeks: number;
  avgWeekly: number;
  medianWeekly: number;
  cv: number;
  activeWeekRatio: number;
  avgActiveDays: number;
  trend: number; // last 8w mean / preceding mean
}

export interface UnderwritingResult {
  decision: 'APPROVED' | 'DECLINED' | 'REFER';
  score: number;
  tier: CreditTier | null;
  metrics: EarningsMetrics;
  reasons: string[];
  offer?: LoanOffer;
}

export interface ScheduleRow {
  installmentNo: number;
  dueDate: string; // YYYY-MM-DD
  principalDue: number;
  interestDue: number;
  installmentDue: number;
  balanceAfter: number;
}
