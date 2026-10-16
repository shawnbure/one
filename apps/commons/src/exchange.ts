// Workrr Exchange Protocol (WXP) v0.1 — the economic layer on ONE.
// Agents bind to accountable operators, publish priced capabilities, take jobs
// under escrow, prove delivery, get paid in WXC credits, and earn reputation
// only from settled work. This module owns money, jobs and trust; it reuses
// ONE's signed-request auth (identity.ts) and atomic commit+notify (store.ts).
//
// Invariants enforced here:
//  - Value moves ONLY through balanced, double-entry ledger txns (postLedger).
//  - Balances are DERIVED from ledger_entries, never stored.
//  - Every job transition is a signed job_event (the request's Ed25519 sig).
//  - Escrow is funded at Accept and only leaves at Settle/Refund/ruling.
//  - Posting is idempotent per job_event (ledger_txns.job_event is UNIQUE).
import { Store } from "./store";
import { fail, now, id, text, choice, type AppEnv, type Agent } from "./types";
import { canonical, serverSign, requireSigned, verifyDetached } from "./signing";
import { verifyTestSuite } from "./verification";
import { reputationFor } from "./reputation";

const WXC = 1_000_000; // micro-credits per WXC
const FEE_BPS = 700; // 7% provider-side take rate
const FEE_FLOOR = 1_000; // 0.001 WXC
const FEE_CAP = 50 * WXC; // 50 WXC
const REVIEW_WINDOWS: Record<string, number> = {
  test_suite: 0,
  evaluator: 3600,
  requester_review: 86400,
  human: 259200,
};
const VERIFIER_MODES = [
  "test_suite",
  "evaluator",
  "requester_review",
  "human",
] as const;

export interface ExchangeDeps {
  request: Request;
  env: AppEnv;
  ctx: ExecutionContext;
  url: URL;
  store: Store;
  json: (data: unknown, status?: number) => Response;
  bodyOf: (request: Request) => Promise<Record<string, unknown>>;
  authenticate: (request: Request) => Promise<Agent>;
  backgroundFlush: () => void;
  rejectCredentials: (values: unknown[]) => void;
}

const acct = (type: string, owner: string) => `acct_${type}_${owner}`;
const ensureAccount = (env: AppEnv, type: string, owner: string) =>
  env.DB.prepare(
    "INSERT OR IGNORE INTO accounts(id,owner,type,created_at) VALUES(?,?,?,?)",
  ).bind(acct(type, owner), owner, type, now());

function toMicros(value: unknown, name: string): number {
  if (typeof value === "string" && /^\d+(\.\d{1,6})?$/.test(value)) {
    const [whole, frac = ""] = value.split(".");
    return Number(whole) * WXC + Number(frac.padEnd(6, "0"));
  }
  return fail(400, `${name} must be a WXC amount like "0.40" (≤6 decimals)`);
}
const fromMicros = (micros: number) => (micros / WXC).toFixed(6);
function feeMicros(price: number): number {
  return Math.min(price, Math.min(Math.max(Math.round((price * FEE_BPS) / 10000), FEE_FLOOR), FEE_CAP));
}
const bandRank = (b: string) => ({ A: 5, B: 4, C: 3, D: 2, E: 1 })[b] || 0;
function valueBand(micros: number): string {
  const wxc = micros / WXC;
  if (wxc < 1) return "0-1";
  if (wxc < 10) return "1-10";
  if (wxc < 100) return "10-100";
  if (wxc < 1000) return "100-1000";
  return "1000+";
}

async function balance(env: AppEnv, accountId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COALESCE(SUM(CASE direction WHEN 'credit' THEN amount_micros ELSE -amount_micros END),0) AS bal FROM ledger_entries WHERE account=?",
  )
    .bind(accountId)
    .first<{ bal: number }>();
  return row?.bal || 0;
}

interface Leg {
  account: string; // account id
  direction: "debit" | "credit";
  amount: number; // micros, > 0
  memo?: string;
}
/** A precondition shared by every statement of a money-moving transition,
 *  expressed as a SQL boolean with `?` placeholders. Because the txn row, every
 *  entry, the job event and the state UPDATE all carry the SAME guard (as
 *  `INSERT ... SELECT ... WHERE <sql>` / `UPDATE ... WHERE <sql>`), the move is
 *  atomic and all-or-nothing: if the guard is false at commit time (wrong state,
 *  insufficient balance, or a lost concurrent race) nothing is written, and the
 *  caller detects it from the guarded UPDATE/INSERT ... RETURNING being empty.
 *  D1 batches run in one serialized transaction, so a concurrent transition that
 *  commits first flips the guard false for the loser. */
interface Guard {
  sql: string;
  binds: unknown[];
}
const stateGuard = (jobId: string, states: string[]): Guard => ({
  sql: `(SELECT state FROM jobs WHERE id=?) IN (${states.map(() => "?").join(",")})`,
  binds: [jobId, ...states],
});
const balanceGuard = (accountId: string, atLeast: number): Guard => ({
  sql: "(SELECT COALESCE(SUM(CASE direction WHEN 'credit' THEN amount_micros ELSE -amount_micros END),0) FROM ledger_entries WHERE account=?) >= ?",
  binds: [accountId, atLeast],
});
function andGuards(...guards: (Guard | undefined)[]): Guard | undefined {
  const g = guards.filter((x): x is Guard => !!x);
  if (!g.length) return undefined;
  return { sql: g.map((x) => `(${x.sql})`).join(" AND "), binds: g.flatMap((x) => x.binds) };
}

/** Build the atomic statements for one balanced ledger transaction, signing each
 *  entry with the server key. Throws unless debits == credits. When `guard` is
 *  given, every statement only writes if the guard holds. */
async function postLedger(
  env: AppEnv,
  jobEventId: string | null,
  memo: string,
  legs: Leg[],
  guard?: Guard,
): Promise<D1PreparedStatement[]> {
  let net = 0;
  for (const l of legs) {
    if (!Number.isInteger(l.amount) || l.amount <= 0)
      fail(500, "Ledger leg amounts must be positive integer micro-credits");
    net += l.direction === "credit" ? l.amount : -l.amount;
  }
  if (net !== 0) fail(500, "Ledger transaction does not balance");
  const txn = `txn_${id()}`;
  const ts = now();
  const where = guard ? ` WHERE ${guard.sql}` : "";
  const gb = guard ? guard.binds : [];
  const statements: D1PreparedStatement[] = [
    guard
      ? env.DB.prepare(
          `INSERT INTO ledger_txns(id,job_event,memo,created_at) SELECT ?,?,?,?${where}`,
        ).bind(txn, jobEventId, memo, ts, ...gb)
      : env.DB.prepare(
          "INSERT INTO ledger_txns(id,job_event,memo,created_at) VALUES(?,?,?,?)",
        ).bind(txn, jobEventId, memo, ts),
  ];
  for (const l of legs) {
    const entryId = `le_${id()}`;
    const sig = await serverSign(
      env,
      canonical({ txn, account: l.account, direction: l.direction, amount: l.amount, at: ts }),
    );
    statements.push(
      guard
        ? env.DB.prepare(
            `INSERT INTO ledger_entries(id,txn,account,direction,amount_micros,memo,sig,created_at) SELECT ?,?,?,?,?,?,?,?${where}`,
          ).bind(entryId, txn, l.account, l.direction, l.amount, l.memo || memo, sig, ts, ...gb)
        : env.DB.prepare(
            "INSERT INTO ledger_entries(id,txn,account,direction,amount_micros,memo,sig,created_at) VALUES(?,?,?,?,?,?,?,?)",
          ).bind(entryId, txn, l.account, l.direction, l.amount, l.memo || memo, sig, ts),
    );
  }
  return statements;
}

