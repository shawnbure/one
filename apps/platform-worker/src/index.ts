import { Hono } from "hono";
import { executionProfiles, type ExecutionRequest, type QueueJob } from "@workrr/contracts";
import { requireIdentity, requireRoles, requireSameOrigin, type AuthVariables } from "./auth";
import { executeRequest } from "./execution";
import { listBlueprints } from "./repository";
import type { Env } from "./types";
import { createDraftRelease, getStudio, publishRelease } from "./studio";
import { getGovernance } from "./governance";
import { receiveWebhook } from "./webhook";
import { createProcessFromTemplate, getValueDashboard } from "./discovery";
import { applyOnboarding, exportCustomerManifest, getOnboarding } from "./onboarding";
import { emitNotification } from "./notifications";
import { exportProcessPackage, importProcessPackage } from "./process-package";
import { runEvaluation } from "./evaluation";

export { ProcessAgent } from "./agent";
export { ProcessWorkflow } from "./workflow";

export const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.post("/webhooks/:endpointId", receiveWebhook);
app.use("/api/*", requireIdentity);
app.use("/api/*", requireSameOrigin);
app.use("/api/*", async (c, next) => {
  const started = performance.now();
  const traceId = c.req.header("cf-ray") ?? crypto.randomUUID();
  c.header("x-workrr-trace-id", traceId);
  await next();
  c.executionCtx.waitUntil(c.env.DB.prepare(`INSERT INTO api_logs
    (id, tenant_id, actor_id, trace_id, direction, method, path, status, duration_ms)
    VALUES (?, ?, ?, ?, 'inbound', ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), c.get("tenantId"), c.get("actorId"), traceId, c.req.method, new URL(c.req.url).pathname, c.res.status, Math.round(performance.now() - started)).run());
});

app.get("/health", (c) => c.json({ ok: true, service: "workrr-platform", environment: c.env.ENVIRONMENT }));

app.get("/api/session", async (c) => {
  const tenant = await c.env.DB.prepare(`SELECT t.name, s.accent_color FROM tenants t LEFT JOIN tenant_settings s ON s.tenant_id = t.id
    WHERE t.id = ?`).bind(c.get("tenantId")).first<{ name: string; accent_color: string | null }>();
  return c.json({
    user: { id: c.get("actorId"), email: c.get("actorEmail"), name: c.get("actorName"), role: c.get("role") },
    tenantId: c.get("tenantId"), tenantName: tenant?.name ?? c.get("tenantId"), accentColor: tenant?.accent_color ?? "#1f7a5b"
  });
});

app.get("/api/onboarding", requireRoles("admin", "owner", "viewer"), async (c) =>
  c.json({ data: await getOnboarding(c.env, c.get("tenantId")) }));

app.put("/api/onboarding", requireRoles("admin"), async (c) => {
  try {
    const data = await applyOnboarding(c.env, c.get("tenantId"), c.get("actorId"), await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "tenant.onboarding.updated", "tenant", c.get("tenantId"), { settings: data.settings });
    return c.json({ data });
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Onboarding update failed" }, 400); }
});

app.get("/api/onboarding/export", requireRoles("admin", "owner"), async (c) => {
  c.header("content-disposition", `attachment; filename="workrr-customer-manifest-${c.get("tenantId")}.json"`);
  c.header("cache-control", "no-store");
  return c.json(await exportCustomerManifest(c.env, c.get("tenantId")));
});

app.get("/api/notifications", requireRoles("admin", "owner", "operator", "viewer"), async (c) => {
  const [policies, events] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM notification_policies WHERE tenant_id = ? ORDER BY event_type, channel").bind(c.get("tenantId")).all(),
    c.env.DB.prepare("SELECT * FROM notification_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100").bind(c.get("tenantId")).all()
  ]);
  return c.json({ data: { policies: policies.results, events: events.results } });
});

app.patch("/api/notifications/policies/:id", requireRoles("admin", "owner"), async (c) => {
  const policyId = c.req.param("id");
  if (!policyId) return c.json({ error: "Notification policy ID is required" }, 400);
  const body = await c.req.json<{ enabled?: boolean; destination?: string | null }>();
  const result = await c.env.DB.prepare(`UPDATE notification_policies SET enabled = COALESCE(?, enabled), destination = COALESCE(?, destination),
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`)
    .bind(typeof body.enabled === "boolean" ? Number(body.enabled) : null, body.destination ?? null, policyId, c.get("tenantId")).run();
  if (result.meta.changes) await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "notification_policy.updated", "notification_policy", policyId, body);
  return c.json({ updated: result.meta.changes === 1 });
});

app.get("/api/members", requireRoles("admin", "owner", "viewer"), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, email, display_name, role, status, created_at, last_seen_at
    FROM tenant_members WHERE tenant_id = ? ORDER BY display_name`).bind(c.get("tenantId")).all();
  return c.json({ data: results });
});

app.post("/api/members", requireRoles("admin"), async (c) => {
  const body = await c.req.json<{ email?: string; name?: string; role?: string }>();
  const validRoles = ["admin", "builder", "owner", "operator", "reviewer", "viewer", "consumer"];
  if (!body.email || !body.name || !body.role || !validRoles.includes(body.role)) return c.json({ error: "Name, email, and a valid role are required" }, 400);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(`INSERT INTO tenant_members (id, tenant_id, email, display_name, role) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, c.get("tenantId"), body.email.trim().toLowerCase(), body.name.trim(), body.role).run();
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "member.created", "member", id, { email: body.email, role: body.role });
    return c.json({ id, status: "active" }, 201);
  } catch (error) { return c.json({ error: String(error).includes("UNIQUE") ? "That email is already a member" : "Member creation failed" }, 409); }
});

app.patch("/api/members/:id", requireRoles("admin"), async (c) => {
  const memberId = c.req.param("id");
  const body = await c.req.json<{ role?: string; status?: string }>();
  const validRoles = ["admin", "builder", "owner", "operator", "reviewer", "viewer", "consumer"];
  if (!memberId || (body.role && !validRoles.includes(body.role)) || (body.status && !["active", "suspended"].includes(body.status))) return c.json({ error: "Invalid membership update" }, 400);
  if (memberId === c.get("actorId") && body.status === "suspended") return c.json({ error: "You cannot suspend your own membership" }, 409);
  const result = await c.env.DB.prepare(`UPDATE tenant_members SET role = COALESCE(?, role), status = COALESCE(?, status)
    WHERE id = ? AND tenant_id = ?`).bind(body.role ?? null, body.status ?? null, memberId, c.get("tenantId")).run();
  if (result.meta.changes === 1) await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "member.updated", "member", memberId, body);
  return c.json({ updated: result.meta.changes === 1 });
});

app.get("/api/processes", async (c) => c.json({ data: await listBlueprints(c.env, c.get("tenantId")) }));

app.get("/api/process-templates", requireRoles("admin", "builder", "owner"), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, name, description, execution_profile, model_profile, autonomy,
    tools_json, category FROM process_templates ORDER BY category, name`).all();
  return c.json({ data: results });
});

app.post("/api/processes", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    const result = await createProcessFromTemplate(c.env, c.get("tenantId"), c.get("actorId"), await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "process.created", "process", result.id, result);
    return c.json(result, 201);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Process creation failed" }, 400); }
});

