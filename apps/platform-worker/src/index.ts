import { Hono } from "hono";
import { executionProfiles, type ExecutionRequest, type QueueJob, type WorkrrQueueJob } from "@workrr/contracts";
import { requireIdentity, requireRoles, requireSameOrigin, type AuthVariables } from "./auth";
import { assertAsyncExecutionAdmission, executeRequest, sanitizeAsyncExecutionInput } from "./execution";
import { listBlueprints } from "./repository";
import type { Env } from "./types";
import { createDraftRelease, getStudio, publishRelease } from "./studio";
import { getGovernance } from "./governance";
import { receiveWebhook } from "./webhook";
import { createProcessFromTemplate, getValueDashboard } from "./discovery";
import { applyOnboarding, bootstrapCustomer, BootstrapConflict, exportAccessHandoff, exportCustomerManifest, getOnboarding } from "./onboarding";
import { deliverNotificationWebhook, emitNotification, failNotificationDelivery, safeWebhookDestination } from "./notifications";
import { exportProcessPackage, importProcessPackage } from "./process-package";
import { createEvaluationCase, createRubricTemplate, exportEvaluationDataset, exportRubricPackage, getEvaluationDetail, importEvaluationDataset, importRubricPackage, listRubricTemplates, promoteExecutionSample, queueEvaluationSuite, queueModelTrial, reviewEvaluationResult, runEvaluation, updateRubricTemplate } from "./evaluation";
import { getUsageLedger } from "./usage";
import { createIncident, getIncidentDetail, getIncidentOperations, setProcessOperatingMode, setTenantOperatingMode, transitionIncident } from "./incidents";
import { checkMicrosoftConnection, completeMicrosoftOAuth, disconnectMicrosoft, startMicrosoftOAuth } from "./oauth";
import { isDlpBlocked, updateDlpRule } from "./dlp";

export { ProcessAgent } from "./agent";
export { ProcessWorkflow } from "./workflow";
export { EvaluationWorkflow } from "./evaluation-workflow";

export const app = new Hono<{ Bindings: Env; Variables: AuthVariables }>();

