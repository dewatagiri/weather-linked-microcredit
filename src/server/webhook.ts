import { AdapterError, getPartner, normalisePartnerPayload, type ApplicantPayload } from '@/engine';
import { verifySignature } from './auth';
import { getStore, ingestApplication } from './store';

export interface WebhookResult { status: number; body: Record<string, unknown> }

/**
 * Embedded-partner webhook. The partner POSTs its *native* feed format (no redirect,
 * no external portal); we authenticate (HMAC), normalise through the partner's
 * adapter, de-duplicate on Idempotency-Key and run the origination pipeline.
 * Decision + offer are returned synchronously so the partner can render it in-app;
 * disbursement completes asynchronously (see `pipeline` in the response).
 */
export async function handlePartnerWebhook(partnerId: string, rawBody: string, signature: string | null, idempotencyKey: string | null): Promise<WebhookResult> {
  if (!getPartner(partnerId)) return { status: 404, body: { error: 'unknown_partner' } };
  if (!verifySignature(partnerId, rawBody, signature)) return { status: 401, body: { error: 'invalid_signature' } };
  if (!idempotencyKey) return { status: 400, body: { error: 'missing_idempotency_key' } };

  let payload: ApplicantPayload;
  try {
    payload = normalisePartnerPayload(partnerId, JSON.parse(rawBody));
  } catch (e) {
    if (e instanceof AdapterError || e instanceof SyntaxError) return { status: 422, body: { error: 'invalid_payload', detail: e.message } };
    throw e;
  }
  const store = await getStore();
  store.now = Date.now();
  const res = await ingestApplication(store, payload, idempotencyKey);
  const a = res.application;
  return {
    status: res.duplicate ? 200 : 202,
    body: {
      applicationId: a.id, duplicate: res.duplicate, status: a.status,
      decision: a.underwriting?.decision, tier: a.underwriting?.tier, score: a.underwriting ? Math.round(a.underwriting.score) : undefined,
      reasons: a.underwriting?.reasons, offer: a.underwriting?.offer,
      guarantee: res.duplicate ? undefined : store.loans.get('loan_' + a.id.slice(4))?.policy.quote,
      pipeline: { totalHours: a.pipeline.totalHours, slaBand: a.pipeline.slaBand, steps: a.pipeline.steps },
    },
  };
}
