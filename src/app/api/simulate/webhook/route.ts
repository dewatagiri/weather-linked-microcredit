import { sign } from '@/server/auth';
import { demoWorker, partnerById } from '@/server/demoFeeds';
import { handlePartnerWebhook } from '@/server/webhook';

export const dynamic = 'force-dynamic';

/**
 * Demo helper: builds a worker in the chosen partner's native feed format, signs it
 * server-side (so no secret reaches the browser) and pushes it through the real webhook handler.
 */
export async function POST(req: Request) {
  const b = await req.json();
  const partner = partnerById(b.partnerId);
  if (!partner) return Response.json({ error: 'unknown_partner' }, { status: 404 });
  const seed = Math.floor(Math.random() * 1e9);
  const { raw } = demoWorker(partner, { weeklyAvg: Number(b.weeklyAvg ?? 900), volatility: Number(b.volatility ?? 0.15), tenureMonths: b.tenureMonths === 3 ? 3 : 6, seed });
  const body = JSON.stringify(raw);
  const r = await handlePartnerWebhook(partner.id, body, sign(partner.id, body), `demo-${seed}`);
  return Response.json({ http: r.status, feedFormat: partner.feedFormat, partner: partner.name, response: r.body, sentPreview: body.slice(0, 280) + '…' }, { status: 200 });
}