app.post("/webhooks/:endpointId", receiveWebhook);
app.get("/oauth/microsoft/callback", async (c) => {
  const url = new URL(c.req.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const providerError = url.searchParams.get("error");
  try {
    if (providerError) throw new Error("Microsoft authorization was declined or could not be completed");
    await completeMicrosoftOAuth(c.env, state, code);
    return c.redirect(`https://${c.env.APP_DOMAIN}/?oauth=microsoft-connected`);
  } catch (error) {
    console.error(JSON.stringify({ event: "microsoft_oauth_callback_failed",
      error: error instanceof Error ? error.message : String(error) }));
    return c.redirect(`https://${c.env.APP_DOMAIN}/?oauth=microsoft-error`);
  }
});
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

app.post("/api/onboarding/bootstrap", requireRoles("admin"), async (c) => {
  try {
    const data = await bootstrapCustomer(c.env, c.get("tenantId"), c.get("actorId"), await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "tenant.bootstrap.completed", "tenant", c.get("tenantId"), {
      status: data.launch.status, processId: data.launch.processId, memberId: data.launch.memberId,
      alreadyCompleted: data.launch.alreadyCompleted
    });
    return c.json({ data }, data.launch.alreadyCompleted ? 200 : 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Customer bootstrap failed" },
      error instanceof BootstrapConflict ? 409 : 400);
  }
});

app.get("/api/onboarding/export", requireRoles("admin", "owner"), async (c) => {
  c.header("content-disposition", `attachment; filename="workrr-customer-manifest-${c.get("tenantId")}.json"`);
  c.header("cache-control", "no-store");
  return c.json(await exportCustomerManifest(c.env, c.get("tenantId")));
});

app.get("/api/onboarding/access-handoff", requireRoles("admin", "owner"), async (c) => {
  c.header("content-disposition", `attachment; filename="workrr-access-handoff-${c.env.ENVIRONMENT}.json"`);
  c.header("cache-control", "no-store");
  return c.json(await exportAccessHandoff(c.env, c.get("tenantId")));
});

app.post("/api/oauth/microsoft/start", requireRoles("admin", "owner"), async (c) => {
  try {
    const body = await c.req.json<{ capabilities?: string[] }>();
    const data = await startMicrosoftOAuth(c.env, c.get("tenantId"), c.get("actorId"), body.capabilities ?? []);
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "connection.oauth_started", "connection",
      "microsoft", { capabilities: data.capabilities, expiresAt: data.expiresAt });
    return c.json({ data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Microsoft authorization could not start";
    return c.json({ error: message }, message.includes("not configured") ? 503 : 400);
  }
});

app.post("/api/oauth/microsoft/disconnect", requireRoles("admin", "owner"), async (c) => {
  try {
    return c.json({ data: await disconnectMicrosoft(c.env, c.get("tenantId"), c.get("actorId")) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Microsoft connection could not be disconnected" }, 400);
  }
});

app.get("/api/notifications", requireRoles("admin", "owner", "operator", "viewer"), async (c) => {
  const [policies, events, credentials] = await Promise.all([
    c.env.DB.prepare(`SELECT p.*, r.name credential_name, r.secret_binding,
      CASE WHEN r.secret_binding = 'NOTIFICATION_WEBHOOK_SECRET' THEN ? ELSE 0 END credential_configured
      FROM notification_policies p LEFT JOIN integration_credential_refs r
      ON r.id = p.credential_ref_id AND r.tenant_id = p.tenant_id
      WHERE p.tenant_id = ? ORDER BY p.event_type, p.channel`)
      .bind(c.env.NOTIFICATION_WEBHOOK_SECRET ? 1 : 0, c.get("tenantId")).all(),
    c.env.DB.prepare("SELECT * FROM notification_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100").bind(c.get("tenantId")).all(),
    c.env.DB.prepare(`SELECT id, name, provider, secret_binding, purpose, status, last_validated_at,
      CASE WHEN secret_binding = 'NOTIFICATION_WEBHOOK_SECRET' THEN ? ELSE 0 END configured
      FROM integration_credential_refs WHERE tenant_id = ? ORDER BY name`)
      .bind(c.env.NOTIFICATION_WEBHOOK_SECRET ? 1 : 0, c.get("tenantId")).all()
  ]);
  return c.json({ data: { policies: policies.results, events: events.results, credentials: credentials.results } });
});

app.patch("/api/notifications/policies/:id", requireRoles("admin", "owner"), async (c) => {
  const policyId = c.req.param("id");
  if (!policyId) return c.json({ error: "Notification policy ID is required" }, 400);
  const body = await c.req.json<{ enabled?: boolean; destination?: string | null }>();
  const policy = await c.env.DB.prepare(`SELECT p.channel, p.destination, r.secret_binding
    FROM notification_policies p LEFT JOIN integration_credential_refs r ON r.id = p.credential_ref_id AND r.tenant_id = p.tenant_id
    WHERE p.id = ? AND p.tenant_id = ?`).bind(policyId, c.get("tenantId"))
    .first<{ channel: string; destination: string | null; secret_binding: string | null }>();
  if (!policy) return c.json({ error: "Notification policy not found" }, 404);
  const destination = body.destination === undefined ? policy.destination : body.destination?.trim() || null;
  if (policy.channel === "webhook" && destination) {
    try { safeWebhookDestination(destination); } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid webhook destination" }, 400);
    }
  }
  if (policy.channel === "webhook" && body.enabled === true &&
      (!destination || policy.secret_binding !== "NOTIFICATION_WEBHOOK_SECRET" || !c.env.NOTIFICATION_WEBHOOK_SECRET)) {
    return c.json({ error: "Configure a public HTTPS destination and the outbound signing credential before enabling delivery" }, 409);
  }
  const result = await c.env.DB.prepare(`UPDATE notification_policies SET enabled = COALESCE(?, enabled),
    destination = CASE WHEN ? = 1 THEN ? ELSE destination END,
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`)
    .bind(typeof body.enabled === "boolean" ? Number(body.enabled) : null, Number(body.destination !== undefined),
      destination, policyId, c.get("tenantId")).run();
  if (result.meta.changes) await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "notification_policy.updated",
    "notification_policy", policyId, { enabled: body.enabled, destinationConfigured: Boolean(destination) });
  return c.json({ updated: result.meta.changes === 1 });
});

app.post("/api/notifications/policies/:id/test", requireRoles("admin", "owner"), async (c) => {
  const policyId = c.req.param("id");
  const tenantId = c.get("tenantId");
  if (!policyId) return c.json({ error: "Notification policy ID is required" }, 400);
  const policy = await c.env.DB.prepare(`SELECT p.event_type, p.channel, p.destination, p.enabled, r.secret_binding
    FROM notification_policies p LEFT JOIN integration_credential_refs r ON r.id = p.credential_ref_id AND r.tenant_id = p.tenant_id
    WHERE p.id = ? AND p.tenant_id = ?`).bind(policyId, tenantId)
    .first<{ event_type: string; channel: string; destination: string | null; enabled: number; secret_binding: string | null }>();
  if (!policy) return c.json({ error: "Notification policy not found" }, 404);
  if (policy.channel !== "webhook") return c.json({ error: "Only webhook policies require an external delivery test" }, 409);
  try { safeWebhookDestination(policy.destination); } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Invalid webhook destination" }, 409);
  }
  if (policy.secret_binding !== "NOTIFICATION_WEBHOOK_SECRET" || !c.env.NOTIFICATION_WEBHOOK_SECRET) {
    return c.json({ error: "Outbound webhook signing credential is not configured" }, 409);
  }
  const eventId = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO notification_events
    (id, tenant_id, policy_id, event_type, severity, title, detail, target_type, target_id, delivery_status)
    SELECT ?, tenant_id, id, event_type, severity, 'Workrr delivery test',
      'This signed test verifies the configured notification destination.', 'notification_policy', id, 'pending'
    FROM notification_policies WHERE id = ? AND tenant_id = ?`)
    .bind(eventId, policyId, tenantId).run();
  await c.env.PROCESS_QUEUE.send({ kind: "notification_delivery", tenantId, eventId }, { contentType: "json" });
  await writeAudit(c.env, tenantId, c.get("actorId"), "notification_policy.test_queued", "notification_policy", policyId, { eventId });
  return c.json({ eventId, status: "pending" }, 202);
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

app.get("/api/service-principals", requireRoles("admin", "owner", "viewer"), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, access_common_name, display_name, role, status, created_at, last_seen_at
    FROM access_service_principals WHERE tenant_id = ? ORDER BY display_name`)
    .bind(c.get("tenantId")).all();
  return c.json({ data: results });
});

