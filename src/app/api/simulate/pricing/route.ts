import { priceGuarantee } from '@/engine';

export async function POST(req: Request) {
  const b = await req.json();
  const q = priceGuarantee({
    principal: Number(b.principal ?? 2400), weeklyInstallment: Number(b.installment ?? 100), tenureMonths: Number(b.tenureMonths ?? 3) as 3 | 6 | 12,
    originationDate: new Date(Date.UTC(Number(b.year ?? 2026), Number(b.month ?? 11) - 1, 10, 2)), region: b.region ?? 'KLANG_VALLEY',
  });
  return Response.json(q);
}
