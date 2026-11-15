import { describe, it, expect } from 'vitest';
import { PARTNERS } from '@/engine';
import { sign, verifySignature } from '@/server/auth';
import { handlePartnerWebhook } from '@/server/webhook';
import { demoWorker } from '@/server/demoFeeds';

const partner = PARTNERS[0];
const feed = (seed: number, weeklyAvg = 1000) => JSON.stringify(demoWorker(partner, { weeklyAvg, volatility: 0.1, tenureMonths: 3, seed }).raw);

describe('partner webhook', () => {
  it('HMAC verification accepts only the exact signed body', () => {
    const body = '{"a":1}';
    expect(verifySignature(partner.id, body, sign(partner.id, body))).toBe(true);
    expect(verifySignature(partner.id, body + ' ', sign(partner.id, body))).toBe(false);
    expect(verifySignature(PARTNERS[1].id, body, sign(partner.id, body))).toBe(false);
    expect(verifySignature(partner.id, body, null)).toBe(false);
    expect(verifySignature(partner.id, body, 'zz')).toBe(false);
  });
  it('rejects bad signature (401), missing idempotency key (400), unknown partner (404), bad payload (422)', async () => {
    const b = feed(1);
    expect((await handlePartnerWebhook(partner.id, b, 'deadbeef', 'k1')).status).toBe(401);
    expect((await handlePartnerWebhook(partner.id, b, sign(partner.id, b), null)).status).toBe(400);
    expect((await handlePartnerWebhook('ptn_nope', b, 'x', 'k')).status).toBe(404);
    const bad = '{"worker_id":"x"}';
    expect((await handlePartnerWebhook(partner.id, bad, sign(partner.id, bad), 'k2')).status).toBe(422);
  });
  it('accepts a signed feed, returns decision + offer + guarantee quote, and is idempotent', async () => {
    const b = feed(42);
    const first = await handlePartnerWebhook(partner.id, b, sign(partner.id, b), 'idem-42');
    expect(first.status).toBe(202);
    expect(first.body.applicationId).toBeTruthy();
    if (first.body.decision === 'APPROVED') {
      expect((first.body.offer as any).principal).toBeGreaterThan(0);
      expect((first.body.guarantee as any).fee).toBeGreaterThan(0);
    }
    const again = await handlePartnerWebhook(partner.id, b, sign(partner.id, b), 'idem-42');
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect(again.body.applicationId).toBe(first.body.applicationId);
  });
  it('every partner feed format round-trips through its adapter', async () => {
    for (const p of PARTNERS.filter((x, i, a) => a.findIndex((y) => y.feedFormat === x.feedFormat) === i)) {
      const body = JSON.stringify(demoWorker(p, { weeklyAvg: 900, volatility: 0.1, tenureMonths: 6, seed: 9 }).raw);
      const r = await handlePartnerWebhook(p.id, body, sign(p.id, body), 'fmt-' + p.feedFormat);
      expect(r.status, p.feedFormat).toBe(202);
    }
  });
});
