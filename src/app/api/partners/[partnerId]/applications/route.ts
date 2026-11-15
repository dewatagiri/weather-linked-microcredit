import { handlePartnerWebhook } from '@/server/webhook';

export const dynamic = 'force-dynamic';

export async function POST(req: Request, ctx: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = await ctx.params;
  const raw = await req.text(); // signature is over the exact bytes received
  const r = await handlePartnerWebhook(partnerId, raw, req.headers.get('x-signature'), req.headers.get('idempotency-key'));
  return Response.json(r.body, { status: r.status });
}
