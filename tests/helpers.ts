import type { ApplicantPayload } from '@/engine';

export function applicant(over: Partial<ApplicantPayload> & { weekly?: number } = {}): ApplicantPayload {
  const weekly = over.weekly ?? 900;
  const wobble = [0.95, 1.05, 1.0, 0.9, 1.1, 1.0, 1.02, 0.98];
  return {
    partnerId: 'ptn_test', externalWorkerId: 'w1', fullName: 'Test Rider', nricLast4: '1234', homeRegion: 'KLANG_VALLEY',
    platformTenureMonths: 18,
    weeklyPayouts: Array.from({ length: 26 }, (_, i) => Math.round(weekly * wobble[i % 8])),
    weeklyActiveDays: Array(26).fill(5.5), avgRating: 4.8, cancellationRate: 0.04,
    requestedTenureMonths: 6, ...over,
  };
}