function jobEventStatement(
  env: AppEnv,
  jobEventId: string,
  jobId: string,
  type: string,
  actor: string,
  payload: unknown,
  sig: string | null,
  guard?: Guard,
) {
  const ts = now();
  const payloadJson = JSON.stringify(payload ?? {});
  return guard
    ? env.DB.prepare(
        `INSERT INTO job_events(id,job,type,actor,payload,sig,created_at) SELECT ?,?,?,?,?,?,? WHERE ${guard.sql}`,
      ).bind(jobEventId, jobId, type, actor, payloadJson, sig, ts, ...guard.binds)
    : env.DB.prepare(
        "INSERT INTO job_events(id,job,type,actor,payload,sig,created_at) VALUES(?,?,?,?,?,?,?)",
      ).bind(jobEventId, jobId, type, actor, payloadJson, sig, ts);
}

interface BindingRow {
  id: string;
  operator: string;
  agent: string;
  agent_pubkey: string;
  scopes: string;
  status: string;
}
async function activeBinding(env: AppEnv, agent: string): Promise<BindingRow> {
  const row = await env.DB.prepare(
    "SELECT id,operator,agent,agent_pubkey,scopes,status FROM bindings WHERE agent=? AND status='active'",
  )
    .bind(agent)
    .first<BindingRow>();
  if (!row) fail(403, "Agent is not bound to an accountable operator");
  return row;
}

const handleOf = (request: Request, actor: Agent) =>
  (request.headers.get("X-One-Handle") || actor.name).toLowerCase();

async function pubkeyOfHandle(env: AppEnv, handle: string): Promise<string> {
  const row = await env.DB.prepare(
    "SELECT public_key FROM handles WHERE handle=?",
  )
    .bind(handle)
    .first<{ public_key: string | null }>();
  if (!row?.public_key) fail(400, `Handle ${handle} has no signing key`);
  return row.public_key as string;
}

// --- Route handler -----------------------------------------------------------

export async function exchange(deps: ExchangeDeps): Promise<Response> {
  const { request, env, url, store, json } = deps;
  const path = url.pathname;
  const method = request.method;
  const seg = path.split("/").filter(Boolean); // ["api","v1","exchange",...]
  const rest = seg.slice(3); // after /api/v1/exchange

  // Public reads (no auth).
  if (method === "GET" && rest[0] === "capabilities" && !rest[1])
    return listCapabilities(deps);
  if (method === "GET" && rest[0] === "capabilities" && rest[1])
    return json(await getCapability(env, rest[1]));
  if (method === "GET" && rest[0] === "operators" && rest[1] && !rest[2])
    return json(await getOperator(env, rest[1]));
  if (method === "GET" && rest[0] === "reputation" && rest[1])
    return json(await reputationFor(env, rest[1]));

  // Everything else is authenticated.
  const actor = await deps.authenticate(request);
  if (!(await env.WRITE_LIMIT.limit({ key: actor.id })).success)
    return json({ error: "Write rate limit; retry in 60 seconds" }, 429);
  const handle = handleOf(request, actor);

  if (method === "POST" && rest[0] === "operators" && !rest[1])
    return createOperator(deps, actor, handle);
  if (method === "POST" && rest[0] === "bindings" && !rest[1])
    return createBinding(deps, actor, handle);
  if (method === "PUT" && rest[0] === "bindings" && rest[1] && rest[2] === "policy")
    return setPolicy(deps, actor, handle, rest[1]);
  if (method === "POST" && rest[0] === "capabilities" && !rest[1])
    return publishCapability(deps, actor, handle);
  if (method === "POST" && rest[0] === "jobs" && !rest[1])
    return openJob(deps, actor, handle);
  if (method === "GET" && rest[0] === "jobs" && !rest[1])
    return listJobs(deps, actor, handle);
  if (method === "GET" && rest[0] === "jobs" && rest[1] && !rest[2])
    return getJob(deps, actor, handle, rest[1]);
  if (method === "POST" && rest[0] === "jobs" && rest[1] && rest[2] === "quote")
    return quoteJob(deps, actor, handle, rest[1]);
  if (method === "POST" && rest[0] === "jobs" && rest[1] && rest[2] === "accept")
    return acceptJob(deps, actor, handle, rest[1]);
  if (method === "POST" && rest[0] === "jobs" && rest[1] && rest[2] === "deliver")
    return deliverJob(deps, actor, handle, rest[1]);
  if (method === "POST" && rest[0] === "jobs" && rest[1] && rest[2] === "verify")
    return verifyJob(deps, actor, handle, rest[1]);
  if (method === "POST" && rest[0] === "jobs" && rest[1] && rest[2] === "dispute")
    return openDispute(deps, actor, handle, rest[1]);
  if (method === "GET" && rest[0] === "disputes" && !rest[1])
    return listDisputes(deps, actor);
  if (method === "POST" && rest[0] === "disputes" && rest[1] && rest[2] === "resolve")
    return resolveDispute(deps, actor, handle, rest[1]);
  if (method === "GET" && rest[0] === "approvals" && !rest[1])
    return listApprovals(deps, actor, handle);
  if (method === "POST" && rest[0] === "approvals" && rest[1])
    return decideApproval(deps, actor, handle, rest[1]);
  if (method === "POST" && rest[0] === "credits" && rest[1] === "grant")
    return grantCredits(deps, actor);
  if (method === "GET" && rest[0] === "accounts" && rest[1] && rest[2] === "ledger")
    return ledgerExport(deps, actor, handle, rest[1]);

  return json({ error: "Exchange endpoint not found" }, 404);
}

// --- Operators & bindings ----------------------------------------------------

async function createOperator(deps: ExchangeDeps, actor: Agent, handle: string) {
  const { env, store, json } = deps;
  requireSigned(actor.signingPublicKey);
  const body = await deps.bodyOf(deps.request);
  const displayName = text(body.displayName, "displayName", 120);
  const operatorId = `op_${id()}`;
  const ts = now();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO operators(id,display_name,kyb_status,created_at) VALUES(?,?,'none',?)",
    ).bind(operatorId, displayName, ts),
    ensureAccount(env, "available", operatorId),
    ensureAccount(env, "stake", operatorId),
  ];
  let binding: Record<string, unknown> | null = null;
  // Auto-bind the controlling agent (both signatures are the controller's own
  // signed request) unless the caller opts out. This is the handle -> bound step.
  if (body.bindSelf !== false) {
    const bindingId = `bnd_${id()}`;
    const reqSig = request_sig(deps.request);
    binding = {
      type: "wxp.binding.v1",
      id: bindingId,
      operator: operatorId,
      agent: handle,
      scopes: ["quote", "accept", "settle"],
      issuedAt: ts,
    };
    statements.push(
      env.DB.prepare(
        "INSERT INTO bindings(id,operator,agent,agent_pubkey,scopes,issued_at,expires_at,sig_agent,sig_operator,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?)",
      ).bind(
        bindingId,
        operatorId,
        handle,
        actor.signingPublicKey!,
        JSON.stringify(["quote", "accept", "settle"]),
        ts,
        null,
        reqSig,
        reqSig,
        ts,
      ),
      defaultPolicyStatement(env, bindingId),
    );
  }
  statements.push(store.event(actor.id, "created an exchange operator", operatorId));
  try {
    await store.commit(statements, "exchange");
  } catch (e) {
    if (/UNIQUE/.test(String(e)))
      fail(409, "Agent already has an active binding");
    throw e;
  }
  deps.backgroundFlush();
  return json({ operator: { id: operatorId, displayName }, binding }, 201);
}

function request_sig(request: Request): string {
  return request.headers.get("X-One-Signature") || "";
}

function defaultPolicyStatement(env: AppEnv, binding: string) {
  return env.DB.prepare(
    "INSERT INTO policies(binding,spend,earn,counterparties,capabilities,approval,data_handling,updated_at) VALUES(?,?,?,?,?,?,?,?)",
  ).bind(
    binding,
    JSON.stringify({ perJob: "25.00", perDay: "200.00", currency: "WXC" }),
    JSON.stringify({ maxOpenJobs: 10 }),
    JSON.stringify({ minReputationBand: "E", allowOperators: [], denyOperators: [] }),
    JSON.stringify({ allowTags: [], denyTags: [] }),
    JSON.stringify({ requireHumanAbove: "50.00", approvers: [] }),
    JSON.stringify({ allowPII: false }),
    now(),
  );
}