app.get("/api/processes/:id/package", requireRoles("admin", "builder", "owner", "viewer"), async (c) => {
  const processId = c.req.param("id");
  if (!processId) return c.json({ error: "Process ID is required" }, 400);
  const pkg = await exportProcessPackage(c.env, c.get("tenantId"), processId);
  if (!pkg) return c.json({ error: "A published process release is required for export" }, 404);
  c.header("content-disposition", `attachment; filename="workrr-process-${processId}.json"`);
  c.header("cache-control", "no-store");
  return c.json(pkg);
});

app.post("/api/process-packages/import", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    const result = await importProcessPackage(c.env, c.get("tenantId"), c.get("actorId"), await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "process_package.imported", "process", result.id, { source: result.source, releaseId: result.release.releaseId });
    return c.json({ data: result }, 201);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Process package import failed" }, 400); }
});

app.get("/api/value", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) =>
  c.json({ data: await getValueDashboard(c.env, c.get("tenantId")) }));

app.get("/api/processes/:id/studio", async (c) => {
  const studio = await getStudio(c.env, c.get("tenantId"), c.req.param("id"));
  return studio ? c.json({ data: studio }) : c.json({ error: "Process not found" }, 404);
});

app.post("/api/processes/:id/releases", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    const processId = c.req.param("id");
    if (!processId) return c.json({ error: "Process ID is required" }, 400);
    const result = await createDraftRelease(c.env, c.get("tenantId"), processId, c.get("actorId"), await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "process_release.created", "process", processId, result);
    return c.json(result, 201);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Release creation failed" }, 400); }
});

