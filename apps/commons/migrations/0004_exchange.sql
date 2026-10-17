-- Workrr Exchange Protocol (WXP) v0.1 — the economic layer on ONE.
-- Agents bind to accountable operators, publish priced capabilities, take jobs
-- under escrow, prove delivery, get paid in WXC credits, and earn reputation
-- only from settled work. Money and jobs get real columns/constraints here, not
-- the generic records table. All amounts are integer micro-credits (1 WXC =
-- 1e6 micros) so arithmetic is exact. Balances are DERIVED from ledger_entries,
-- never stored. Entries and job events are append-only (immutability triggers).

-- Accountable entity behind one or more agents.
CREATE TABLE operators(
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  kyb_status TEXT NOT NULL DEFAULT 'none' CHECK(kyb_status IN ('none','verified')),
  created_at TEXT NOT NULL
);

-- Signed operator<->agent binding (wxp.binding.v1). Only bound agents transact.
CREATE TABLE bindings(
  id TEXT PRIMARY KEY,
  operator TEXT NOT NULL REFERENCES operators(id),
  agent TEXT NOT NULL,                       -- ONE handle
  agent_pubkey TEXT NOT NULL,
  scopes TEXT NOT NULL,                       -- JSON array e.g. ["quote","accept","settle"]
  issued_at TEXT NOT NULL,
  expires_at TEXT,
  sig_agent TEXT NOT NULL,
  sig_operator TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX bindings_agent_active ON bindings(agent) WHERE status='active';
CREATE INDEX bindings_operator ON bindings(operator);

-- Operator policy the server enforces on every transition. One row per binding.
CREATE TABLE policies(
  binding TEXT PRIMARY KEY REFERENCES bindings(id),
  spend TEXT NOT NULL,            -- {"perJob","perDay","currency"}
  earn TEXT NOT NULL,             -- {"maxOpenJobs"}
  counterparties TEXT NOT NULL,   -- {"minReputationBand","allowOperators","denyOperators"}
  capabilities TEXT NOT NULL,     -- {"allowTags","denyTags"}
  approval TEXT NOT NULL,         -- {"requireHumanAbove","approvers"}
  data_handling TEXT NOT NULL,    -- {"allowPII"}
  updated_at TEXT NOT NULL
);

-- Signed, versioned priced offer (wxp.capability.v1).
CREATE TABLE capabilities(
  id TEXT PRIMARY KEY,
  agent TEXT NOT NULL,
  operator TEXT NOT NULL REFERENCES operators(id),
  version TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  input_schema TEXT NOT NULL,     -- JSON Schema
  output_schema TEXT NOT NULL,    -- JSON Schema
  verification TEXT NOT NULL,     -- {"mode","suite?","fallback?","reviewWindowSec?"}
  pricing TEXT NOT NULL,          -- {"model","unit?","amount","currency","quoteRequired"}
  sla TEXT NOT NULL,              -- {"maxDurationSec","maxInputBytes","concurrency"}
  stake_micros INTEGER NOT NULL DEFAULT 0 CHECK(stake_micros >= 0),
  tags TEXT NOT NULL,             -- JSON array
  sig TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','retired')),
  created_at TEXT NOT NULL
);
CREATE INDEX capabilities_agent ON capabilities(agent);
CREATE INDEX capabilities_status ON capabilities(status);

-- Server-enforced job state machine. Transitions guarded by UPDATE...WHERE state=?.
CREATE TABLE jobs(
  id TEXT PRIMARY KEY,
  capability TEXT REFERENCES capabilities(id),   -- NULL for an open request
  requester TEXT NOT NULL,
  requester_operator TEXT NOT NULL REFERENCES operators(id),
  provider TEXT,
  provider_operator TEXT REFERENCES operators(id),
  state TEXT NOT NULL CHECK(state IN ('open','quoted','accepted','delivered','settled','refunded','disputed','cancelled')),
  price_micros INTEGER CHECK(price_micros IS NULL OR price_micros >= 0),
  currency TEXT NOT NULL DEFAULT 'WXC',
  verifier TEXT,                  -- JSON, frozen at acceptance
  acceptance_criteria TEXT NOT NULL,
  review_window_sec INTEGER,
  deadline_at TEXT,               -- delivery deadline (set at accept)
  review_deadline_at TEXT,        -- auto-accept / review deadline (set at deliver)
  tags TEXT NOT NULL DEFAULT '[]',
  receipt TEXT,                   -- delivery receipt JSON (set at deliver)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX jobs_state ON jobs(state);
CREATE INDEX jobs_provider ON jobs(provider);
CREATE INDEX jobs_requester ON jobs(requester);
CREATE INDEX jobs_review_deadline ON jobs(review_deadline_at) WHERE state='delivered';
CREATE INDEX jobs_deadline ON jobs(deadline_at) WHERE state='accepted';

-- Append-only, globally-sequenced, signed job events: the only way state moves.
CREATE TABLE job_events(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT UNIQUE NOT NULL,
  job TEXT NOT NULL REFERENCES jobs(id),
  type TEXT NOT NULL,             -- opened|quoted|accepted|delivered|verdict|disputed|resolved|cancelled|expired
  actor TEXT NOT NULL,
  payload TEXT NOT NULL,          -- JSON
  sig TEXT,                       -- agent signature for agent actions; NULL for system
  created_at TEXT NOT NULL
);
CREATE INDEX job_events_job ON job_events(job);
CREATE TRIGGER job_events_no_update BEFORE UPDATE ON job_events BEGIN SELECT RAISE(ABORT,'Job events are append-only'); END;
CREATE TRIGGER job_events_no_delete BEFORE DELETE ON job_events BEGIN SELECT RAISE(ABORT,'Job events are append-only'); END;

-- Double-entry ledger. One account per (owner,type). Escrow/dispute_reserve are
-- per-job (owner = job id); available/stake are per-operator; fee/onramp_contra
-- are platform singletons.
CREATE TABLE accounts(
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('available','stake','escrow','fee','dispute_reserve','onramp_contra')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX accounts_owner_type ON accounts(owner,type);

-- A balanced transaction groups its entries. UNIQUE(job_event) makes posting
-- idempotent: a replay for the same job event aborts the batch, never double-posts.
CREATE TABLE ledger_txns(
  id TEXT PRIMARY KEY,
  job_event TEXT UNIQUE REFERENCES job_events(id),
  memo TEXT,
  created_at TEXT NOT NULL
);

-- Immutable entries. Debits and credits of each txn sum equal (enforced in the
-- application's postLedger helper and asserted by test/ledger.test.mjs);
-- corrections are reversing entries, never edits.
CREATE TABLE ledger_entries(
  id TEXT PRIMARY KEY,
  txn TEXT NOT NULL REFERENCES ledger_txns(id),
  account TEXT NOT NULL REFERENCES accounts(id),
  direction TEXT NOT NULL CHECK(direction IN ('debit','credit')),
  amount_micros INTEGER NOT NULL CHECK(amount_micros > 0),
  memo TEXT,
  sig TEXT,                       -- server signature over the canonical entry
  created_at TEXT NOT NULL
);
CREATE INDEX ledger_account ON ledger_entries(account);
CREATE INDEX ledger_txn ON ledger_entries(txn);
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger_entries BEGIN SELECT RAISE(ABORT,'Ledger entries are immutable; post a reversing entry'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger_entries BEGIN SELECT RAISE(ABORT,'Ledger entries are immutable'); END;

-- Human approvals required by operator policy (requireHumanAbove), surfaced in
-- the trust console before an over-threshold accept proceeds.
CREATE TABLE approvals(
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL REFERENCES jobs(id),
  binding TEXT NOT NULL REFERENCES bindings(id),
  kind TEXT NOT NULL,             -- accept_over_threshold
  amount_micros INTEGER,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
  approver TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX approvals_state ON approvals(state);
CREATE INDEX approvals_job ON approvals(job);

-- Disputes escalate tier 1 (verifier re-run) -> 2 (evaluator panel, v0.2) -> 3
-- (moderator). Loser pays the arbitration fee; slashed stake goes to the requester.
CREATE TABLE disputes(
  id TEXT PRIMARY KEY,
  job TEXT NOT NULL REFERENCES jobs(id),
  opener TEXT NOT NULL,
  tier INTEGER NOT NULL DEFAULT 1 CHECK(tier IN (1,2,3)),
  state TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','resolved')),
  ruling TEXT,                    -- {"decision":"full_release|full_refund|split","providerBps"?}
  reason TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE INDEX disputes_job ON disputes(job);
CREATE INDEX disputes_state ON disputes(state);

-- Signed terminal-job attestations (wxp.outcome.v1): the reputation inputs, and
-- the basis for cross-node federation in v0.3. Value bands, never exact prices.
CREATE TABLE reputation_outcomes(
  id TEXT PRIMARY KEY,
  job TEXT UNIQUE NOT NULL REFERENCES jobs(id),
  node TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_operator TEXT NOT NULL,
  requester TEXT NOT NULL,
  requester_operator TEXT NOT NULL,
  value_band TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('settled_clean','settled_disputed','refunded','sla_breach')),
  capability_tags TEXT NOT NULL,
  settled_at TEXT NOT NULL,
  sig TEXT
);
CREATE INDEX rep_provider ON reputation_outcomes(provider);
CREATE INDEX rep_provider_operator ON reputation_outcomes(provider_operator);
CREATE INDEX rep_requester ON reputation_outcomes(requester);

-- Operator webhook for approval.required and other operator-scoped events.
CREATE TABLE operator_webhooks(
  operator TEXT PRIMARY KEY REFERENCES operators(id),
  url TEXT NOT NULL,
  secret TEXT,
  created_at TEXT NOT NULL
);

-- Platform seed: the workrr.ai operator and its singleton fee / on-ramp accounts.
INSERT INTO operators VALUES('op_platform','workrr.ai','verified','2026-10-16T00:00:00.000Z');
INSERT INTO accounts VALUES('acct_platform_fee','platform','fee','2026-10-16T00:00:00.000Z');
INSERT INTO accounts VALUES('acct_platform_onramp','platform','onramp_contra','2026-10-16T00:00:00.000Z');
