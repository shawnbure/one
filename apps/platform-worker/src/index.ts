import { Hono } from "hono";
import { cors } from "hono/cors";
import { executionProfiles, type ExecutionRequest, type QueueJob } from "@workrr/contracts";
import { executeRequest } from "./execution";
import { listBlueprints } from "./repository";
import type { Env } from "./types";

export { ProcessAgent } from "./agent";
export { ProcessWorkflow } from "./workflow";

type Variables = { tenantId: string; actorId: string; role: "admin" | "operator" | "reviewer" | "viewer" };
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("/api/*", cors({ origin: (origin) => origin, allowHeaders: ["content-type", "x-workrr-tenant", "x-workrr-user", "x-workrr-role"] }));
app.use("/api/*", async (c, next) => {
  const tenantId = c.req.header("x-workrr-tenant") ?? (c.env.ENVIRONMENT === "development" ? "demo" : null);
  const actorId = c.req.header("x-workrr-user") ?? (c.env.ENVIRONMENT === "development" ? "local-admin" : null);
  const role = c.req.header("x-workrr-role") ?? (c.env.ENVIRONMENT === "development" ? "admin" : null);
  if (!tenantId || !actorId || !role || !["admin", "operator", "reviewer", "viewer"].includes(role)) {
    return c.json({ error: "Authenticated tenant context is required" }, 401);
  }
  c.set("tenantId", tenantId);
  c.set("actorId", actorId);
  c.set("role", role as Variables["role"]);
  await next();
});

app.get("/health", (c) => c.json({ ok: true, service: "workrr-platform", environment: c.env.ENVIRONMENT }));

app.get("/api/processes", async (c) => c.json({ data: await listBlueprints(c.env, c.get("tenantId")) }));

app.get("/api/overview", async (c) => {
  const tenantId = c.get("tenantId");
  const [processes, runs, processRuns, approvals] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) count FROM agent_blueprints WHERE tenant_id = ? AND status = 'active'").bind(tenantId).first<{ count: number }>(),
    c.env.DB.prepare("SELECT status, COUNT(*) count FROM executions WHERE tenant_id = ? AND started_at >= datetime('now','-7 days') GROUP BY status").bind(tenantId).all(),
    c.env.DB.prepare("SELECT blueprint_id, COUNT(*) count FROM executions WHERE tenant_id = ? AND started_at >= datetime('now','-7 days') GROUP BY blueprint_id").bind(tenantId).all<{ blueprint_id: string; count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) count FROM approvals WHERE tenant_id = ? AND status = 'pending'").bind(tenantId).first<{ count: number }>()
  ]);
  const byStatus = Object.fromEntries(runs.results.map((row) => [String(row.status), Number(row.count)]));
  const processRunCounts = Object.fromEntries(processRuns.results.map((row) => [row.blueprint_id, Number(row.count)]));
  return c.json({
    activeProcesses: processes?.count ?? 0,
    pendingApprovals: approvals?.count ?? 0,
    runs7d: Object.values(byStatus).reduce((total, count) => total + count, 0),
    completed7d: byStatus.completed ?? 0,
    failed7d: byStatus.failed ?? 0,
    processRuns: processRunCounts
  });
});

app.get("/api/executions", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, blueprint_id, instance_key, execution_profile, status,
    input_preview, output_preview, model, started_at, completed_at, error
    FROM executions WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 100`).bind(c.get("tenantId")).all();
  return c.json({ data: results });
});

app.post("/api/execute", async (c) => {
  if (c.get("role") === "viewer") return c.json({ error: "Viewer role cannot run processes" }, 403);
  const request = await c.req.json<ExecutionRequest>();
  if (!request.blueprintId || !request.input) return c.json({ error: "blueprintId and input are required" }, 400);
  try {
    return c.json(await executeRequest(c.env, c.get("tenantId"), request), 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Execution failed" }, 400);
  }
});

app.post("/api/execute/async", async (c) => {
  if (c.get("role") === "viewer") return c.json({ error: "Viewer role cannot run processes" }, 403);
  const request = await c.req.json<ExecutionRequest>();
  const executionId = crypto.randomUUID();
  const job: QueueJob = { ...request, executionId, attempt: 0 };
  await c.env.PROCESS_QUEUE.send(job, { contentType: "json" });
  return c.json({ executionId, status: "queued" }, 202);
});

app.get("/api/approvals", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM approvals WHERE tenant_id = ? ORDER BY requested_at DESC LIMIT 100")
    .bind(c.get("tenantId")).all();
  return c.json({ data: results });
});

app.post("/api/approvals/:id/:decision", async (c) => {
  if (!['admin', 'reviewer'].includes(c.get("role"))) return c.json({ error: "Reviewer role is required" }, 403);
  const decision = c.req.param("decision");
  if (!['approved', 'rejected'].includes(decision)) return c.json({ error: "Invalid decision" }, 400);
  const result = await c.env.DB.prepare(`UPDATE approvals SET status = ?, decided_at = ?, decided_by = ?
    WHERE id = ? AND tenant_id = ? AND status = 'pending'`)
    .bind(decision, new Date().toISOString(), c.get("actorId"), c.req.param("id"), c.get("tenantId")).run();
  if (result.meta.changes === 1) {
    await c.env.DB.prepare(`INSERT INTO audit_events
      (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
      VALUES (?, ?, ?, ?, 'approval', ?, ?)`)
      .bind(crypto.randomUUID(), c.get("tenantId"), c.get("actorId"), `approval.${decision}`, c.req.param("id"), JSON.stringify({ decision })).run();
  }
  return c.json({ updated: result.meta.changes === 1 });
});

app.get("/api/system/capabilities", (c) => c.json({
  executionProfiles,
  primitives: ["Workers", "Agents SDK", "Durable Objects", "D1", "Workers AI", "Queues", "Workflows", "Cron"],
  promptCache: "Agent-local SQLite plus Workers AI session affinity",
  gateway: "planned"
}));

const handler: ExportedHandler<Env, QueueJob> = {
  fetch: app.fetch,
  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await executeRequest(env, "demo", message.body, message.body.executionId);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ event: "queue_job_failed", executionId: message.body.executionId, error: String(error) }));
        message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
      }
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(env.DB.prepare(`INSERT INTO audit_events
      (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
      VALUES (?, 'demo', 'system', 'maintenance.tick', 'platform', 'workrr', ?)`)
      .bind(crypto.randomUUID(), JSON.stringify({ at: new Date().toISOString() })).run());
  }
};

export default handler;
