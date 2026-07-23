import { Hono } from "hono";
import { executionProfiles, type ExecutionRequest, type QueueJob } from "@workrr/contracts";
import { requireIdentity, requireRoles, requireSameOrigin, type AuthVariables } from "./auth";
import { executeRequest } from "./execution";
import { listBlueprints } from "./repository";
import type { Env } from "./types";

export { ProcessAgent } from "./agent";
export { ProcessWorkflow } from "./workflow";

const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.use("/api/*", requireIdentity);
app.use("/api/*", requireSameOrigin);

app.get("/health", (c) => c.json({ ok: true, service: "workrr-platform", environment: c.env.ENVIRONMENT }));

app.get("/api/session", (c) => c.json({
  user: { id: c.get("actorId"), email: c.get("actorEmail"), name: c.get("actorName"), role: c.get("role") },
  tenantId: c.get("tenantId")
}));

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

app.post("/api/execute", requireRoles("admin", "builder", "owner", "operator", "consumer"), async (c) => {
  const request = await c.req.json<ExecutionRequest>();
  if (!request.blueprintId || !request.input) return c.json({ error: "blueprintId and input are required" }, 400);
  try {
    return c.json(await executeRequest(c.env, c.get("tenantId"), request), 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Execution failed" }, 400);
  }
});

app.post("/api/execute/async", requireRoles("admin", "builder", "owner", "operator", "consumer"), async (c) => {
  const request = await c.req.json<ExecutionRequest>();
  const executionId = crypto.randomUUID();
  const job: QueueJob = { ...request, executionId, attempt: 0 };
  await c.env.PROCESS_QUEUE.send(job, { contentType: "json" });
  return c.json({ executionId, status: "queued" }, 202);
});

app.get("/api/approvals", async (c) => {
  const status = c.req.query("status");
  const filter = status && ["pending", "approved", "rejected", "expired"].includes(status) ? " AND status = ?" : "";
  const statement = c.env.DB.prepare(`SELECT * FROM approvals WHERE tenant_id = ?${filter} ORDER BY requested_at DESC LIMIT 100`);
  const { results } = await (filter ? statement.bind(c.get("tenantId"), status) : statement.bind(c.get("tenantId"))).all();
  return c.json({ data: results });
});

app.get("/api/approvals/:id", async (c) => {
  const [approval, audit] = await Promise.all([
    c.env.DB.prepare(`SELECT a.*, e.blueprint_id, e.input_preview, e.output_preview, e.model
      FROM approvals a JOIN executions e ON e.id = a.execution_id
      WHERE a.id = ? AND a.tenant_id = ?`).bind(c.req.param("id"), c.get("tenantId")).first(),
    c.env.DB.prepare(`SELECT actor_id, event_type, detail_json, created_at FROM audit_events
      WHERE tenant_id = ? AND target_type = 'approval' AND target_id = ? ORDER BY created_at`)
      .bind(c.get("tenantId"), c.req.param("id")).all()
  ]);
  if (!approval) return c.json({ error: "Review item not found" }, 404);
  return c.json({ data: approval, audit: audit.results });
});

app.post("/api/approvals/:id/assign", requireRoles("admin", "owner", "operator", "reviewer"), async (c) => {
  const approvalId = c.req.param("id");
  const body = await c.req.json<{ assignedTo?: string }>();
  if (!approvalId || !body.assignedTo) return c.json({ error: "assignedTo is required" }, 400);
  const result = await c.env.DB.prepare("UPDATE approvals SET assigned_to = ? WHERE id = ? AND tenant_id = ? AND status = 'pending'")
    .bind(body.assignedTo, approvalId, c.get("tenantId")).run();
  if (result.meta.changes === 1) await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "approval.assigned", "approval", approvalId, { assignedTo: body.assignedTo });
  return c.json({ updated: result.meta.changes === 1 });
});

app.get("/api/audit", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, actor_id, event_type, target_type, target_id, detail_json, created_at
    FROM audit_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`)
    .bind(c.get("tenantId")).all();
  return c.json({ data: results });
});

app.post("/api/approvals/:id/:decision", requireRoles("admin", "owner", "reviewer"), async (c) => {
  const approvalId = c.req.param("id");
  const decisionParam = c.req.param("decision");
  if (!approvalId || (decisionParam !== "approved" && decisionParam !== "rejected")) return c.json({ error: "Invalid decision" }, 400);
  const decision: "approved" | "rejected" = decisionParam;
  const body: { note?: string } = await c.req.json<{ note?: string }>().catch(() => ({}));
  const result = await c.env.DB.prepare(`UPDATE approvals SET status = ?, decided_at = ?, decided_by = ?, decision_note = ?
    WHERE id = ? AND tenant_id = ? AND status = 'pending'`)
    .bind(decision, new Date().toISOString(), c.get("actorId"), body.note ?? null, approvalId, c.get("tenantId")).run();
  if (result.meta.changes === 1) {
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), `approval.${decision}`, "approval", approvalId, { decision, note: body.note });
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

async function writeAudit(env: Env, tenantId: string, actorId: string, eventType: string, targetType: string, targetId: string, detail: unknown): Promise<void> {
  await env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, targetType, targetId, JSON.stringify(detail ?? {})).run();
}
