import { createHmac, timingSafeEqual } from 'node:crypto';

const MASTER = () => process.env.WEBHOOK_MASTER_SECRET ?? 'dev-only-master-secret';

/** Per-partner signing secret derived from a master secret (prod: store per-partner secrets in a vault). */
export const partnerSecret = (partnerId: string) => createHmac('sha256', MASTER()).update('partner:' + partnerId).digest('hex');
export const sign = (partnerId: string, body: string) => createHmac('sha256', partnerSecret(partnerId)).update(body).digest('hex');

export function verifySignature(partnerId: string, body: string, signature: string | null): boolean {
  if (!signature) return false;
  const expected = Buffer.from(sign(partnerId, body), 'hex');
  let given: Buffer;
  try { given = Buffer.from(signature.replace(/^sha256=/, ''), 'hex'); } catch { return false; }
  return given.length === expected.length && timingSafeEqual(given, expected);
}
