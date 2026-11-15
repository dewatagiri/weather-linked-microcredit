-- Gig-Rain: Embedded Financing + Parametric Weather Guarantee — PostgreSQL schema
-- Money is NUMERIC(14,2) MYR. All timestamps are timestamptz (UTC); local-time
-- rules (08:00–19:00) are evaluated in parametric_policies.timezone.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE partner_category   AS ENUM ('E_HAILING','DELIVERY','LOGISTICS');
CREATE TYPE feed_format        AS ENUM ('WEEKLY_ARRAY','MONTHLY_TOTALS','TRIP_LEDGER');
CREATE TYPE credit_tier        AS ENUM ('A','B','C');
CREATE TYPE application_status AS ENUM (
  'RECEIVED','DATA_INGESTED','IDENTITY_VERIFIED','BUREAU_CHECKED','UNDERWRITTEN',
  'OFFER_ISSUED','SIGNED','DISBURSED','DECLINED','REFERRED','EXPIRED','FAILED');
CREATE TYPE installment_status AS ENUM ('SCHEDULED','PAID','PARTIAL','OVERDUE','GUARANTEED','WRITTEN_OFF');
CREATE TYPE policy_status      AS ENUM ('PENDING','ACTIVE','EXHAUSTED','EXPIRED','CANCELLED');
CREATE TYPE flood_alert_level  AS ENUM ('NONE','ADVISORY','WARNING','DANGER');
CREATE TYPE trigger_outcome    AS ENUM ('TRIGGERED','NOT_TRIGGERED','REVIEW');
CREATE TYPE payout_status      AS ENUM ('PENDING','SETTLED','REVERSED');

-- ---------------------------------------------------------------- partners
CREATE TABLE partner_platforms (
  id               text PRIMARY KEY,                 -- e.g. 'ptn_rideco'
  name             text NOT NULL,
  category         partner_category NOT NULL,
  feed_format      feed_format NOT NULL,
  webhook_secret_ref text NOT NULL,                  -- pointer into secrets manager, never the secret
  api_status       text NOT NULL DEFAULT 'HEALTHY',  -- HEALTHY | DEGRADED | DOWN
  last_heartbeat_at timestamptz,
  p95_latency_ms   integer,
  onboarded_at     timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------- borrowers
CREATE TABLE borrowers (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id         text NOT NULL REFERENCES partner_platforms(id),
  external_worker_id text NOT NULL,
  full_name          text NOT NULL,
  nric_hash          text NOT NULL,                   -- salted hash; raw NRIC lives in the KYC vault
  phone_e164         text,
  home_region        text NOT NULL,
  platform_tenure_months integer NOT NULL,
  facility_stage     smallint NOT NULL DEFAULT 1,     -- graduation ladder stage
  credit_tier        credit_tier,
  alt_score          numeric(5,2),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, external_worker_id)
);

-- ------------------------------------------------------- loan_applications
CREATE TABLE loan_applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key   text NOT NULL,
  borrower_id       uuid NOT NULL REFERENCES borrowers(id),
  partner_id        text NOT NULL REFERENCES partner_platforms(id),
  status            application_status NOT NULL DEFAULT 'RECEIVED',
  requested_tenure_months smallint NOT NULL CHECK (requested_tenure_months IN (3,6,12)),
  requested_amount  numeric(14,2),
  facility_stage    smallint NOT NULL DEFAULT 1,
  -- alt-data snapshot used for the decision (immutable audit trail)
  trailing_26w_payouts   numeric(14,2)[] NOT NULL,
  trailing_avg_weekly    numeric(14,2) NOT NULL,
  alt_score         numeric(5,2),
  credit_tier       credit_tier,
  decision_reasons  text[] NOT NULL DEFAULT '{}',
  -- offer
  approved_principal numeric(14,2),
  apr_pct           numeric(5,2),
  weekly_installment numeric(14,2),
  deduction_rate_pct numeric(4,2),                    -- 9–10 % of weekly payout
  weekly_cap_pct    numeric(4,2),                     -- 15–30 % cap
  -- SLA clock
  received_at       timestamptz NOT NULL DEFAULT now(),
  disbursed_at      timestamptz,
  sla_hours         numeric(6,2) GENERATED ALWAYS AS
                      (EXTRACT(EPOCH FROM (disbursed_at - received_at)) / 3600.0) STORED,
  pipeline_trace    jsonb NOT NULL DEFAULT '[]',      -- per-agent step log
  nps_score         smallint CHECK (nps_score BETWEEN 0 AND 10),
  UNIQUE (partner_id, idempotency_key)
);
CREATE INDEX ON loan_applications (status, received_at DESC);
CREATE INDEX ON loan_applications (partner_id, received_at DESC);

-- ------------------------------------------------------ repayment_schedules
CREATE TABLE repayment_schedules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id   uuid NOT NULL REFERENCES loan_applications(id),
  installment_no   smallint NOT NULL,
  due_date         date NOT NULL,
  principal_due    numeric(14,2) NOT NULL,
  interest_due     numeric(14,2) NOT NULL,
  installment_due  numeric(14,2) NOT NULL,
  platform_payout  numeric(14,2),                     -- actual gig payout that week
  collection_ceiling numeric(14,2),                   -- cap_pct * min(payout, trailing avg)
  amount_collected numeric(14,2) NOT NULL DEFAULT 0,
  amount_guaranteed numeric(14,2) NOT NULL DEFAULT 0, -- paid by guarantee to lender
  arrears_carried  numeric(14,2) NOT NULL DEFAULT 0,
  status           installment_status NOT NULL DEFAULT 'SCHEDULED',
  collected_at     timestamptz,
  UNIQUE (application_id, installment_no)
);
CREATE INDEX ON repayment_schedules (due_date, status);