app.post("/api/processes/:id/releases/:releaseId/publish", requireRoles("admin", "owner"), async (c) => {
  try {
    const processId = c.req.param("id");
    const releaseId = c.req.param("releaseId");
    if (!processId || !releaseId) return c.json({ error: "Process and release IDs are required" }, 400);
    const result = await publishRelease(c.env, c.get("tenantId"), processId, releaseId, c.get("actorId"));
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "process_release.published", "process", processId, result);
    return c.json(result);
  } catch (error) { return c.json({ error: error instanceof Error ? error.message : "Release publication failed" }, 400); }
});

app.get("/api/overview", async (c) => {
  const tenantId = c.get("tenantId");
  const [processes, runs, processRuns, approvals, usage] = await Promise.all([
    c.env.DB.prepare("SELECT COUNT(*) count FROM agent_blueprints WHERE tenant_id = ? AND status = 'active'").bind(tenantId).first<{ count: number }>(),
    c.env.DB.prepare("SELECT status, COUNT(*) count FROM executions WHERE tenant_id = ? AND started_at >= datetime('now','-7 days') GROUP BY status").bind(tenantId).all(),
    c.env.DB.prepare("SELECT blueprint_id, COUNT(*) count FROM executions WHERE tenant_id = ? AND started_at >= datetime('now','-7 days') GROUP BY blueprint_id").bind(tenantId).all<{ blueprint_id: string; count: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) count FROM approvals WHERE tenant_id = ? AND status = 'pending'").bind(tenantId).first<{ count: number }>(),
    c.env.DB.prepare(`SELECT COALESCE(SUM(input_tokens),0) input_tokens, COALESCE(SUM(output_tokens),0) output_tokens,
      COALESCE(SUM(total_tokens),0) total_tokens FROM executions WHERE tenant_id = ? AND started_at >= datetime('now','-7 days')`)
      .bind(tenantId).first<{ input_tokens: number; output_tokens: number; total_tokens: number }>()
  ]);
  const byStatus = Object.fromEntries(runs.results.map((row) => [String(row.status), Number(row.count)]));
  const processRunCounts = Object.fromEntries(processRuns.results.map((row) => [row.blueprint_id, Number(row.count)]));
  return c.json({
    activeProcesses: processes?.count ?? 0,
    pendingApprovals: approvals?.count ?? 0,
    runs7d: Object.values(byStatus).reduce((total, count) => total + count, 0),
    completed7d: byStatus.completed ?? 0,
    failed7d: byStatus.failed ?? 0,
    processRuns: processRunCounts,
    usage7d: usage ?? { input_tokens: 0, output_tokens: 0, total_tokens: 0 }
  });
});

app.get("/api/executions", async (c) => {
  const status = c.req.query("status");
  const blueprintId = c.req.query("process");
  const filters: string[] = ["tenant_id = ?"];
  const bindings: string[] = [c.get("tenantId")];
  if (status) { filters.push("status = ?"); bindings.push(status); }
  if (blueprintId) { filters.push("blueprint_id = ?"); bindings.push(blueprintId); }
  const { results } = await c.env.DB.prepare(`SELECT id, blueprint_id, instance_key, execution_profile, status,
    input_preview, output_preview, model, input_tokens, output_tokens, total_tokens, started_at, completed_at, error
    FROM executions WHERE ${filters.join(" AND ")} ORDER BY started_at DESC LIMIT 100`).bind(...bindings).all();
  return c.json({ data: results });
});