async function createBinding(deps: ExchangeDeps, actor: Agent, handle: string) {
  const { env, store, json } = deps;
  requireSigned(actor.signingPublicKey);
  const body = await deps.bodyOf(deps.request);
  const operatorId = text(body.operator, "operator", 60);
  const operator = await env.DB.prepare("SELECT id FROM operators WHERE id=?")
    .bind(operatorId)
    .first<{ id: string }>();
  if (!operator) fail(404, "Operator not found");
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.map((s) => text(s, "scope", 20))
    : ["quote", "accept", "settle"];
  const expiresAt = body.expiresAt ? text(body.expiresAt, "expiresAt", 40) : null;
  const issuedAt = now();
  // The operator's controller co-signs a canonical binding text; the bound
  // agent's signature is the signed request itself.
  const bindingText = canonical({
    type: "wxp.binding.v1",
    operator: operatorId,
    agent: handle,
    agentPubkey: actor.signingPublicKey,
    scopes,
    issuedAt,
    expiresAt,
  });
  const sigOperator = text(body.sigOperator, "sigOperator", 120);
  const operatorPubkey = text(body.operatorPubkey, "operatorPubkey", 44);
  if (!(await verifyDetached(operatorPubkey, bindingText, sigOperator)))
    fail(400, "Invalid operator signature over the binding");
  const bindingId = `bnd_${id()}`;
  try {
    await store.commit(
      [
        env.DB.prepare(
          "INSERT INTO bindings(id,operator,agent,agent_pubkey,scopes,issued_at,expires_at,sig_agent,sig_operator,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?)",
        ).bind(
          bindingId,
          operatorId,
          handle,
          actor.signingPublicKey!,
          JSON.stringify(scopes),
          issuedAt,
          expiresAt,
          request_sig(deps.request),
          sigOperator,
          issuedAt,
        ),
        defaultPolicyStatement(env, bindingId),
        store.event(actor.id, "bound to an operator", operatorId),
      ],
      "exchange",
    );
  } catch (e) {
    if (/UNIQUE/.test(String(e))) fail(409, "Agent already has an active binding");
    throw e;
  }
  deps.backgroundFlush();
  return json({ binding: { id: bindingId, operator: operatorId, agent: handle, scopes } }, 201);
}

async function setPolicy(deps: ExchangeDeps, actor: Agent, handle: string, bindingId: string) {
  const { env, store, json } = deps;
  requireSigned(actor.signingPublicKey);
  const row = await env.DB.prepare(
    "SELECT b.id,b.operator,b.agent FROM bindings b WHERE b.id=?",
  )
    .bind(bindingId)
    .first<{ id: string; operator: string; agent: string }>();
  if (!row) fail(404, "Binding not found");
  // The operator controller (the agent that created the operator's self-binding)
  // or the bound agent may set policy in v0.1.
  if (row.agent !== handle && !isOperatorController(env, row.operator, handle))
    fail(403, "Only the operator or bound agent may set policy");
  const body = await deps.bodyOf(deps.request);
  const current = await env.DB.prepare(
    "SELECT spend,earn,counterparties,capabilities,approval,data_handling FROM policies WHERE binding=?",
  )
    .bind(bindingId)
    .first<Record<string, string>>();
  if (!current) fail(404, "Policy not found");
  const merged = {
    spend: body.spend ?? JSON.parse(current.spend),
    earn: body.earn ?? JSON.parse(current.earn),
    counterparties: body.counterparties ?? JSON.parse(current.counterparties),
    capabilities: body.capabilities ?? JSON.parse(current.capabilities),
    approval: body.approval ?? JSON.parse(current.approval),
    dataHandling: body.dataHandling ?? JSON.parse(current.data_handling),
  };
  await store.commit(
    [
      env.DB.prepare(
        "UPDATE policies SET spend=?,earn=?,counterparties=?,capabilities=?,approval=?,data_handling=?,updated_at=? WHERE binding=?",
      ).bind(
        JSON.stringify(merged.spend),
        JSON.stringify(merged.earn),
        JSON.stringify(merged.counterparties),
        JSON.stringify(merged.capabilities),
        JSON.stringify(merged.approval),
        JSON.stringify(merged.dataHandling),
        now(),
        bindingId,
      ),
      store.event(actor.id, "updated operator policy", bindingId),
    ],
    "exchange",
  );
  deps.backgroundFlush();
  return json({ binding: bindingId, policy: merged });
}

async function isOperatorController(env: AppEnv, operator: string, handle: string): Promise<boolean> {
  const row = await env.DB.prepare(
    "SELECT 1 AS ok FROM bindings WHERE operator=? AND agent=? AND status='active'",
  )
    .bind(operator, handle)
    .first<{ ok: number }>();
  return !!row;
}

async function getOperator(env: AppEnv, operatorId: string) {
  const op = await env.DB.prepare(
    "SELECT id,display_name,kyb_status,created_at FROM operators WHERE id=?",
  )
    .bind(operatorId)
    .first<Record<string, unknown>>();
  if (!op) fail(404, "Operator not found");
  return { operator: op };
}

// --- Capabilities ------------------------------------------------------------

async function publishCapability(deps: ExchangeDeps, actor: Agent, handle: string) {
  const { env, store, json } = deps;
  requireSigned(actor.signingPublicKey);
  const binding = await activeBinding(env, handle);
  const body = await deps.bodyOf(deps.request);
  deps.rejectCredentials([body.name, body.summary]);
  const verification = (body.verification as Record<string, unknown>) || {};
  const mode = choice(verification.mode, VERIFIER_MODES);
  const pricing = (body.pricing as Record<string, unknown>) || {};
  const amount = text(pricing.amount, "pricing.amount", 20);
  toMicros(amount, "pricing.amount"); // validate
  const stakeMicros = body.stake
    ? toMicros((body.stake as Record<string, unknown>).amount, "stake.amount")
    : 0;
  const capId = `cap_${id()}`;
  const ts = now();
  const record = {
    type: "wxp.capability.v1",
    id: capId,
    agent: handle,
    operator: binding.operator,
    version: text(body.version || "1.0.0", "version", 20),
    name: text(body.name, "name", 80),
    summary: text(body.summary, "summary", 500),
    input: body.input ?? { type: "object" },
    output: body.output ?? { type: "object" },
    verification: {
      mode,
      suite: verification.suite ?? null,
      // Inline deterministic assertions for test_suite mode (bounded, checked at
      // delivery). Free-text-only acceptance criteria force requester_review.
      assertions: Array.isArray(verification.assertions)
        ? (verification.assertions as unknown[]).slice(0, 50)
        : [],
      fallback: verification.fallback ?? "requester_review",
      reviewWindowSec: Number(verification.reviewWindowSec) || REVIEW_WINDOWS[mode],
    },
    pricing: {
      model: pricing.model || "flat",
      unit: pricing.unit ?? null,
      amount,
      currency: pricing.currency || "WXC",
      quoteRequired: pricing.quoteRequired === true,
    },
    sla: body.sla ?? { maxDurationSec: 900, maxInputBytes: 50_000_000, concurrency: 4 },
    tags: Array.isArray(body.tags) ? body.tags.map((t) => text(t, "tag", 40)) : [],
    stake: { amount: fromMicros(stakeMicros), currency: "WXC" },
  };
  const sig = request_sig(deps.request);
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      "INSERT INTO capabilities(id,agent,operator,version,name,summary,input_schema,output_schema,verification,pricing,sla,stake_micros,tags,sig,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?)",
    ).bind(
      capId,
      handle,
      binding.operator,
      record.version,
      record.name,
      record.summary,
      JSON.stringify(record.input),
      JSON.stringify(record.output),
      JSON.stringify(record.verification),
      JSON.stringify(record.pricing),
      JSON.stringify(record.sla),
      stakeMicros,
      JSON.stringify(record.tags),
      sig,
      ts,
    ),
  ];
  // Lock any declared stake: operator available -> operator stake.
  if (stakeMicros > 0) {
    const avail = acct("available", binding.operator);
    if ((await balance(env, avail)) < stakeMicros)
      fail(402, "Insufficient available balance to lock the declared stake");
    statements.push(
      ...(await postLedger(env, null, `stake:${capId}`, [
        { account: avail, direction: "debit", amount: stakeMicros },
        { account: acct("stake", binding.operator), direction: "credit", amount: stakeMicros },
      ])),
    );
  }
  statements.push(store.event(actor.id, "published a capability", capId));
  await store.commit(statements, "exchange");
  deps.backgroundFlush();
  return json({ capability: record }, 201);
}

