import { underwrite, type ApplicantPayload } from '@/engine';
import { pseudoBureau } from '@/engine/pipeline/agents';

export async function POST(req: Request) {
  const b = await req.json();
  const weekly: number = Number(b.weeklyAvg ?? 900), vol = Number(b.volatility ?? 0.15);
  const payouts = Array.from({ length: 26 }, (_, i) => Math.max(0, Math.round(weekly * (1 + vol * Math.sin(i * 2.1) + (vol / 2) * Math.cos(i * 0.7)))));
  const weeksWorked = Math.min(26, Math.max(0, Number(b.activeWeeks ?? 26)));
  const gated = payouts.map((p, i) => (i % Math.max(1, Math.round(26 / Math.max(1, 26 - weeksWorked))) === 0 && weeksWorked < 26 ? 0 : p));
  const p: ApplicantPayload = {
    partnerId: 'ptn_demo', externalWorkerId: 'sim', fullName: 'Simulated', nricLast4: '0000', homeRegion: b.region ?? 'KLANG_VALLEY',
    platformTenureMonths: Number(b.tenure ?? 14), weeklyPayouts: gated, weeklyActiveDays: gated.map((x) => (x > 0 ? Number(b.activeDays ?? 5.5) : 0)),
    avgRating: Number(b.rating ?? 4.7), cancellationRate: Number(b.cancel ?? 0.05), requestedTenureMonths: Number(b.tenureMonths ?? 6) as 3 | 6,
  };
  const result = underwrite(p, { bureau: b.useBureau === false ? undefined : { ...pseudoBureau(p), ccrisWorstArrearsMonths: Number(b.ccrisArrears ?? 0), ctosScore: Number(b.ctos ?? 680), bankruptcyFlag: false }, stage: Number(b.stage ?? 1) });
  return Response.json({ result, payouts: gated });
}