app.get("/api/executions/:id", async (c) => {
  const executionId = c.req.param("id");
  const execution = await c.env.DB.prepare(`SELECT e.*, b.name blueprint_name, b.autonomy, b.prompt_release_id
    FROM executions e JOIN agent_blueprints b ON b.id = e.blueprint_id
    WHERE e.id = ? AND e.tenant_id = ?`).bind(executionId, c.get("tenantId")).first();
  if (!execution) return c.json({ error: "Execution not found" }, 404);
  const [approvals, audit] = await Promise.all([
    c.env.DB.prepare("SELECT * FROM approvals WHERE tenant_id = ? AND execution_id = ? ORDER BY requested_at")
      .bind(c.get("tenantId"), executionId).all(),
    c.env.DB.prepare(`SELECT actor_id, event_type, target_type, target_id, detail_json, created_at FROM audit_events
      WHERE tenant_id = ? AND ((target_type = 'execution' AND target_id = ?) OR
      (target_type = 'approval' AND target_id IN (SELECT id FROM approvals WHERE execution_id = ?))) ORDER BY created_at`)
      .bind(c.get("tenantId"), executionId, executionId).all()
  ]);
  return c.json({ data: execution, approvals: approvals.results, audit: audit.results });
});

app.post("/api/executions/:id/retry", requireRoles("admin", "builder", "owner", "operator"), async (c) => {
  const sourceId = c.req.param("id");
  const source = await c.env.DB.prepare(`SELECT blueprint_id, execution_profile, instance_key, input_preview
    FROM executions WHERE id = ? AND tenant_id = ?`).bind(sourceId, c.get("tenantId")).first<{
      blueprint_id: string; execution_profile: string; instance_key: string | null; input_preview: string;
    }>();
  if (!source) return c.json({ error: "Execution not found" }, 404);
  const request = replayRequest(source);
  const result = await executeRequest(c.env, c.get("tenantId"), request);
  await c.env.DB.prepare("UPDATE executions SET retry_of = ? WHERE id = ?").bind(sourceId, result.executionId).run();
  await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "execution.retried", "execution", result.executionId, { sourceExecutionId: sourceId });
  return c.json(result, 202);
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
  const job: QueueJob = { ...request, executionId, attempt: 0, tenantId: c.get("tenantId") };
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

app.get("/api/governance", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) =>
  c.json({ data: await getGovernance(c.env, c.get("tenantId")) }));

app.get("/api/governance/export", requireRoles("admin", "owner", "viewer"), async (c) => {
  const governance = await getGovernance(c.env, c.get("tenantId"));
  c.header("content-disposition", `attachment; filename="workrr-deployment-readiness-${new Date().toISOString().slice(0, 10)}.json"`);
  c.header("cache-control", "no-store");
  return c.json({
    generatedAt: new Date().toISOString(), tenantId: c.get("tenantId"), generatedBy: c.get("actorEmail"),
    platform: "Workrr One on Cloudflare",
    privacyPosture: "Customer-dedicated Cloudflare deployment; Workers AI default; no hidden external model calls",
    ...governance
  });
});

app.post("/api/evaluations/:id/run", requireRoles("admin", "builder", "owner", "operator"), async (c) => {
  const scenarioId = c.req.param("id");
  if (!scenarioId) return c.json({ error: "Evaluation scenario ID is required" }, 400);
  const body: { releaseId?: string } = await c.req.json<{ releaseId?: string }>().catch(() => ({}));
  try { return c.json({ data: await runEvaluation(c.env, c.get("tenantId"), c.get("actorId"), scenarioId, body.releaseId) }); }
  catch (error) { return c.json({ error: error instanceof Error ? error.message : "Evaluation failed" }, 404); }
});

app.get("/api/logs", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, trace_id, direction, method, path, status, duration_ms, target, actor_id, created_at
    FROM api_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`).bind(c.get("tenantId")).all();
  return c.json({ data: results });
});

app.get("/api/webhooks", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, name, blueprint_id, status, accepted_events_json, created_at, last_received_at,
    CASE WHEN secret_binding = 'WEBHOOK_INBOX_SECRET' THEN ? ELSE 0 END secret_configured
    FROM webhook_endpoints WHERE tenant_id = ? ORDER BY name`).bind(c.env.WEBHOOK_INBOX_SECRET ? 1 : 0, c.get("tenantId")).all();
  return c.json({ data: results });
});