async function getCapability(env: AppEnv, capId: string) {
  const row = await env.DB.prepare("SELECT * FROM capabilities WHERE id=?")
    .bind(capId)
    .first<Record<string, any>>();
  if (!row) fail(404, "Capability not found");
  return { capability: shapeCapability(row) };
}

function shapeCapability(row: Record<string, any>) {
  return {
    id: row.id,
    agent: row.agent,
    operator: row.operator,
    version: row.version,
    name: row.name,
    summary: row.summary,
    input: JSON.parse(row.input_schema),
    output: JSON.parse(row.output_schema),
    verification: JSON.parse(row.verification),
    pricing: JSON.parse(row.pricing),
    sla: JSON.parse(row.sla),
    stake: { amount: fromMicros(row.stake_micros), currency: "WXC" },
    tags: JSON.parse(row.tags),
    status: row.status,
    sig: row.sig,
    createdAt: row.created_at,
  };
}

async function listCapabilities(deps: ExchangeDeps) {
  const { env, url, json } = deps;
  const tag = url.searchParams.get("tag");
  const agent = url.searchParams.get("agent");
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const rows = await env.DB.prepare(
    `SELECT * FROM capabilities WHERE status='active'
       AND (?1 IS NULL OR EXISTS(SELECT 1 FROM json_each(tags) WHERE value=?1))
       AND (?2 IS NULL OR agent=?2)
     ORDER BY rowid DESC LIMIT ?3`,
  )
    .bind(tag, agent, limit)
    .all<Record<string, any>>();
  return json({ capabilities: rows.results.map(shapeCapability) });
}

// --- Jobs --------------------------------------------------------------------

async function openJob(deps: ExchangeDeps, actor: Agent, handle: string) {
  const { env, store, json } = deps;
  requireSigned(actor.signingPublicKey);
  const requesterBinding = await activeBinding(env, handle);
  const body = await deps.bodyOf(deps.request);
  deps.rejectCredentials([body.acceptanceCriteria, body.input]);
  const acceptanceCriteria = text(body.acceptanceCriteria, "acceptanceCriteria", 4000);
  const tags = Array.isArray(body.tags) ? body.tags.map((t) => text(t, "tag", 40)) : [];
  const jobId = `job_${id()}`;
  const ts = now();

  if (body.capability) {
    // Direct job against a fixed-price capability: Open -> Accepted in one step.
    const cap = await env.DB.prepare("SELECT * FROM capabilities WHERE id=? AND status='active'")
      .bind(text(body.capability, "capability", 60))
      .first<Record<string, any>>();
    if (!cap) fail(404, "Capability not found or retired");
    const pricing = JSON.parse(cap.pricing);
    if (pricing.quoteRequired)
      fail(409, "This capability requires a quote; open it as a request and call /quote");
    const price = toMicros(pricing.amount, "price");
    const verification = JSON.parse(cap.verification);
    return acceptNewJob(deps, actor, handle, {
      jobId,
      capability: cap.id,
      provider: cap.agent,
      providerOperator: cap.operator,
      requesterBinding,
      price,
      verification,
      acceptanceCriteria,
      tags: tags.length ? tags : JSON.parse(cap.tags),
      ts,
    });
  }

  // Open request: no provider yet, awaiting quotes.
  const eventId = `je_${id()}`;
  await store.commit(
    [
      env.DB.prepare(
        "INSERT INTO jobs(id,capability,requester,requester_operator,state,acceptance_criteria,tags,created_at,updated_at) VALUES(?,?,?,?,'open',?,?,?,?)",
      ).bind(jobId, null, handle, requesterBinding.operator, acceptanceCriteria, JSON.stringify(tags), ts, ts),
      jobEventStatement(env, eventId, jobId, "opened", handle, { acceptanceCriteria, tags }, request_sig(deps.request)),
      store.event(actor.id, "opened an exchange job request", jobId),
    ],
    "exchange",
  );
  deps.backgroundFlush();
  return json({ job: { id: jobId, state: "open", requester: handle, acceptanceCriteria, tags } }, 201);
}

interface AcceptArgs {
  jobId: string;
  capability: string | null;
  provider: string;
  providerOperator: string;
  requesterBinding: BindingRow;
  price: number;
  verification: Record<string, any>;
  acceptanceCriteria: string;
  tags: string[];
  ts: string;
  existingJob?: boolean;
  approved?: boolean; // human approval already granted; skip the threshold gate
}
/** Create (or advance) a job into Accepted: policy + balance checked, escrow
 *  funded under an atomic state+balance guard, verifier frozen. Shared by direct
 *  jobs and quote-accept. */
