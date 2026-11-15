# gig-rain — embedded gig-worker financing + parametric weather guarantee

> **Educational case study — not a real product.** Everything here is a simulation: made-up borrowers,
> synthetic rainfall, fictional partner platforms, placeholder pricing and credit rules. It is not financial,
> credit, insurance or legal advice, and it is not affiliated with or derived from any real company, lender or
> platform. Do not use it to make real lending or guarantee decisions. New to the topic? Start with
> [`docs/LEARNING_GUIDE.md`](docs/LEARNING_GUIDE.md).

Full-stack reference prototype for **embedded gig-worker micro-financing** (lending engine) with a
**parametric weather guarantee** that pays the *lender's* installment — a credit/performance guarantee, not insurance.
Design and rationale: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

```bash
npm install
npm test            # 54 engine + webhook tests
npm run demo        # CLI walk-through: underwrite → price → trigger → collect
npm run dev         # dashboard on http://localhost:3000 (seeded, simulated data)
```

## What's where

| Deliverable | Location |
|---|---|
| PostgreSQL schema (+ PD feature store) | [`db/schema.sql`](db/schema.sql), Prisma mirror [`prisma/schema.prisma`](prisma/schema.prisma) |
| Underwriting + sizing | `src/engine/underwriting.ts` |
| Fractionalised weekly repayment | `src/engine/repayment.ts` |
| Graduation ladder | `src/engine/graduation.ts` |
| Parametric trigger (rain/flood · 08–19h · geofence) | `src/engine/weather/{trigger,window,geo,thresholds}.ts` |
| Seasonality-adjusted guarantee pricing | `src/engine/pricing.ts` |
| ~30 partner feed adapters + RPA/agent pipeline | `src/engine/partners/`, `src/engine/pipeline/` |
| PD feature snapshot builder | `src/engine/pd/features.ts` |
| Signed partner webhook | `POST /api/partners/:partnerId/applications` (`x-signature`, `Idempotency-Key`) |
| Dashboard (React / Next.js) | `src/app/*` — Overview, Originations & SLA, Borrowers & graduation, Simulators, PD pipeline |

## How the engine works

```
 GIG PLATFORM (ride / delivery / lorry app)
        │  sends rider's details + 26 weeks of earnings
        ▼
┌───────────────────────────────┐
│ 1. SIGNED WEBHOOK             │  rejects fake or duplicate requests
│    + partner adapter          │  converts each platform's format
└──────────────┬────────────────┘  into one standard shape
               ▼
┌───────────────────────────────┐
│ 2. ORIGINATION PIPELINE       │  simulated back-office robots, in order:
│    ingest → ID check →        │  ID check, credit bureau checks (CTOS /
│    CTOS + CCRIS → …           │  CCRIS), then the underwriting step
└──────────────┬────────────────┘
               ▼
┌───────────────────────────────┐
│ 3. UNDERWRITING               │  score from earnings level, stability,
│    score 0–100 → tier A/B/C   │  active weeks, rating, tenure, trend
└──────┬─────────────────┬──────┘
   declined          approved
   (stops here)          │
                         ▼
┌───────────────────────────────┐
│ 4. OFFER SIZING               │  weekly instalment ≈ 9–10% of average
│    amount, APR, instalment    │  weekly earnings, capped by the stage limit
└──────────────┬────────────────┘
               ▼
┌───────────────────────────────┐
│ 5. GUARANTEE PRICING          │  fee = expected weather claims over the
│    fee depends on the season  │  loan's actual weeks (Oct–Dec costs more)
└──────────────┬────────────────┘
               ▼
        e-sign → disbursement (target 24–48 hours)
               │
               ▼
┌───────────────────────────────────────────────────────────┐
│ 6. EVERY WEEK: REPAYMENT ENGINE                           │
│    rider is paid by the platform                          │
│    → take the instalment (plus any arrears)               │
│    → never more than the cap (15 / 22 / 30% of earnings)  │
│    → anything not collected rolls into arrears            │
└──────────────────────┬────────────────────────────────────┘
                       │            ▲
        heavy rain happens          │ guarantee pays this week's
                       ▼            │ instalment, so no arrears
┌───────────────────────────────────┴───────────────────────┐
│ 7. WEATHER TRIGGER CHECKS (all must pass)                 │
│    ✓ policy active, past waiting period, claims left      │
│    ✓ rain above the region's calibrated level, or a       │
│      flood warning                                        │
│    ✓ time is 08:00–19:00 Malaysia time                    │
│    ✓ rider's GPS/IP is inside the storm area, online      │
│    ✓ an unpaid instalment exists                          │
│                                                           │
│    all pass         → PAY THE LENDER (never the rider)    │
│    location unclear → REVIEW queue for a human            │
│    anything else    → no payment                          │
└──────────────────────┬────────────────────────────────────┘
                       ▼
┌───────────────────────────────┐
│ 8. END OF LOAN: GRADUATION    │  repaid, ≥90% on time (guarantee weeks
│    bigger limit next time?    │  don't count against the rider), no
└──────────────┬────────────────┘  default, score still good → next stage
               ▼
   All the data is saved as "features" for a future default-risk model
```