-- -------------------------------------------------------- parametric_policies
CREATE TABLE parametric_policies (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    uuid NOT NULL UNIQUE REFERENCES loan_applications(id),
  borrower_id       uuid NOT NULL REFERENCES borrowers(id),
  status            policy_status NOT NULL DEFAULT 'PENDING',
  region_code       text NOT NULL,
  timezone          text NOT NULL DEFAULT 'Asia/Kuala_Lumpur',
  window_start      time NOT NULL DEFAULT '08:00',
  window_end        time NOT NULL DEFAULT '19:00',
  rain_threshold_mm_hr numeric(6,2) NOT NULL,         -- calibrated on 10y history
  flood_alert_level flood_alert_level NOT NULL DEFAULT 'WARNING',
  ping_tolerance_min smallint NOT NULL DEFAULT 20,
  ip_max_radius_m   integer NOT NULL DEFAULT 3000,
  waiting_period_days smallint NOT NULL DEFAULT 7,
  coverage_start    date NOT NULL,
  coverage_end      date NOT NULL,
  max_claims        smallint NOT NULL,
  claims_paid       smallint NOT NULL DEFAULT 0,
  guarantee_fee     numeric(14,2) NOT NULL,           -- upfront, seasonality-adjusted
  fee_breakdown     jsonb NOT NULL,
  beneficiary       text NOT NULL DEFAULT 'LENDER' CHECK (beneficiary = 'LENDER')
);

-- ------------------------------------------------------------ weather_events
CREATE TABLE weather_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source          text NOT NULL,                      -- 'MET_MY' | 'DID_INFOBANJIR' | ...
  region_code     text NOT NULL,
  observed_at     timestamptz NOT NULL,
  rainfall_mm_hr  numeric(6,2) NOT NULL,
  flood_alert     flood_alert_level NOT NULL DEFAULT 'NONE',
  polygon         jsonb NOT NULL,                     -- GeoJSON ring [[lng,lat],...]; PostGIS geometry in prod
  UNIQUE (source, region_code, observed_at)
);
CREATE INDEX ON weather_events (region_code, observed_at DESC);

-- Worker location evidence at (or near) a weather event
CREATE TABLE location_pings (
  id          bigserial PRIMARY KEY,
  borrower_id uuid NOT NULL REFERENCES borrowers(id),
  ts          timestamptz NOT NULL,
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  source      text NOT NULL CHECK (source IN ('GPS','IP')),
  accuracy_m  integer NOT NULL,
  online_on_platform boolean NOT NULL DEFAULT true
);
CREATE INDEX ON location_pings (borrower_id, ts DESC);

-- ---------------------------------------------------------- guarantee_payouts
CREATE TABLE guarantee_payouts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id        uuid NOT NULL REFERENCES parametric_policies(id),
  weather_event_id uuid NOT NULL REFERENCES weather_events(id),
  schedule_id      uuid NOT NULL REFERENCES repayment_schedules(id),
  outcome          trigger_outcome NOT NULL,
  check_results    jsonb NOT NULL,                    -- every rule with pass/fail + detail
  payee            text NOT NULL DEFAULT 'LENDER' CHECK (payee = 'LENDER'),
  amount           numeric(14,2) NOT NULL,
  status           payout_status NOT NULL DEFAULT 'PENDING',
  idempotency_key  text NOT NULL UNIQUE,              -- hash(policy, event, installment)
  evaluated_at     timestamptz NOT NULL DEFAULT now(),
  settled_at       timestamptz
);

-- ============================ PD pipeline / feature store (future roadmap) ======
CREATE TABLE pd_feature_definitions (
  name        text PRIMARY KEY,
  family      text NOT NULL,        -- EARNINGS | ACTIVITY | REPAYMENT | WEATHER | BUREAU | PROFILE
  dtype       text NOT NULL,
  description text NOT NULL,
  version     integer NOT NULL DEFAULT 1
);

-- One row per (loan, as_of_week): point-in-time-correct features. Never updated.
CREATE TABLE pd_feature_snapshots (
  application_id uuid NOT NULL REFERENCES loan_applications(id),
  as_of_date     date NOT NULL,
  weeks_on_book  smallint NOT NULL,
  features       jsonb NOT NULL,    -- see pd_feature_definitions
  feature_version integer NOT NULL DEFAULT 1,
  PRIMARY KEY (application_id, as_of_date)
);

-- Outcome labels, written when the observation window matures.
CREATE TABLE pd_labels (
  application_id uuid NOT NULL REFERENCES loan_applications(id),
  horizon_weeks  smallint NOT NULL,
  defaulted      boolean NOT NULL,  -- >= 90 DPD (or write-off) within horizon
  max_dpd        smallint NOT NULL,
  guarantee_assisted boolean NOT NULL,
  matured_at     date NOT NULL,
  PRIMARY KEY (application_id, horizon_weeks)
);

CREATE TABLE pd_model_versions (
  id           serial PRIMARY KEY,
  name         text NOT NULL,
  trained_at   timestamptz NOT NULL,
  training_window daterange NOT NULL,
  metrics      jsonb NOT NULL,      -- AUC, KS, Gini, calibration slope
  status       text NOT NULL DEFAULT 'SHADOW'  -- SHADOW | CHAMPION | RETIRED
);