async function acceptNewJob(deps: ExchangeDeps, actor: Agent, handle: string, a: AcceptArgs) {
  const { env, store, json } = deps;
  const reviewWindow = Number(a.verification.reviewWindowSec) || REVIEW_WINDOWS[a.verification.mode] || 86400;
  const verifier = { mode: a.verification.mode, suite: a.verification.suite ?? null, assertions: a.verification.assertions ?? [], reviewWindowSec: reviewWindow };
  const requesterAvail = acct("available", a.requesterBinding.operator);
  const deadline = new Date(Date.now() + 7 * 86400000).toISOString();

  // Policy pre-checks (read gates; the atomic guard enforces funds).
  const policy = await policyFor(env, a.requesterBinding.id);
  const perJob = toMicros(policy.spend.perJob, "policy.perJob");
  if (a.price > perJob)
    return json({ error: "policy_violation", rule: "spend.perJob", limit: policy.spend.perJob }, 403);
  if (Array.isArray(policy.capabilities.denyTags) && a.tags.some((t) => policy.capabilities.denyTags.includes(t)))
    return json({ error: "policy_violation", rule: "capabilities.denyTags" }, 403);
  if (Array.isArray(policy.counterparties.denyOperators) && policy.counterparties.denyOperators.includes(a.providerOperator))
    return json({ error: "policy_violation", rule: "counterparties.denyOperators" }, 403);
  const minBand = policy.counterparties.minReputationBand;
  if (minBand && minBand !== "E") {
    const rep = await reputationFor(env, a.providerOperator);
    if (bandRank(rep.band) < bandRank(minBand))
      return json({ error: "policy_violation", rule: "counterparties.minReputationBand", need: minBand, have: rep.band }, 403);
  }
  const requireAbove = toMicros(policy.approval.requireHumanAbove, "policy.requireHumanAbove");

  if (!a.approved && a.price > requireAbove) {
    // Over policy threshold: register/keep the job quoted, open a human approval,
    // fund NO escrow until the requester approves in the trust console.
    const approvalId = `apr_${id()}`;
    const quotedJob = a.existingJob
      ? env.DB.prepare("UPDATE jobs SET verifier=?,review_window_sec=?,updated_at=? WHERE id=? AND state='quoted' RETURNING id").bind(JSON.stringify(verifier), reviewWindow, now(), a.jobId)
      : env.DB.prepare(
          "INSERT INTO jobs(id,capability,requester,requester_operator,provider,provider_operator,state,price_micros,currency,verifier,acceptance_criteria,review_window_sec,tags,created_at,updated_at) VALUES(?,?,?,?,?,?,'quoted',?,'WXC',?,?,?,?,?,?) RETURNING id",
        ).bind(a.jobId, a.capability, handle, a.requesterBinding.operator, a.provider, a.providerOperator, a.price, JSON.stringify(verifier), a.acceptanceCriteria, reviewWindow, JSON.stringify(a.tags), a.ts, a.ts);
    const res = await env.DB.batch([
      quotedJob,
      env.DB.prepare(
        "INSERT INTO approvals(id,job,binding,kind,amount_micros,state,created_at) SELECT ?,?,?,'accept_over_threshold',?,'pending',? WHERE EXISTS(SELECT 1 FROM jobs WHERE id=? AND state='quoted')",
      ).bind(approvalId, a.jobId, a.requesterBinding.id, a.price, a.ts, a.jobId),
      jobEventStatement(env, `je_${id()}`, a.jobId, "approval_required", handle, { price: fromMicros(a.price), threshold: policy.approval.requireHumanAbove }, request_sig(deps.request), stateGuard(a.jobId, ["quoted"])),
      store.outbox("exchange"),
    ]);
    if (!(res[0].results as unknown[]).length) fail(409, "Job changed; refresh before accepting");
    deps.backgroundFlush();
    return json(
      {
        job: { id: a.jobId, state: "quoted", provider: a.provider, price: fromMicros(a.price) },
        approval: { id: approvalId, state: "pending", reason: "accept_over_threshold" },
        notice: "Over policy threshold; human approval required before escrow is funded.",
      },
      202,
    );
  }

  // Fund escrow atomically. Every statement shares the funding guard, so none
  // commit unless funds are present (and, for an existing quoted job, it is still
  // quoted). For a NEW direct job the guard is balance-only and the job INSERT
  // comes first (so the event/ledger can reference the row); for an EXISTING job
  // the state-changing UPDATE must come LAST, or it would flip its own
  // `state IN ('quoted')` guard false for the ledger statements behind it.
  const guard = a.existingJob
    ? andGuards(stateGuard(a.jobId, ["quoted"]), balanceGuard(requesterAvail, a.price))!
    : balanceGuard(requesterAvail, a.price);
  const eventId = `je_${id()}`;
  const event = jobEventStatement(env, eventId, a.jobId, "accepted", handle, { price: fromMicros(a.price), verifier }, request_sig(deps.request), guard);
  const ledger = await postLedger(env, eventId, `escrow:${a.jobId}`, [
    { account: requesterAvail, direction: "debit", amount: a.price, memo: "escrow funding" },
    { account: acct("escrow", a.jobId), direction: "credit", amount: a.price, memo: "escrow held" },
  ], guard);
  const stateStmt = a.existingJob
    ? env.DB.prepare(
        `UPDATE jobs SET state='accepted',verifier=?,review_window_sec=?,deadline_at=?,updated_at=? WHERE id=? AND ${guard.sql} RETURNING id`,
      ).bind(JSON.stringify(verifier), reviewWindow, deadline, now(), a.jobId, ...guard.binds)
    : env.DB.prepare(
        `INSERT INTO jobs(id,capability,requester,requester_operator,provider,provider_operator,state,price_micros,currency,verifier,acceptance_criteria,review_window_sec,deadline_at,tags,created_at,updated_at) SELECT ?,?,?,?,?,?,'accepted',?,'WXC',?,?,?,?,?,?,? WHERE ${guard.sql} RETURNING id`,
      ).bind(
        a.jobId, a.capability, handle, a.requesterBinding.operator, a.provider, a.providerOperator,
        a.price, JSON.stringify(verifier), a.acceptanceCriteria, reviewWindow, deadline,
        JSON.stringify(a.tags), a.ts, a.ts, ...guard.binds,
      );
  const batch = a.existingJob
    ? [ensureAccount(env, "escrow", a.jobId), event, ...ledger, stateStmt, store.outbox("exchange")]
    : [ensureAccount(env, "escrow", a.jobId), stateStmt, event, ...ledger, store.outbox("exchange")];
  const detectIndex = a.existingJob ? batch.length - 2 : 1;
  const res = await env.DB.batch(batch);
  if (!(res[detectIndex].results as unknown[]).length) {
    const have = await balance(env, requesterAvail);
    if (have < a.price) return json({ error: "insufficient_funds", need: fromMicros(a.price), have: fromMicros(have) }, 402);
    fail(409, "Job changed; refresh before accepting");
  }
  await store.event(actor.id, "accepted and funded a job", a.jobId).run();
  deps.backgroundFlush();
  return json(
    { job: { id: a.jobId, state: "accepted", provider: a.provider, price: fromMicros(a.price), verifier } },
    a.existingJob ? 200 : 201,
  );
}

async function quoteJob(deps: ExchangeDeps, actor: Agent, handle: string, jobId: string) {
  const { env, store, json } = deps;
  requireSigned(actor.signingPublicKey);
  const providerBinding = await activeBinding(env, handle);
  const body = await deps.bodyOf(deps.request);
  const price = toMicros(body.price, "price");
  const job = await getJobRow(env, jobId);
  if (job.state !== "open") fail(409, "Job is not open for quotes");
  if (job.requester === handle) fail(409, "Requester cannot quote their own job");
  const verifier = body.verifier
    ? { mode: choice((body.verifier as any).mode, VERIFIER_MODES), suite: (body.verifier as any).suite ?? null }
    : { mode: "requester_review", suite: null };
  const eventId = `je_${id()}`;
  const updated = await env.DB.batch([
    env.DB.prepare(
      "UPDATE jobs SET state='quoted',provider=?,provider_operator=?,price_micros=?,verifier=?,updated_at=? WHERE id=? AND state='open' RETURNING id",
    ).bind(handle, providerBinding.operator, price, JSON.stringify(verifier), now(), jobId),
    jobEventStatement(env, eventId, jobId, "quoted", handle, { price: fromMicros(price), verifier }, request_sig(deps.request)),
    store.outbox("exchange"),
  ]);
  if (!updated[0].results.length) fail(409, "Job changed; refresh before quoting");
  await store.event(actor.id, "quoted a job", jobId).run();
  deps.backgroundFlush();
  return json({ job: { id: jobId, state: "quoted", provider: handle, price: fromMicros(price), verifier } });
}

async function acceptJob(deps: ExchangeDeps, actor: Agent, handle: string, jobId: string) {
  const { env, json } = deps;
  requireSigned(actor.signingPublicKey);
  const job = await getJobRow(env, jobId);
  if (job.state !== "quoted") fail(409, "Only a quoted job can be accepted");
  if (job.requester !== handle) fail(403, "Only the requester can accept");
  const requesterBinding = await activeBinding(env, handle);
  return acceptNewJob(deps, actor, handle, {
    jobId,
    capability: job.capability,
    provider: job.provider!,
    providerOperator: job.provider_operator!,
    requesterBinding,
    price: job.price_micros!,
    verification: JSON.parse(job.verifier || '{"mode":"requester_review"}'),
    acceptanceCriteria: job.acceptance_criteria,
    tags: JSON.parse(job.tags || "[]"),
    ts: now(),
    existingJob: true,
  });
}

async function deliverJob(deps: ExchangeDeps, actor: Agent, handle: string, jobId: string) {
  const { env, store, json } = deps;
  requireSigned(actor.signingPublicKey);
  const job = await getJobRow(env, jobId);
  if (job.state !== "accepted") fail(409, "Only an accepted job can be delivered");
  if (job.provider !== handle) fail(403, "Only the provider can deliver");
  const body = await deps.bodyOf(deps.request);
  deps.rejectCredentials([body.claim, body.artifact]);
  const receipt = {
    artifact: body.artifact ?? null, // {hash, location}
    trace: body.trace ?? null, // OTel / Studio trace reference
    output: body.output ?? null, // structured output, asserted by test_suite mode
    claim: text(body.claim || "Delivered per acceptance criteria", "claim", 4000),
    deliveredAt: now(),
  };
  const verifier = JSON.parse(job.verifier || '{"mode":"requester_review"}');
  const reviewSec = job.review_window_sec ?? 86400;
  const reviewDeadline = new Date(Date.now() + reviewSec * 1000).toISOString();
  const eventId = `je_${id()}`;
  const updated = await env.DB.batch([
    env.DB.prepare(
      "UPDATE jobs SET state='delivered',receipt=?,review_deadline_at=?,updated_at=? WHERE id=? AND state='accepted' RETURNING id",
    ).bind(JSON.stringify(receipt), reviewDeadline, now(), jobId),
    jobEventStatement(env, eventId, jobId, "delivered", handle, receipt, request_sig(deps.request)),
    store.outbox("exchange"),
  ]);
  if (!updated[0].results.length) fail(409, "Job changed; refresh before delivering");
  await store.event(actor.id, "delivered a job", jobId).run();
  // test_suite verifies deterministically and immediately on delivery.
  if (verifier.mode === "test_suite") {
    const terminal = await verifyTestSuite(env, store, job, verifier, receipt, handle);
    deps.backgroundFlush();
    return json({ job: { id: jobId, state: terminal, receipt }, verification: { mode: "test_suite" } });
  }
  deps.backgroundFlush();
  return json({ job: { id: jobId, state: "delivered", receipt, reviewDeadline } });
}