app.post("/api/service-principals", requireRoles("admin", "owner"), async (c) => {
  const body = await c.req.json<{ commonName?: string; displayName?: string; role?: string }>();
  const commonName = body.commonName?.trim() ?? "";
  const displayName = body.displayName?.trim() ?? "";
  if (!/^[A-Za-z0-9._-]{8,200}$/.test(commonName) || !commonName.endsWith(".access") ||
      !displayName || displayName.length > 100 || !["operator", "viewer"].includes(body.role ?? "")) {
    return c.json({ error: "A valid Access service-token client ID, display name, and operator or viewer role are required" }, 400);
  }
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(`INSERT INTO access_service_principals
      (id, tenant_id, access_common_name, display_name, role, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(id, c.get("tenantId"), commonName, displayName, body.role, c.get("actorId")).run();
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "service_principal.created",
      "service_principal", id, { commonName, role: body.role });
    return c.json({ id, status: "active" }, 201);
  } catch (error) {
    return c.json({ error: String(error).includes("UNIQUE") ?
      "That Access service-token client ID is already registered" : "Machine identity creation failed" }, 409);
  }
});

app.patch("/api/service-principals/:id", requireRoles("admin", "owner"), async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<{ role?: string; status?: string }>();
  if (!id || (body.role && !["operator", "viewer"].includes(body.role)) ||
      (body.status && !["active", "suspended"].includes(body.status)) ||
      (!body.role && !body.status)) return c.json({ error: "Invalid machine identity update" }, 400);
  const result = await c.env.DB.prepare(`UPDATE access_service_principals
    SET role = COALESCE(?, role), status = COALESCE(?, status) WHERE id = ? AND tenant_id = ?`)
    .bind(body.role ?? null, body.status ?? null, id, c.get("tenantId")).run();
  if (result.meta.changes === 1) await writeAudit(c.env, c.get("tenantId"), c.get("actorId"),
    "service_principal.updated", "service_principal", id, body);
  return c.json({ updated: result.meta.changes === 1 });
});

app.post("/api/smoke-fixtures", requireRoles("admin", "owner", "operator"), async (c) => {
  const body = await c.req.json<{ label?: string }>();
  const label = body.label?.trim() ?? "";
  if (!label || label.length > 120) return c.json({ error: "A label of 120 characters or fewer is required" }, 400);
  const id = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await c.env.DB.prepare(`INSERT INTO smoke_fixtures (id, tenant_id, created_by, label, expires_at)
    VALUES (?, ?, ?, ?, ?)`).bind(id, c.get("tenantId"), c.get("actorId"), label, expiresAt).run();
  await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "smoke_fixture.created",
    "smoke_fixture", id, { expiresAt });
  return c.json({ data: { id, label, expiresAt } }, 201);
});

app.get("/api/smoke-fixtures/:id", requireRoles("admin", "owner", "operator"), async (c) => {
  const fixture = await c.env.DB.prepare(`SELECT id, label, expires_at, created_at FROM smoke_fixtures
    WHERE id = ? AND tenant_id = ? AND created_by = ?`).bind(
      c.req.param("id"), c.get("tenantId"), c.get("actorId")).first();
  return fixture ? c.json({ data: fixture }) : c.json({ error: "Smoke fixture not found" }, 404);
});

app.delete("/api/smoke-fixtures/:id", requireRoles("admin", "owner", "operator"), async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Smoke fixture ID is required" }, 400);
  const result = await c.env.DB.prepare(`DELETE FROM smoke_fixtures
    WHERE id = ? AND tenant_id = ? AND created_by = ?`).bind(
      id, c.get("tenantId"), c.get("actorId")).run();
  if (result.meta.changes === 1) await writeAudit(c.env, c.get("tenantId"), c.get("actorId"),
    "smoke_fixture.deleted", "smoke_fixture", id, {});
  return c.json({ deleted: result.meta.changes === 1 });
});

app.get("/api/processes", async (c) => c.json({ data: await listBlueprints(c.env, c.get("tenantId")) }));

app.get("/api/process-templates", requireRoles("admin", "builder", "owner", "viewer"), async (c) => {
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

app.get("/api/usage", requireRoles("admin", "owner", "operator", "viewer"), async (c) =>
  c.json({ data: await getUsageLedger(c.env, c.get("tenantId")) }));

app.patch("/api/usage/budget", requireRoles("admin", "owner"), async (c) => {
  const body = await c.req.json<{ monthlyLimitUsd?: number; warningPercent?: number; hardLimit?: boolean }>();
  if (!Number.isFinite(body.monthlyLimitUsd) || Number(body.monthlyLimitUsd) < 1 || Number(body.monthlyLimitUsd) > 1_000_000 ||
      !Number.isInteger(body.warningPercent) || Number(body.warningPercent) < 1 || Number(body.warningPercent) > 100) {
    return c.json({ error: "Budget must be $1–$1,000,000 and warning threshold must be 1–100%" }, 400);
  }
  await c.env.DB.prepare(`INSERT INTO tenant_budgets (tenant_id, monthly_limit_usd, warning_percent, hard_limit, updated_by)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET monthly_limit_usd=excluded.monthly_limit_usd,
    warning_percent=excluded.warning_percent, hard_limit=excluded.hard_limit, updated_at=CURRENT_TIMESTAMP, updated_by=excluded.updated_by`)
    .bind(c.get("tenantId"), body.monthlyLimitUsd, body.warningPercent, Number(Boolean(body.hardLimit)), c.get("actorId")).run();
  await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "usage_budget.updated", "tenant", c.get("tenantId"), body);
  return c.json({ updated: true });
});

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
    return c.json({ error: error instanceof Error ? error.message : "Execution failed" }, isDlpBlocked(error) ? 422 : 400);
  }
});

app.post("/api/execute/async", requireRoles("admin", "builder", "owner", "operator", "consumer"), async (c) => {
  const request = await c.req.json<ExecutionRequest>();
  if (!request.blueprintId || !request.input) return c.json({ error: "blueprintId and input are required" }, 400);
  try {
    const admission = await assertAsyncExecutionAdmission(c.env, c.get("tenantId"), request.blueprintId);
    if (admission.deferred) return c.json(await executeRequest(c.env, c.get("tenantId"), request), 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Execution admission failed" }, 409);
  }
  const executionId = crypto.randomUUID();
  let protectedRequest: ExecutionRequest;
  try { protectedRequest = await sanitizeAsyncExecutionInput(c.env, c.get("tenantId"), request, executionId); }
  catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "DLP admission failed" }, isDlpBlocked(error) ? 422 : 400);
  }
  const job: QueueJob = { ...protectedRequest, executionId, attempt: 0, tenantId: c.get("tenantId") };
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

app.get("/api/evaluations/:id", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) => {
  const scenarioId = c.req.param("id");
  if (!scenarioId) return c.json({ error: "Evaluation scenario ID is required" }, 400);
  const detail = await getEvaluationDetail(c.env, c.get("tenantId"), scenarioId);
  return detail ? c.json({ data: detail }) : c.json({ error: "Evaluation scenario not found" }, 404);
});

app.get("/api/evaluation-rubrics", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) =>
  c.json({ data: await listRubricTemplates(c.env, c.get("tenantId")) }));

app.get("/api/evaluation-rubrics/package", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
  c.header("cache-control", "no-store");
  return c.json({ data: await exportRubricPackage(c.env, c.get("tenantId")) });
});

app.post("/api/evaluation-rubrics/package", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    const result = await importRubricPackage(c.env, c.get("tenantId"), c.get("actorId"), await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "evaluation_rubric_package.imported",
      "tenant", c.get("tenantId"), result);
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Rubric package could not be imported" }, 400);
  }
});

app.post("/api/evaluation-rubrics", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    const result = await createRubricTemplate(c.env, c.get("tenantId"), c.get("actorId"), await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "evaluation_rubric.created",
      "evaluation_rubric", result.id, { name: result.name, criteria: result.criteria.length });
    return c.json({ data: result }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Rubric template could not be created" }, 400);
  }
});

app.patch("/api/evaluation-rubrics/:id", requireRoles("admin", "builder", "owner"), async (c) => {
  const templateId = c.req.param("id");
  if (!templateId) return c.json({ error: "Rubric template ID is required" }, 400);
  try {
    const result = await updateRubricTemplate(c.env, c.get("tenantId"), templateId, await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "evaluation_rubric.updated",
      "evaluation_rubric", result.id, { name: result.name, criteria: result.criteria.length, enabled: result.enabled });
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Rubric template could not be updated" }, 400);
  }
});

app.post("/api/evaluations/:id/cases", requireRoles("admin", "builder", "owner"), async (c) => {
  const scenarioId = c.req.param("id");
  if (!scenarioId) return c.json({ error: "Evaluation scenario ID is required" }, 400);
  try {
    const result = await createEvaluationCase(c.env, c.get("tenantId"), scenarioId, await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "evaluation_case.created",
      "evaluation_scenario", scenarioId, { caseId: result.id, assertionCount: result.assertionCount });
    return c.json({ data: result }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Evaluation case could not be created" }, 400);
  }
});

app.get("/api/evaluations/:id/dataset", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) => {
  const scenarioId = c.req.param("id");
  if (!scenarioId) return c.json({ error: "Evaluation scenario ID is required" }, 400);
  try {
    const data = await exportEvaluationDataset(c.env, c.get("tenantId"), scenarioId);
    c.header("cache-control", "no-store");
    return c.json({ data });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Evaluation package could not be exported" }, 404);
  }
});

app.post("/api/evaluations/:id/dataset", requireRoles("admin", "builder", "owner"), async (c) => {
  const scenarioId = c.req.param("id");
  if (!scenarioId) return c.json({ error: "Evaluation scenario ID is required" }, 400);
  try {
    const result = await importEvaluationDataset(c.env, c.get("tenantId"), scenarioId, await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "evaluation_dataset.imported",
      "evaluation_scenario", scenarioId, result);
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Evaluation package could not be imported" }, 400);
  }
});

app.post("/api/evaluations/:id/suites", requireRoles("admin", "builder", "owner", "operator"), async (c) => {
  const scenarioId = c.req.param("id");
  if (!scenarioId) return c.json({ error: "Evaluation scenario ID is required" }, 400);
  const body: { releaseId?: string; mode?: "regression" | "shadow" } =
    await c.req.json<{ releaseId?: string; mode?: "regression" | "shadow" }>().catch(() => ({}));
  try {
    const result = await queueEvaluationSuite(c.env, c.get("tenantId"), c.get("actorId"), scenarioId,
      body.releaseId, body.mode === "shadow" ? "shadow" : "regression");
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "evaluation_suite.queued",
      "evaluation_suite", result.id, { scenarioId, releaseId: result.releaseId, mode: result.mode });
    return c.json({ data: result }, 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Evaluation suite could not be queued" }, 400);
  }
});

app.post("/api/evaluations/:id/samples", requireRoles("admin", "builder", "owner"), async (c) => {
  const scenarioId = c.req.param("id");
  if (!scenarioId) return c.json({ error: "Evaluation scenario ID is required" }, 400);
  try {
    const result = await promoteExecutionSample(c.env, c.get("tenantId"), scenarioId, await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "evaluation_sample.promoted",
      "evaluation_scenario", scenarioId, { caseId: result.id });
    return c.json({ data: result }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Execution sample could not be promoted" }, 400);
  }
});

app.post("/api/evaluations/:id/model-trials", requireRoles("admin", "builder", "owner", "operator"), async (c) => {
  const scenarioId = c.req.param("id");
  if (!scenarioId) return c.json({ error: "Evaluation scenario ID is required" }, 400);
  const body: { candidateProfile?: string; releaseId?: string } =
    await c.req.json<{ candidateProfile?: string; releaseId?: string }>().catch(() => ({}));
  if (!body.candidateProfile) return c.json({ error: "Candidate model profile is required" }, 400);
  try {
    const result = await queueModelTrial(c.env, c.get("tenantId"), c.get("actorId"), scenarioId,
      body.candidateProfile, body.releaseId);
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "evaluation_model_trial.queued",
      "evaluation_model_trial", result.id, { scenarioId, releaseId: result.releaseId,
        baselineProfile: result.baselineProfile, candidateProfile: result.candidateProfile });
    return c.json({ data: result }, 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Model comparison could not be queued" }, 400);
  }
});

app.put("/api/evaluation-results/:id/review", requireRoles("admin", "builder", "owner", "operator", "reviewer"), async (c) => {
  const resultId = c.req.param("id");
  if (!resultId) return c.json({ error: "Evaluation result ID is required" }, 400);
  try {
    const result = await reviewEvaluationResult(c.env, c.get("tenantId"), c.get("actorId"), resultId, await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "evaluation_result.reviewed",
      "evaluation_case_result", resultId, { score: result.score, verdict: result.verdict });
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Evaluation result review failed" }, 400);
  }
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

  if (connection.kind === "oauth" && connection.name === "Microsoft 365") {
    try {
      const data = await checkMicrosoftConnection(c.env, tenantId, c.get("actorId"));
      return c.json({ data: { ...data, checkedAt: new Date().toISOString() } });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Microsoft connection check failed" }, 409);
    }
  }
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
  const body = await c.req.json<{ mode?: string; reason?: string; incidentId?: string }>();
  if (!processId) return c.json({ error: "Process ID is required" }, 400);
  try {
    const result = await setProcessOperatingMode(c.env, c.get("tenantId"), c.get("actorId"), processId, body);
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "process.mode_changed", "process", processId,
      { mode: result.mode, previousMode: result.previousMode, reason: body.reason, incidentId: result.incidentId });
    if (result.mode === "emergency_stop") await emitNotification(c.env, c.get("tenantId"), {
      eventType: "incident.emergency_stop", title: "Process emergency stop activated",
      detail: body.reason || "No reason supplied", targetType: "process", targetId: processId
    });
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Process mode change failed" }, 400);
  }
});

app.get("/api/incidents", requireRoles("admin", "owner", "operator", "reviewer", "viewer"), async (c) =>
  c.json({ data: await getIncidentOperations(c.env, c.get("tenantId")) }));

app.patch("/api/dlp/rules/:detector", requireRoles("admin", "owner"), async (c) => {
  const detector = c.req.param("detector");
  if (!detector) return c.json({ error: "DLP detector is required" }, 400);
  try {
    return c.json({ data: await updateDlpRule(c.env, c.get("tenantId"), c.get("actorId"),
      detector, await c.req.json()) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "DLP rule update failed" }, 400);
  }
});

app.get("/api/incidents/:id", requireRoles("admin", "owner", "operator", "reviewer", "viewer"), async (c) => {
  const incidentId = c.req.param("id");
  if (!incidentId) return c.json({ error: "Incident ID is required" }, 400);
  const result = await getIncidentDetail(c.env, c.get("tenantId"), incidentId);
  return result ? c.json({ data: result }) : c.json({ error: "Incident not found" }, 404);
});

app.post("/api/incidents", requireRoles("admin", "owner", "operator"), async (c) => {
  try {
    const result = await createIncident(c.env, c.get("tenantId"), c.get("actorId"), await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "incident.opened", "incident", result.id, {});
    return c.json({ data: result }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Incident could not be opened" }, 400);
  }
});

app.post("/api/incidents/:id/transition", requireRoles("admin", "owner", "operator"), async (c) => {
  const incidentId = c.req.param("id");
  if (!incidentId) return c.json({ error: "Incident ID is required" }, 400);
  try {
    const result = await transitionIncident(c.env, c.get("tenantId"), c.get("actorId"), incidentId, await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "incident.transitioned", "incident", incidentId, result);
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Incident transition failed" }, 400);
  }
});

app.patch("/api/tenant/mode", requireRoles("admin", "owner"), async (c) => {
  try {
    const body = await c.req.json<{ mode?: "active" | "drain" | "emergency_stop"; reason?: string; incidentId?: string }>();
    const result = await setTenantOperatingMode(c.env, c.get("tenantId"), c.get("actorId"), body);
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "tenant.mode_changed", "tenant", c.get("tenantId"),
      { ...result, reason: body.reason });
    if (result.mode === "emergency_stop") await emitNotification(c.env, c.get("tenantId"), {
      eventType: "incident.emergency_stop", title: "Tenant emergency stop activated",
      detail: body.reason || "No reason supplied", targetType: "tenant", targetId: c.get("tenantId")
    });
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Tenant mode change failed" }, 400);
  }
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

const handler: ExportedHandler<Env, WorkrrQueueJob> = {
  fetch: app.fetch,
  async queue(batch, env) {
    for (const message of batch.messages) {
      if (message.body.kind === "notification_delivery") {
        try {
          await deliverNotificationWebhook(env, message.body.tenantId, message.body.eventId);
          message.ack();
        } catch (error) {
          console.error(JSON.stringify({ event: "notification_delivery_failed", eventId: message.body.eventId, error: String(error) }));
          if (message.attempts >= 5) await failNotificationDelivery(env, message.body.tenantId, message.body.eventId, error);
          message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
        }
        continue;
      }
      const job: QueueJob = message.body;
      try {
        await executeRequest(env, job.tenantId ?? "demo", job, job.executionId);
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ event: "queue_job_failed", executionId: job.executionId, error: String(error) }));
        const terminal = message.attempts >= 5;
        await env.DB.prepare("UPDATE executions SET status = ?, error = ?, completed_at = ? WHERE id = ? AND tenant_id = ?")
          .bind(terminal ? "failed" : "queued", error instanceof Error ? error.message : String(error), terminal ? new Date().toISOString() : null,
            job.executionId, job.tenantId ?? "demo").run();
        if (terminal) await emitNotification(env, job.tenantId ?? "demo", {
          eventType: "queue.retry_exhausted", title: "Process job exhausted retries",
          detail: error instanceof Error ? error.message : String(error), targetType: "execution", targetId: job.executionId
        });
        message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
      }
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare(`DELETE FROM oauth_states WHERE expires_at < ? OR
        (used_at IS NOT NULL AND used_at < ?)`).bind(
          new Date().toISOString(), new Date(Date.now() - 24 * 60 * 60_000).toISOString()),
      env.DB.prepare("DELETE FROM smoke_fixtures WHERE expires_at < ?").bind(new Date().toISOString()),
      env.DB.prepare(`INSERT INTO audit_events
        (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
        VALUES (?, 'demo', 'system', 'maintenance.tick', 'platform', 'workrr', ?)`)
        .bind(crypto.randomUUID(), JSON.stringify({ at: new Date().toISOString() }))
    ]));
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
