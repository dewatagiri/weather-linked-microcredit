# Gig-Rain: Embedded Financing + Parametric Weather Guarantee — Reference Architecture

## Repository layout

```
gig-rain/
├─ db/schema.sql              PostgreSQL DDL (source of truth for the data model)
├─ prisma/schema.prisma       Same model for Prisma clients
├─ src/
│  ├─ engine/                 Pure, framework-free domain logic (no I/O, fully unit-tested)
│  │  ├─ types.ts             Shared domain types
│  │  ├─ underwriting.ts      Alt-credit scoring, eligibility, offer sizing
│  │  ├─ repayment.ts         Amortisation + fractionalised weekly collection engine
│  │  ├─ graduation.ts        Facility ladder + graduation rules
│  │  ├─ pricing.ts           Seasonality-adjusted guarantee fee
│  │  ├─ weather/
│  │  │  ├─ geo.ts            point-in-polygon, haversine
│  │  │  ├─ window.ts         08:00–19:00 local active-working-window filter
│  │  │  ├─ thresholds.ts     10-year history → rainfall threshold calibration
│  │  │  └─ trigger.ts        Parametric trigger evaluator (guarantee, not insurance)
│  │  ├─ partners/            ~30 partner feed adapters (normalisers) + registry
│  │  ├─ pipeline/            Async RPA/agent steps + origination orchestrator (SLA clock)
│  │  └─ pd/features.ts       PD feature-store row builder + labels
│  ├─ server/                 Adapters around the engine: store, seed data, HMAC, metrics
│  └─ app/                    Next.js (App Router): dashboard pages + REST/webhook routes
├─ tests/                     Vitest specs for every engine module
└─ scripts/demo.ts            CLI walk-through of the whole flow
```

Design rule: **`src/engine` never touches the DB, clock or network** (time and
randomness are injected). Swapping the in-memory store in `src/server` for
Prisma repositories does not change a line of business logic.

## Data flow

```
Gig platform ──HMAC webhook──▶ /api/partners/:id/applications
                                 │ adapter.normalise()  (1 of ~30 feed formats)
                                 ▼
                         Origination pipeline (async agents, virtual SLA clock)
        ingest → eKYC → CTOS → CCRIS → underwrite → offer/e-sign → disburse
                                 │
                 loan_applications ─▶ repayment_schedules ─▶ weekly auto-deduction
                                 │                                  ▲
                    parametric_policies  ◀── pricing (seasonality) │
                                 │                                  │
 weather feed ─▶ weather_events ─▶ trigger evaluator ─▶ guarantee_payouts ─▶ LENDER
   (rain mm/hr, flood alert)       window + polygon + GPS/IP        (pays installment,
                                                                     never the rider)
                                 ▼
                  pd_feature_snapshots / pd_labels  (PD model training set)
```

## Key modelling decisions

* **Guarantee, not insurance** – a trigger creates a `guarantee_payouts` row whose
  `payee` is always the lender and which settles one `repayment_schedules` row.
  The borrower never receives cash.
* **Affordability** – installment = 9–10 % of the trailing-26-week mean weekly payout
  (by tier). Any single week's collection (installment + arrears catch-up) is
  capped at 15 % / 22 % / 30 % (tier C / B / A) of `min(this week's payout,
  trailing mean)`, so slow weeks are protected and windfalls are not over-collected.
* **Trigger** needs *all* of: active policy past waiting period with claims left ·
  rain ≥ calibrated threshold **or** flood alert ≥ policy level · event inside the
  local 08:00–19:00 window · a GPS/IP ping near the event timestamp inside the
  weather polygon (IP only if its accuracy radius is small enough) · an
  unsettled installment to pay. Anything inconclusive goes to `REVIEW`, not silently dropped.
* **Pricing** = expected claim cost (Poisson-binomial over the loan's actual weeks,
  month-by-month monsoon exposure, region factor) ÷ target loss ratio, plus Q4-origination loading.
* **Illustrative numbers** – monthly exposure curves, region factors, APRs and
  limits are placeholders to be calibrated with real MET Malaysia / DID data and
  portfolio experience.