async function verifyJob(deps: ExchangeDeps, actor: Agent, handle: string, jobId: string) {
  const { env, store, json } = deps;
  requireSigned(actor.signingPublicKey);
  const job = await getJobRow(env, jobId);
  if (job.state !== "delivered") fail(409, "Only a delivered job can be verified");
  const verifier = JSON.parse(job.verifier || '{"mode":"requester_review"}');
  const body = await deps.bodyOf(deps.request);
  const reason = body.reason ? text(body.reason, "reason", 2000) : null;
  // test_suite re-runs deterministically from the receipt (anyone may trigger it);
  // other modes are the requester's (or a named human's / platform verifier's) call.
  if (verifier.mode === "test_suite") {
    const receipt = job.receipt ? JSON.parse(job.receipt) : null;
    const terminal = await verifyTestSuite(env, store, job, verifier, receipt, handle);
    deps.backgroundFlush();
    return json({ job: { id: jobId, state: terminal }, verification: { mode: "test_suite" } });
  }
  if (job.requester !== handle && !["administrator", "moderator"].includes(actor.role))
    fail(403, "Only the requester or a platform verifier can submit a verdict");
  if (body.accept === true) return settleJob(deps, actor, handle, job, "settled_clean", "verdict:accept");
  return refundJob(deps, actor, handle, job, reason || "rejected", "sla_breach");
}

/** Settle core: escrow -> provider available (price - fee) + platform fee, and a
 *  signed reputation outcome. Money statements carry the pre-state guard and run
 *  BEFORE the state UPDATE, so a replay or lost race writes nothing. Callable by
 *  the request path (verify) and by the cron auto-accept sweep. Returns whether
 *  the transition committed. */
export async function settleCore(
  env: AppEnv,
  store: Store,
  job: JobRow,
  actorLabel: string,
  sig: string | null,
  outcome: string,
  memo: string,
): Promise<{ settled: boolean; price: number; fee: number }> {
  const price = job.price_micros!;
  const fee = feeMicros(price);
  const providerAvail = acct("available", job.provider_operator!);
  const guard = stateGuard(job.id, ["delivered", "disputed"]);
  const eventId = `je_${id()}`;
  const res = await env.DB.batch([
    ensureAccount(env, "available", job.provider_operator!),
    jobEventStatement(env, eventId, job.id, "verdict", actorLabel, { result: "settled", fee: fromMicros(fee) }, sig, guard),
    ...(await postLedger(env, eventId, memo, [
      { account: acct("escrow", job.id), direction: "debit", amount: price, memo: "escrow released" },
      ...(fee > 0 ? [{ account: providerAvail, direction: "credit" as const, amount: price - fee, memo: "earnings" }, { account: "acct_platform_fee", direction: "credit" as const, amount: fee, memo: "network fee" }] : [{ account: providerAvail, direction: "credit" as const, amount: price, memo: "earnings" }]),
    ], guard)),
    reputationOutcomeStatement(env, job, outcome, guard),
    env.DB.prepare(`UPDATE jobs SET state='settled',updated_at=? WHERE id=? AND ${guard.sql} RETURNING id`).bind(now(), job.id, ...guard.binds),
    store.outbox("exchange"),
  ]);
  const settled = (res[res.length - 2].results as unknown[]).length > 0;
  if (settled) await store.event(actorLabel, "settled a job", job.id).run();
  return { settled, price, fee };
}

async function settleJob(deps: ExchangeDeps, actor: Agent, handle: string, job: JobRow, outcome: string, memo: string) {
  const r = await settleCore(deps.env, deps.store, job, handle, request_sig(deps.request), outcome, memo);
  if (!r.settled) fail(409, "Job changed; refresh before settling");
  deps.backgroundFlush();
  return deps.json({ job: { id: job.id, state: "settled" }, settlement: { price: fromMicros(r.price), fee: fromMicros(r.fee), net: fromMicros(r.price - r.fee) } });
}

export async function refundCore(
  env: AppEnv,
  store: Store,
  job: JobRow,
  actorLabel: string,
  sig: string | null,
  reason: string,
  outcome: string,
): Promise<{ refunded: boolean; price: number }> {
  const price = job.price_micros!;
  const requesterAvail = acct("available", job.requester_operator);
  const guard = stateGuard(job.id, ["delivered", "accepted", "disputed"]);
  const eventId = `je_${id()}`;
  const res = await env.DB.batch([
    jobEventStatement(env, eventId, job.id, "verdict", actorLabel, { result: "refunded", reason }, sig, guard),
    ...(await postLedger(env, eventId, `refund:${job.id}`, [
      { account: acct("escrow", job.id), direction: "debit", amount: price, memo: "escrow refunded" },
      { account: requesterAvail, direction: "credit", amount: price, memo: "refund" },
    ], guard)),
    reputationOutcomeStatement(env, job, outcome, guard),
    env.DB.prepare(`UPDATE jobs SET state='refunded',updated_at=? WHERE id=? AND ${guard.sql} RETURNING id`).bind(now(), job.id, ...guard.binds),
    store.outbox("exchange"),
  ]);
  const refunded = (res[res.length - 2].results as unknown[]).length > 0;
  if (refunded) await store.event(actorLabel, "refunded a job", job.id).run();
  return { refunded, price };
}

async function refundJob(deps: ExchangeDeps, actor: Agent, handle: string, job: JobRow, reason: string, outcome: string) {
  const r = await refundCore(deps.env, deps.store, job, handle, request_sig(deps.request), reason, outcome);
  if (!r.refunded) fail(409, "Job changed; refresh before refunding");
  deps.backgroundFlush();
  return deps.json({ job: { id: job.id, state: "refunded", reason }, refund: { price: fromMicros(r.price) } });
}

function reputationOutcomeStatement(env: AppEnv, job: JobRow, outcome: string, guard: Guard) {
  const ts = now();
  return env.DB.prepare(
    `INSERT INTO reputation_outcomes(id,job,node,provider,provider_operator,requester,requester_operator,value_band,outcome,capability_tags,settled_at) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`,
  ).bind(
    `out_${id()}`,
    job.id,
    env.PUBLIC_ORIGIN || "did:web:one.workrr.ai",
    job.provider || "",
    job.provider_operator || "",
    job.requester,
    job.requester_operator,
    valueBand(job.price_micros || 0),
    outcome,
    job.tags || "[]",
    ts,
    ...guard.binds,
  );
}

// --- Disputes ----------------------------------------------------------------

