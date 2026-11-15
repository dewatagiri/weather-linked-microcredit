import type { ApplicantPayload, BureauResult } from '../types';
import { hashString, rng, type Rng } from '../math';

/**
 * Simulated back-office agents (RPA bots / agentic workers). They are real async
 * functions with a *virtual* latency (minutes) returned alongside the result, so
 * the orchestrator can run a full 24–48 h origination in milliseconds, and tests
 * stay deterministic. Swap each for a real integration with the same signature.
 */
export interface AgentOutcome<T> { ok: boolean; data?: T; error?: string; latencyMin: number; attempts: number; refer?: boolean }
export interface AgentCtx { rnd: Rng; failureRate: number }

async function withRetry<T>(
  ctx: AgentCtx, latency: () => number, work: () => T | Promise<T>, maxAttempts = 3, flaky = true,
): Promise<AgentOutcome<T>> {
  let total = 0;
  for (let a = 1; a <= maxAttempts; a++) {
    total += latency();
    if (flaky && ctx.rnd.next() < ctx.failureRate) { total += 15 * a; continue; } // portal timeout, backoff
    return { ok: true, data: await work(), latencyMin: total, attempts: a };
  }
  return { ok: false, error: 'agent exhausted retries', latencyMin: total, attempts: maxAttempts };
}

export const ingestPartnerData = (ctx: AgentCtx, p: ApplicantPayload) =>
  withRetry(ctx, () => ctx.rnd.range(1, 6), () => ({ weeks: p.weeklyPayouts.length, source: p.partnerId }), 3);

export interface KycResult { verified: boolean; faceMatch: number; livenessPass: boolean; nricChecksum: boolean }
export const verifyIdentity = (ctx: AgentCtx, p: ApplicantPayload) =>
  withRetry<KycResult>(ctx, () => ctx.rnd.range(3, 25), () => {
    const h = hashString(p.externalWorkerId + p.nricLast4);
    const faceMatch = 0.87 + (h % 1300) / 10000;       // 0.87–1.00
    const nricChecksum = /^\d{4}$/.test(p.nricLast4);
    const livenessPass = h % 53 !== 0;
    return { verified: nricChecksum && livenessPass && faceMatch >= 0.86, faceMatch, livenessPass, nricChecksum };
  });

/** Deterministic pseudo-bureau keyed off worker identity (stands in for CTOS/CCRIS RPA). */
export function pseudoBureau(p: ApplicantPayload): BureauResult {
  const r = rng(hashString(p.partnerId + p.externalWorkerId));
  const roll = r.next();
  return {
    ctosScore: Math.round(roll < 0.06 ? r.range(380, 520) : r.normal(665, 60)),
    ccrisWorstArrearsMonths: roll < 0.05 ? r.int(2, 6) : roll < 0.15 ? r.int(0, 1) : 0,
    ccrisActiveFacilities: r.int(0, 4),
    bankruptcyFlag: roll > 0.995,
  };
}
// Bureau portals are the slowest + flakiest hops (RPA over screen-scraped portals).
export const runCtosCheck = (ctx: AgentCtx, p: ApplicantPayload) =>
  withRetry(ctx, () => ctx.rnd.range(30, 240), () => pseudoBureau(p), 4);
export const runCcrisCheck = (ctx: AgentCtx, p: ApplicantPayload) =>
  withRetry(ctx, () => ctx.rnd.range(45, 300), () => pseudoBureau(p), 4);

export const generateEsignPacket = (ctx: AgentCtx, appId: string) =>
  withRetry(ctx, () => ctx.rnd.range(1, 4), () => ({ envelopeId: 'env_' + hashString(appId).toString(16), documents: ['Facility Agreement', 'Weekly Deduction Mandate', 'Weather Guarantee Schedule'] }), 3, false);

/** Borrower action — the long pole. Most sign within ~2–14h; a tail takes a day or more. */
export const awaitBorrowerSignature = (ctx: AgentCtx) =>
  withRetry(ctx, () => (ctx.rnd.next() < 0.65 ? ctx.rnd.range(120, 840) : ctx.rnd.range(840, 2300)), () => ({ signedAt: 'virtual', method: 'MyDigital ID / OTP' }), 1, false);

export const disburseFunds = (ctx: AgentCtx) =>
  withRetry(ctx, () => ctx.rnd.range(60, 600), () => ({ rail: 'DuitNow', reference: 'DN' + Math.floor(ctx.rnd.next() * 1e9) }), 3);
