// WXP verification. The verifier is frozen at acceptance and decides when a job
// settles. Four modes (spec §Verification):
//   test_suite       deterministic assertions, checked immediately at delivery
//   evaluator        an evaluator capability scores (1h window)   [v0.1: timeout]
//   requester_review requester accepts/rejects, else auto-accept  (24h)
//   human            a named approver, else auto-accept            (72h)
// The cron sweep auto-accepts delivered jobs past their review window and refunds
// accepted jobs whose provider blew the delivery deadline (SLA breach).
import type { AppEnv } from "./types";
import { Store } from "./store";
import { settleCore, refundCore, type JobRow } from "./exchange";

export interface Assertion {
  path?: string; // dot path into the delivered output JSON, e.g. "rows.deduped"
  op?: "equals" | "gte" | "lte" | "contains" | "exists";
  value?: unknown;
}

function atPath(obj: unknown, path?: string): unknown {
  if (!path) return obj;
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as any)[k] : undefined), obj);
}

/** Evaluate a bounded set of deterministic assertions against the delivered
 *  output. Pure and side-effect free, so a disputer can re-run it identically. */
export function runTestSuite(assertions: Assertion[], output: unknown): { pass: boolean; failures: string[] } {
  const failures: string[] = [];
  for (const a of assertions.slice(0, 50)) {
    const actual = atPath(output, a.path);
    const label = `${a.path ?? "$"} ${a.op ?? "equals"} ${JSON.stringify(a.value)}`;
    let ok = false;
    switch (a.op) {
      case "exists": ok = actual !== undefined && actual !== null; break;
      case "gte": ok = typeof actual === "number" && actual >= Number(a.value); break;
      case "lte": ok = typeof actual === "number" && actual <= Number(a.value); break;
      case "contains": ok = Array.isArray(actual) ? actual.includes(a.value) : String(actual ?? "").includes(String(a.value)); break;
      case "equals":
      default: ok = JSON.stringify(actual) === JSON.stringify(a.value); break;
    }
    if (!ok) failures.push(`${label} (actual ${JSON.stringify(actual)})`);
  }
  return { pass: failures.length === 0, failures };
}

/** Run a frozen test_suite verifier against a receipt and settle or refund the
 *  job accordingly (immediate, no review window). Returns the terminal state. */
export async function verifyTestSuite(
  env: AppEnv,
  store: Store,
  job: JobRow,
  verifier: { assertions?: Assertion[] },
  receipt: { output?: unknown } | null,
  actorLabel = "system",
): Promise<"settled" | "refunded"> {
  const result = runTestSuite(verifier.assertions ?? [], receipt?.output);
  if (result.pass) {
    await settleCore(env, store, job, actorLabel, null, "settled_clean", "test_suite:pass");
    return "settled";
  }
  await refundCore(env, store, job, actorLabel, null, `test_suite failed: ${result.failures.join("; ").slice(0, 400)}`, "sla_breach");
  return "refunded";
}

/** Scheduled sweep: auto-accept review timeouts and refund delivery-deadline
 *  (SLA) breaches. Idempotent — the core transitions are state-guarded. */
export async function sweepJobTimeouts(env: AppEnv, store: Store): Promise<{ settled: number; refunded: number }> {
  const nowIso = new Date().toISOString();
  let settled = 0;
  let refunded = 0;
  const delivered = await env.DB.prepare(
    "SELECT * FROM jobs WHERE state='delivered' AND review_deadline_at IS NOT NULL AND review_deadline_at<=? ORDER BY rowid ASC LIMIT 100",
  )
    .bind(nowIso)
    .all<JobRow>();
  for (const job of delivered.results) {
    const r = await settleCore(env, store, job, "system", null, "settled_clean", "auto-accept:review-timeout");
    if (r.settled) settled++;
  }
  const stale = await env.DB.prepare(
    "SELECT * FROM jobs WHERE state='accepted' AND deadline_at IS NOT NULL AND deadline_at<=? ORDER BY rowid ASC LIMIT 100",
  )
    .bind(nowIso)
    .all<JobRow>();
  for (const job of stale.results) {
    const r = await refundCore(env, store, job, "system", null, "delivery deadline passed", "sla_breach");
    if (r.refunded) refunded++;
  }
  return { settled, refunded };
}