**In one sentence:** the engine decides who can borrow and how much, takes a small slice of earnings each week, and pays the lender when a storm during working hours hits a rider's area.

| Box | Code |
|---|---|
| 1–2 Webhook, adapters, pipeline | `src/server/webhook.ts`, `src/engine/partners/`, `src/engine/pipeline/` |
| 3–4 Underwriting and offer sizing | `src/engine/underwriting.ts` |
| 5 Guarantee pricing | `src/engine/pricing.ts` |
| 6 Weekly repayment | `src/engine/repayment.ts` |
| 7 Weather trigger | `src/engine/weather/trigger.ts` |
| 8 Graduation | `src/engine/graduation.ts` |

## Core rules as implemented

* **Alt-credit**: 26 weeks of payouts → score from earnings level, stability (CV), consistency, activity days, rating, tenure, trend; bureau (CTOS/CCRIS) gates; tiers A/B/C.
* **Fractionalised deduction**: weekly installment ≈ 9–10 % of trailing-6m mean payout; each week's debit (installment + arrears) is capped at 15/22/30 % (tier C/B/A) of `min(this week's payout, trailing mean)`; shortfalls roll to arrears.
* **Graduation**: Starter (3/6m ≤ RM4k) → Builder → Established → Prime; needs a fully-repaid loan, ≥90 % on-time (guarantee-paid weeks are neutral), worst DPD ≤ 7, no default, refreshed score ≥ next-stage bar.
* **Trigger**: policy active + waiting period + claims left, rain ≥ region-calibrated threshold (98.5th pct of wet hours over ~10y) **or** flood alert ≥ WARNING, event in 08:00–19:00 MYT, GPS/IP ping within ±20 min inside the weather polygon (IP only if radius ≤ 3 km, worker online). Inconclusive location → `REVIEW`. Pays the lender; idempotent per (policy, event, installment).
* **Pricing**: Poisson-binomial expected claims over the loan's *actual calendar weeks* × installment ÷ 65 % target loss ratio × region factor × 1.10 Q4-origination loading, within min/max guard rails.

## Honest limitations

* All data is simulated: seeded workers, synthetic 10-year rainfall history, pseudo CTOS/CCRIS, fictional partner names. Exposure curves, region factors, APRs and limits are **placeholders** to calibrate with MET Malaysia / DID data and portfolio experience.
* The app uses an in-memory store (`src/server/store.ts`) so it runs with no database; the DDL/Prisma schema is the intended persistence model. Swapping in repositories does not touch `src/engine`.
* Agents (eKYC, RPA bureau checks, e-sign, DuitNow) are simulated with a virtual clock; the PD page shows data readiness only — no model is trained.
* Legal/regulatory structuring of the guarantee (licensing, capital, consumer protection) is out of scope.

## License

MIT — see [`LICENSE`](LICENSE).
