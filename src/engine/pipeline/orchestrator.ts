import type { ApplicantPayload, BureauResult, UnderwritingResult } from '../types';
import { hashString, rng } from '../math';
import { underwrite } from '../underwriting';
import * as A from './agents';

export type StepName = 'INGEST' | 'EKYC' | 'CTOS' | 'CCRIS' | 'UNDERWRITE' | 'ESIGN_PACKET' | 'BORROWER_SIGN' | 'DISBURSE';
export interface PipelineStep { step: StepName; ok: boolean; attempts: number; startMin: number; durationMin: number; note: string }
export type FinalStatus = 'DISBURSED' | 'DECLINED' | 'REFERRED' | 'FAILED';
export interface PipelineRun {
  status: FinalStatus;
  steps: PipelineStep[];
  totalHours: number;
  slaBand: 'FAST_24H' | 'WITHIN_48H' | 'BREACH';
  underwriting?: UnderwritingResult;
  bureau?: BureauResult;
  decisionHours?: number;
}
export const SLA = { targetHours: 24, maxHours: 48 };

export const slaBand = (h: number): PipelineRun['slaBand'] => (h <= SLA.targetHours ? 'FAST_24H' : h <= SLA.maxHours ? 'WITHIN_48H' : 'BREACH');

/**
 * Origination state machine. Independent bureau checks run in parallel (elapsed
 * = max of the two); everything else is sequential. Returns a full audit trail.
 */
export async function runOriginationPipeline(
  payload: ApplicantPayload,
  opts: { seed?: number; failureRate?: number; stage?: number } = {},
): Promise<PipelineRun> {
  const ctx: A.AgentCtx = { rnd: rng(opts.seed ?? hashString(payload.partnerId + payload.externalWorkerId)), failureRate: opts.failureRate ?? 0.08 };
  const steps: PipelineStep[] = [];
  let clock = 0;
  const record = (step: StepName, o: A.AgentOutcome<unknown>, note: string, start = clock, dur = o.latencyMin) => {
    steps.push({ step, ok: o.ok, attempts: o.attempts, startMin: Math.round(start), durationMin: Math.round(dur), note });
  };
  const finish = (status: FinalStatus, extra: Partial<PipelineRun> = {}): PipelineRun => {
    const totalHours = Math.round((clock / 60) * 10) / 10;
    return { status, steps, totalHours, slaBand: slaBand(totalHours), ...extra };
  };

  const ing = await A.ingestPartnerData(ctx, payload);
  record('INGEST', ing, ing.ok ? `${ing.data!.weeks} weeks ingested` : 'partner feed unreachable'); clock += ing.latencyMin;
  if (!ing.ok) return finish('FAILED');

  const kyc = await A.verifyIdentity(ctx, payload);
  record('EKYC', kyc, kyc.ok ? `face ${(kyc.data!.faceMatch * 100).toFixed(0)}%, liveness ${kyc.data!.livenessPass ? 'pass' : 'FAIL'}` : 'eKYC provider down'); clock += kyc.latencyMin;
  if (!kyc.ok) return finish('FAILED');

  const [ctos, ccris] = await Promise.all([A.runCtosCheck(ctx, payload), A.runCcrisCheck(ctx, payload)]);
  record('CTOS', ctos, ctos.ok ? `score ${ctos.data!.ctosScore}` : 'CTOS RPA failed', clock);
  record('CCRIS', ccris, ccris.ok ? `worst arrears ${ccris.data!.ccrisWorstArrearsMonths}m` : 'CCRIS RPA failed', clock);
  clock += Math.max(ctos.latencyMin, ccris.latencyMin);
  if (!ctos.ok || !ccris.ok) return finish('FAILED');
  const bureau = ctos.data!;

  const uw = underwrite(payload, { bureau, identityVerified: kyc.data!.verified, stage: opts.stage });
  steps.push({ step: 'UNDERWRITE', ok: uw.decision !== 'DECLINED', attempts: 1, startMin: Math.round(clock), durationMin: 1, note: `${uw.decision} · score ${uw.score.toFixed(0)}${uw.tier ? ' tier ' + uw.tier : ''}` });
  clock += 1;
  const decisionHours = Math.round((clock / 60) * 10) / 10;
  if (uw.decision === 'DECLINED') return finish('DECLINED', { underwriting: uw, bureau, decisionHours });
  if (uw.decision === 'REFER') { clock += 8 * 60; return finish('REFERRED', { underwriting: uw, bureau, decisionHours }); } // manual queue

  const pack = await A.generateEsignPacket(ctx, payload.externalWorkerId);
  record('ESIGN_PACKET', pack, pack.data!.documents.length + ' documents generated'); clock += pack.latencyMin;
  const sign = await A.awaitBorrowerSignature(ctx);
  record('BORROWER_SIGN', sign, 'signed via ' + sign.data!.method); clock += sign.latencyMin;
  const pay = await A.disburseFunds(ctx);
  record('DISBURSE', pay, pay.ok ? pay.data!.rail + ' ' + pay.data!.reference : 'disbursement failed'); clock += pay.latencyMin;
  return pay.ok ? finish('DISBURSED', { underwriting: uw, bureau, decisionHours }) : finish('FAILED', { underwriting: uw, bureau, decisionHours });
}