async function openDispute(deps: ExchangeDeps, actor: Agent, handle: string, jobId: string) {
  requireSigned(actor.signingPublicKey);
  const { env, store, json } = deps;
  const job = await getJobRow(env, jobId);
  if (job.state !== "delivered") fail(409, "Only a delivered job (funds still in escrow) can be disputed");
  if (job.requester !== handle && job.provider !== handle) fail(403, "Only a job party can open a dispute");
  const body = await deps.bodyOf(deps.request);
  const reason = text(body.reason, "reason", 2000);
  const verifier = JSON.parse(job.verifier || '{"mode":"requester_review"}');
  const disputeId = `dsp_${id()}`;
  const guard = stateGuard(job.id, ["delivered"]);
  const res = await env.DB.batch([
    env.DB.prepare(`INSERT INTO disputes(id,job,opener,tier,state,reason,created_at) SELECT ?,?,?,1,'open',?,? WHERE ${guard.sql}`).bind(disputeId, job.id, handle, reason, now(), ...guard.binds),
    jobEventStatement(env, `je_${id()}`, job.id, "disputed", handle, { reason }, request_sig(deps.request), guard),
    env.DB.prepare(`UPDATE jobs SET state='disputed',updated_at=? WHERE id=? AND ${guard.sql} RETURNING id`).bind(now(), job.id, ...guard.binds),
    store.outbox("exchange"),
  ]);
  if (!(res[res.length - 2].results as unknown[]).length) fail(409, "Job changed; refresh before disputing");
  await store.event(actor.id, "opened a dispute", job.id).run();
  // Tier 1: re-run the declared verifier if it is deterministic (test_suite).
  if (verifier.mode === "test_suite") {
    const receipt = job.receipt ? JSON.parse(job.receipt) : null;
    const terminal = await verifyTestSuite(env, store, { ...job, state: "disputed" }, verifier, receipt, "moderator");
    await env.DB.prepare("UPDATE disputes SET state='resolved',ruling=?,resolved_at=? WHERE id=?").bind(JSON.stringify({ decision: terminal === "settled" ? "full_release" : "full_refund", resolvedBy: "verifier_rerun" }), now(), disputeId).run();
    deps.backgroundFlush();
    return json({ dispute: { id: disputeId, tier: 1, state: "resolved", resolvedBy: "verifier_rerun" }, job: { id: job.id, state: terminal } });
  }
  // Otherwise escalate to tier 3 (moderator) and wait for a ruling.
  await env.DB.prepare("UPDATE disputes SET tier=3 WHERE id=?").bind(disputeId).run();
  deps.backgroundFlush();
  return json({ dispute: { id: disputeId, tier: 3, state: "open" }, job: { id: job.id, state: "disputed" }, notice: "Escalated to moderator review." }, 201);
}

async function listDisputes(deps: ExchangeDeps, actor: Agent) {
  const { env, json } = deps;
  if (!["administrator", "moderator"].includes(actor.role)) fail(403, "Moderator required");
  const rows = await env.DB.prepare("SELECT * FROM disputes WHERE state='open' ORDER BY created_at DESC LIMIT 100").all<Record<string, any>>();
  return json({ disputes: rows.results.map((r) => ({ id: r.id, job: r.job, opener: r.opener, tier: r.tier, reason: r.reason, createdAt: r.created_at })) });
}

async function resolveDispute(deps: ExchangeDeps, actor: Agent, handle: string, disputeId: string) {
  const { env, store, json } = deps;
  if (!["administrator", "moderator"].includes(actor.role)) fail(403, "Moderator required to resolve disputes");
  const body = await deps.bodyOf(deps.request);
  const decision = choice(body.decision, ["full_release", "full_refund", "split"] as const);
  const dsp = await env.DB.prepare("SELECT * FROM disputes WHERE id=?").bind(disputeId).first<Record<string, any>>();
  if (!dsp) fail(404, "Dispute not found");
  if (dsp.state !== "open") fail(409, "Dispute already resolved");
  const job = await getJobRow(env, dsp.job);
  if (job.state !== "disputed") fail(409, "Job is not disputed");
  let result: Record<string, unknown>;
  if (decision === "full_release") {
    const r = await settleCore(env, store, job, "moderator", null, "settled_disputed", `dispute:${disputeId}:release`);
    if (!r.settled) fail(409, "Job changed; refresh");
    result = { settlement: { net: fromMicros(r.price - r.fee), fee: fromMicros(r.fee) } };
  } else if (decision === "full_refund") {
    const r = await refundCore(env, store, job, "moderator", null, "dispute ruling: refund", "refunded");
    if (!r.refunded) fail(409, "Job changed; refresh");
    const slashed = await slashStake(env, store, job);
    result = { refund: { price: fromMicros(r.price) }, stakeSlashed: fromMicros(slashed) };
  } else {
    const providerBps = Math.max(0, Math.min(10000, Math.floor(Number(body.providerBps)) || 5000));
    result = await resolveSplit(deps, job, disputeId, providerBps);
  }
  await env.DB.prepare("UPDATE disputes SET state='resolved',ruling=?,resolved_at=? WHERE id=? AND state='open'").bind(JSON.stringify({ decision, providerBps: body.providerBps ?? null }), now(), disputeId).run();
  await store.event(actor.id, "resolved a dispute", dsp.job).run();
  deps.backgroundFlush();
  return json({ dispute: { id: disputeId, state: "resolved", decision }, ...result });
}

/** Split ruling: part of escrow to the provider (net of fee), the rest refunded. */
async function resolveSplit(deps: ExchangeDeps, job: JobRow, disputeId: string, providerBps: number) {
  const { env, store } = deps;
  const price = job.price_micros!;
  const providerShare = Math.round((price * providerBps) / 10000);
  const requesterShare = price - providerShare;
  let fee = providerShare > 0 ? feeMicros(providerShare) : 0;
  fee = Math.min(fee, providerShare);
  const providerNet = providerShare - fee;
  const guard = stateGuard(job.id, ["disputed"]);
  const eventId = `je_${id()}`;
  const legs: Leg[] = [{ account: acct("escrow", job.id), direction: "debit", amount: price, memo: "dispute split" }];
  if (providerNet > 0) legs.push({ account: acct("available", job.provider_operator!), direction: "credit", amount: providerNet, memo: "split earnings" });
  if (fee > 0) legs.push({ account: "acct_platform_fee", direction: "credit", amount: fee, memo: "network fee" });
  if (requesterShare > 0) legs.push({ account: acct("available", job.requester_operator), direction: "credit", amount: requesterShare, memo: "split refund" });
  const res = await env.DB.batch([
    ensureAccount(env, "available", job.provider_operator!),
    jobEventStatement(env, eventId, job.id, "resolved", "moderator", { decision: "split", providerBps }, null, guard),
    ...(await postLedger(env, eventId, `dispute:${disputeId}:split`, legs, guard)),
    reputationOutcomeStatement(env, job, "settled_disputed", guard),
    env.DB.prepare(`UPDATE jobs SET state='settled',updated_at=? WHERE id=? AND ${guard.sql} RETURNING id`).bind(now(), job.id, ...guard.binds),
    store.outbox("exchange"),
  ]);
  if (!(res[res.length - 2].results as unknown[]).length) fail(409, "Job changed; refresh");
  return { split: { providerBps, providerNet: fromMicros(providerNet), requesterRefund: fromMicros(requesterShare), fee: fromMicros(fee) } };
}

/** Slash the provider's stake up to the job price, paid to the requester as
 *  compensation (never to the platform, so slashing is never a revenue grab). */
async function slashStake(env: AppEnv, store: Store, job: JobRow): Promise<number> {
  const stakeAcct = acct("stake", job.provider_operator!);
  const stakeBal = await balance(env, stakeAcct);
  const slash = Math.min(stakeBal, job.price_micros!);
  if (slash <= 0) return 0;
  await env.DB.batch([
    ...(await postLedger(env, null, `slash:${job.id}`, [
      { account: stakeAcct, direction: "debit", amount: slash, memo: "stake slashed" },
      { account: acct("available", job.requester_operator), direction: "credit", amount: slash, memo: "dispute compensation" },
    ])),
    store.outbox("exchange"),
  ]);
  return slash;
}

// --- Approvals ---------------------------------------------------------------

async function listApprovals(deps: ExchangeDeps, actor: Agent, handle: string) {
  const { env, url, json } = deps;
  const all = url.searchParams.get("all") === "true" && ["administrator", "moderator"].includes(actor.role);
  const rows = all
    ? await env.DB.prepare("SELECT * FROM approvals WHERE state='pending' ORDER BY created_at DESC LIMIT 100").all<Record<string, any>>()
    : await env.DB.prepare(
        `SELECT a.* FROM approvals a JOIN jobs j ON j.id=a.job
           WHERE a.state='pending' AND j.requester=? ORDER BY a.created_at DESC LIMIT 100`,
      )
        .bind(handle)
        .all<Record<string, any>>();
  return json({
    approvals: rows.results.map((r) => ({
      id: r.id,
      job: r.job,
      kind: r.kind,
      amount: r.amount_micros != null ? fromMicros(r.amount_micros) : null,
      state: r.state,
      createdAt: r.created_at,
    })),
  });
}

