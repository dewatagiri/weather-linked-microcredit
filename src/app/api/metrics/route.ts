import { getStore } from '@/server/store';
import { partnerMetrics, portfolioMetrics } from '@/server/metrics';

export const dynamic = 'force-dynamic';
export async function GET() {
  const s = await getStore();
  return Response.json({ portfolio: portfolioMetrics(s), partners: partnerMetrics(s) });
}