app.post("/api/connections/:id/test", requireRoles("admin", "builder", "owner", "operator"), async (c) => {
  const tenantId = c.get("tenantId");
  const connection = await c.env.DB.prepare("SELECT * FROM connections WHERE id = ? AND tenant_id = ?")
    .bind(c.req.param("id"), tenantId).first<Record<string, string | number | null>>();
  if (!connection) return c.json({ error: "Connection not found" }, 404);

  const isWorkersAI = connection.kind === "model_provider" && connection.name === "Cloudflare Workers AI";
  const configured = isWorkersAI || Number(connection.secret_configured) === 1;
  const status = isWorkersAI ? "healthy" : configured ? "attention" : "disconnected";
  const detail = isWorkersAI
    ? "Workers AI binding is configured. No model tokens were consumed by this check."
    : configured
      ? "Credential metadata exists; a connector-specific live probe is still required."
      : "Connector credential is not configured.";
  await c.env.DB.prepare("UPDATE connections SET status = ?, last_checked_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?")
    .bind(status, connection.id, tenantId).run();
  await writeAudit(c.env, tenantId, c.get("actorId"), "connection.checked", "connection", String(connection.id), { status, detail });
  return c.json({ data: { id: connection.id, status, detail, checkedAt: new Date().toISOString() } });
});

app.patch("/api/webhooks/:id/status", requireRoles("admin", "builder"), async (c) => {
  const webhookId = c.req.param("id");
  const body = await c.req.json<{ status?: "active" | "disabled" }>();
  if (!webhookId || !body.status || !["active", "disabled"].includes(body.status)) return c.json({ error: "Valid status is required" }, 400);
  if (body.status === "active" && !c.env.WEBHOOK_INBOX_SECRET) return c.json({ error: "Configure WEBHOOK_INBOX_SECRET before activating this endpoint" }, 409);
  const result = await c.env.DB.prepare("UPDATE webhook_endpoints SET status = ? WHERE id = ? AND tenant_id = ?")
    .bind(body.status, webhookId, c.get("tenantId")).run();
  if (result.meta.changes === 1) await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "webhook.status_changed", "webhook", webhookId, body);
  return c.json({ updated: result.meta.changes === 1, status: body.status });
});

app.patch("/api/processes/:id/mode", requireRoles("admin", "owner"), async (c) => {
  const processId = c.req.param("id");
  const body = await c.req.json<{ mode?: string; reason?: string }>();
  const modes = ["active", "read_only", "approval_only", "paused", "drain", "emergency_stop"];
  if (!processId || !body.mode || !modes.includes(body.mode)) return c.json({ error: "A valid operating mode is required" }, 400);
  const result = await c.env.DB.prepare("UPDATE agent_blueprints SET operating_mode = ?, updated_at = ? WHERE tenant_id = ? AND id = ?")
    .bind(body.mode, new Date().toISOString(), c.get("tenantId"), processId).run();
  if (result.meta.changes === 1) await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "process.mode_changed", "process", processId, { mode: body.mode, reason: body.reason });
  return c.json({ updated: result.meta.changes === 1, mode: body.mode });
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
        await executeRequest(env, message.body.tenantId ?? "demo", message.body, message.body.executionId);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ event: "queue_job_failed", executionId: message.body.executionId, error: String(error) }));
        const terminal = message.attempts >= 5;
        await env.DB.prepare("UPDATE executions SET status = ?, error = ?, completed_at = ? WHERE id = ? AND tenant_id = ?")
          .bind(terminal ? "failed" : "queued", error instanceof Error ? error.message : String(error), terminal ? new Date().toISOString() : null,
            message.body.executionId, message.body.tenantId ?? "demo").run();
        if (terminal) await emitNotification(env, message.body.tenantId ?? "demo", {
          eventType: "queue.retry_exhausted", title: "Process job exhausted retries",
          detail: error instanceof Error ? error.message : String(error), targetType: "execution", targetId: message.body.executionId
        });
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

function replayRequest(source: { blueprint_id: string; execution_profile: string; instance_key: string | null; input_preview: string }): ExecutionRequest {
  const request: ExecutionRequest = { blueprintId: source.blueprint_id, input: source.input_preview };
  const key = source.instance_key ?? "";
  if (source.execution_profile === "conversation") request.threadId = key.split(":thread:")[1];
  if (source.execution_profile === "consumer") request.consumerId = key.split(":consumer:")[1];
  if (source.execution_profile === "entity") request.entityId = key.split(":entity:")[1];
  if (source.execution_profile === "shared_shard") request.shardKey = key.split(":shard:")[1];
  if (source.execution_profile === "temporary_durable") request.idempotencyKey = crypto.randomUUID();
  return request;
}