async function decideApproval(deps: ExchangeDeps, actor: Agent, handle: string, approvalId: string) {
  const { env, json } = deps;
  requireSigned(actor.signingPublicKey);
  const body = await deps.bodyOf(deps.request);
  const decision = choice(body.decision, ["approved", "rejected"] as const);
  const apr = await env.DB.prepare("SELECT * FROM approvals WHERE id=?")
    .bind(approvalId)
    .first<Record<string, any>>();
  if (!apr) fail(404, "Approval not found");
  if (apr.state !== "pending") fail(409, "Approval already decided");
  const job = await getJobRow(env, apr.job);
  if (job.requester !== handle) fail(403, "Only the requester may decide this approval");
  await env.DB.prepare(
    "UPDATE approvals SET state=?,approver=?,reason=?,decided_at=? WHERE id=? AND state='pending'",
  ).bind(decision, handle, body.reason ? text(body.reason, "reason", 1000) : null, now(), approvalId).run();
  if (decision === "rejected") {
    await env.DB.batch([
      env.DB.prepare("UPDATE jobs SET state='cancelled',updated_at=? WHERE id=? AND state='quoted'").bind(now(), job.id),
      jobEventStatement(env, `je_${id()}`, job.id, "cancelled", handle, { reason: "approval_rejected" }, request_sig(deps.request)),
      deps.store.outbox("exchange"),
    ]);
    deps.backgroundFlush();
    return json({ approval: { id: approvalId, state: "rejected" }, job: { id: job.id, state: "cancelled" } });
  }
  // Approved: fund escrow and move to accepted (reuse the accept path).
  const requesterBinding = await activeBinding(env, handle);
  return acceptNewJob(deps, actor, handle, {
    jobId: job.id,
    capability: job.capability,
    provider: job.provider!,
    providerOperator: job.provider_operator!,
    requesterBinding,
    price: job.price_micros!,
    verification: JSON.parse(job.verifier || '{"mode":"requester_review"}'),
    acceptanceCriteria: job.acceptance_criteria,
    tags: JSON.parse(job.tags || "[]"),
    ts: now(),
    existingJob: true,
    approved: true,
  });
}

// --- Credits (v0.1 faucet) ---------------------------------------------------

async function grantCredits(deps: ExchangeDeps, actor: Agent) {
  const { env, store, json } = deps;
  if (actor.role !== "administrator") fail(403, "Administrator required to grant credits");
  const body = await deps.bodyOf(deps.request);
  const operatorId = text(body.operator, "operator", 60);
  const amount = toMicros(body.amount, "amount");
  const op = await env.DB.prepare("SELECT id FROM operators WHERE id=?").bind(operatorId).first();
  if (!op) fail(404, "Operator not found");
  const statements = [
    ensureAccount(env, "available", operatorId),
    ...(await postLedger(env, null, `grant:${operatorId}`, [
      { account: "acct_platform_onramp", direction: "debit", amount, memo: "credits issued" },
      { account: acct("available", operatorId), direction: "credit", amount, memo: "credit grant" },
    ])),
    store.event(actor.id, "granted WXC credits", operatorId),
  ];
  await store.commit(statements, "exchange");
  deps.backgroundFlush();
  return json({ operator: operatorId, granted: fromMicros(amount), balance: fromMicros(await balance(env, acct("available", operatorId))) }, 201);
}

// --- Reads: jobs, ledger -----------------------------------------------------

export interface JobRow {
  id: string;
  capability: string | null;
  requester: string;
  requester_operator: string;
  provider: string | null;
  provider_operator: string | null;
  state: string;
  price_micros: number | null;
  verifier: string | null;
  acceptance_criteria: string;
  review_window_sec: number | null;
  review_deadline_at: string | null;
  deadline_at: string | null;
  tags: string | null;
  receipt: string | null;
  created_at: string;
  updated_at: string;
}
async function getJobRow(env: AppEnv, jobId: string): Promise<JobRow> {
  const row = await env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(jobId).first<JobRow>();
  if (!row) fail(404, "Job not found");
  return row;
}

async function getJob(deps: ExchangeDeps, actor: Agent, handle: string, jobId: string) {
  const { env, json } = deps;
  const job = await getJobRow(env, jobId);
  const isParty = job.requester === handle || job.provider === handle;
  const isMod = ["administrator", "moderator"].includes(actor.role);
  if (!isParty && !isMod) fail(403, "Only a job party or a platform verifier may read this job");
  const events = await env.DB.prepare(
    "SELECT id,seq,type,actor,payload,sig,created_at FROM job_events WHERE job=? ORDER BY seq ASC",
  )
    .bind(jobId)
    .all<Record<string, any>>();
  return json({ job: shapeJob(job), events: events.results.map((e) => ({ ...e, payload: JSON.parse(e.payload) })) });
}

function shapeJob(job: JobRow) {
  return {
    id: job.id,
    capability: job.capability,
    requester: job.requester,
    provider: job.provider,
    state: job.state,
    price: job.price_micros != null ? fromMicros(job.price_micros) : null,
    verifier: job.verifier ? JSON.parse(job.verifier) : null,
    acceptanceCriteria: job.acceptance_criteria,
    reviewDeadline: job.review_deadline_at,
    deadline: job.deadline_at,
    tags: JSON.parse(job.tags || "[]"),
    receipt: job.receipt ? JSON.parse(job.receipt) : null,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
  };
}

async function listJobs(deps: ExchangeDeps, actor: Agent, handle: string) {
  const { env, url, json } = deps;
  const all = url.searchParams.get("all") === "true" && ["administrator", "moderator"].includes(actor.role);
  const rows = all
    ? await env.DB.prepare("SELECT * FROM jobs ORDER BY rowid DESC LIMIT 100").all<JobRow>()
    : await env.DB.prepare("SELECT * FROM jobs WHERE requester=? OR provider=? ORDER BY rowid DESC LIMIT 100").bind(handle, handle).all<JobRow>();
  return json({ jobs: rows.results.map(shapeJob) });
}

async function ledgerExport(deps: ExchangeDeps, actor: Agent, handle: string, owner: string) {
  const { env, json } = deps;
  // The caller must control the operator whose ledger they read.
  const isMod = ["administrator", "moderator"].includes(actor.role);
  if (!isMod && !(await isOperatorController(env, owner, handle)))
    fail(403, "You can only export ledgers for an operator you control");
  const rows = await env.DB.prepare(
    `SELECT e.id,e.txn,e.account,a.type,e.direction,e.amount_micros,e.memo,e.sig,e.created_at
       FROM ledger_entries e JOIN accounts a ON a.id=e.account
       WHERE a.owner=? ORDER BY e.rowid ASC LIMIT 1000`,
  )
    .bind(owner)
    .all<Record<string, any>>();
  const accounts = await env.DB.prepare("SELECT id,type FROM accounts WHERE owner=?").bind(owner).all<{ id: string; type: string }>();
  const balances: Record<string, string> = {};
  for (const a of accounts.results) balances[a.type] = fromMicros(await balance(env, a.id));
  return json({
    owner,
    balances,
    entries: rows.results.map((r) => ({
      id: r.id,
      txn: r.txn,
      accountType: r.type,
      direction: r.direction,
      amount: fromMicros(r.amount_micros),
      memo: r.memo,
      sig: r.sig,
      at: r.created_at,
    })),
  });
}

async function policyFor(env: AppEnv, bindingId: string) {
  const row = await env.DB.prepare(
    "SELECT spend,earn,counterparties,capabilities,approval,data_handling FROM policies WHERE binding=?",
  )
    .bind(bindingId)
    .first<Record<string, string>>();
  if (!row) fail(404, "Policy not found for binding");
  return {
    spend: JSON.parse(row.spend),
    earn: JSON.parse(row.earn),
    counterparties: JSON.parse(row.counterparties),
    capabilities: JSON.parse(row.capabilities),
    approval: JSON.parse(row.approval),
    dataHandling: JSON.parse(row.data_handling),
  };
}

export const __test = { feeMicros, toMicros, fromMicros, valueBand, WXC };
