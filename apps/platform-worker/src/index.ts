import { Hono } from "hono";
import { executionProfiles, modelProfiles, workersAIModelCatalog, type ExecutionRequest, type KnowledgeIndexJob, type ProcessDisposalJob, type QueueJob, type ToolActionJob,
  type WorkrrQueueJob } from "@workrr/contracts";
import { requireIdentity, requireRoles, requireSameOrigin, type AuthVariables } from "./auth";
import { assertAsyncExecutionAdmission, executeRequest, sanitizeAsyncExecutionInput } from "./execution";
import { listBlueprints } from "./repository";
import type { Env } from "./types";
import { createDraftRelease, getStudio, publishRelease, rollbackRelease } from "./studio";
import { getOverviewData } from "./overview";
import { listApiLogs } from "./api-logs";
import { createWebhookEndpoint, listWebhookReceipts, setWebhookEndpointStatus,
  updateWebhookEndpoint } from "./webhook-operations";
import { getGovernance } from "./governance";
import { receiveWebhook } from "./webhook";
import { createProcessFromTemplate, getValueDashboard } from "./discovery";
import { recordValueMeasurement, voidValueMeasurement } from "./value-evidence";
import { updateValueTarget, ValueTargetConflict } from "./value-targets";
import { emitValueTargetReviewAlerts } from "./value-target-review";
import { applyOnboarding, bootstrapCustomer, BootstrapConflict, exportAccessHandoff, exportCustomerManifest, getOnboarding } from "./onboarding";
import { deliverNotification, emitNotification, enqueueDueNotificationDeliveries, failNotificationDelivery,
  safeEmailDestination, safeWebhookDestination } from "./notifications";
import { exportProcessPackage, importProcessPackage } from "./process-package";
import { createEvaluationCase, createRubricPublisherTrust, createRubricTemplate, expireRubricPublisherKeys,
  exportEvaluationDataset, exportRubricPackage, getEvaluationDetail, importEvaluationDataset, importRubricPackage,
  listRubricTemplates, promoteExecutionSample, queueEvaluationSuite, queueModelTrial, reviewEvaluationResult,
  reviewRubricKeyRotation, reviewRubricPackage, runEvaluation, updateRubricPublisherTrust,
  updateRubricTemplate } from "./evaluation";
import { getUsageLedger, importBillingEvidence, voidBillingEvidence } from "./usage";
import { createIncident, getIncidentDetail, getIncidentOperations, setProcessOperatingMode, setTenantOperatingMode, transitionIncident } from "./incidents";
import { checkMicrosoftConnection, completeMicrosoftOAuth, disconnectMicrosoft, startMicrosoftOAuth } from "./oauth";
import { isDlpBlocked, updateDlpRule } from "./dlp";
import { getShadowReview, listShadowReviews, reviewShadowExecution, ShadowReviewConflict } from "./shadow";
import { getProviderAcceptance, runMicrosoftAcceptance } from "./provider-acceptance";
import { getPlatformVersion } from "./platform-version";
import { clearAutonomySafetyCap, evaluateAllAutonomySafety, getAutonomySafety,
  updateAutonomySafetyPolicy } from "./autonomy-safety";
import { expireAccessSessions, getAccessOperations, reviewEmergencyAccessEvent,
  updateEmergencyAccessPlan } from "./access-operations";
import { createSchedule, dispatchDueSchedules, dispatchScheduleNow, listSchedules, updateSchedule } from "./schedules";
import { enqueueProcessJob, getQueueOperations, markQueueFailure, markQueueFinished, markQueueProcessing } from "./queue-operations";
import { createKnowledgeSource, deleteKnowledgeSource, indexKnowledgeSource, markKnowledgeIndexFailure,
  queryKnowledge, queueKnowledgeReindex, reviewKnowledgeSource, expireKnowledgeSources } from "./knowledge";
import { ContractViolationError, isContractViolation } from "./contracts";
import { createTool, listTools, setToolBindings, setToolEnabled } from "./tools";
import { listBoundAdapters } from "./tool-adapters";
import { cancelToolAction, decideApproval, enqueueRecoverableToolActions, markToolActionFailure,
  processToolAction, retryToolAction } from "./tool-actions";
import { getPrivacyArchitectureReport, renderPrivacyArchitectureHtml } from "./privacy-report";
import { addApprovalMessage, assignApproval, type ApprovalMessageKind } from "./approval-collaboration";
import { escalateOverdueApprovals } from "./approval-sla";
import { ApprovalProposalConflict, reviseApprovalProposal } from "./approval-proposals";
import { emitConnectionExpiryAlerts, markConnectionAttention, markConnectionSuccess,
  updateConnectionLifecycle } from "./connection-operations";
import { convertOpportunity, createOpportunity, getOpportunityReadiness, listOpportunities, listOpportunityRevisions,
  OpportunityRevisionConflict, qualifyOpportunity, updateOpportunity, updateOpportunityReadiness } from "./opportunities";
import { getOpportunityImplementationBrief, renderOpportunityBriefHtml } from "./opportunity-brief";
import { acknowledgeNotification, escalateUnacknowledgedNotifications } from "./notification-response";
import { exportSupportBundle, getManagedLifecycle, HandoffConflict, updateHandoffCheck,
  updateManagedLifecycle } from "./lifecycle";
import { disposeProcess, enqueueDueProcessDisposals, getProcessRetirement, requestProcessRetirement,
  transitionProcessRetirement } from "./retirement";
import { enforceAllTenantRetention, enforceTenantRetention, getRetentionOperations, previewRetention,
  updateRetentionControls } from "./retention";
import { acknowledgeLearning, createHelpRequest, getHelpCenter, HelpRequestConflict, updateHelpRequest } from "./help-center";
import { explainExecution, exportRedactedExecutionEvidence, getExecutionEvidence } from "./execution-evidence";
import { governExecutionFact, governExecutionMemory, listExecutionMemory, proposeExecutionFact } from "./memory-governance";
import { migrateExecutionActorRelease } from "./actor-release-migration";
import { getRecoveryOperations, RecoveryConflict, updateRecoveryTask } from "./recovery";
import { DelegationConflict, listApprovalDelegations, setApprovalDelegation } from "./approval-delegations";
import { getDeploymentVerification } from "./deployment-verification";
import { applyConfigurationRestore, ConfigurationRestoreConflict, exportConfigurationPackage,
  previewConfigurationRestore } from "./configuration-packages";
import { createActorReleaseRollout, listActorReleaseRollouts } from "./actor-release-rollouts";
import { createLaunchpadThread, executeLaunchpadProcess, executeLaunchpadThread,
  getLaunchpadConversation, governConsumerExecutionRequest, listLaunchpadThreads,
  setLaunchpadThreadArchived } from "./launchpad";
import { emitMaintenanceDegradedAlerts, runScheduledMaintenance } from "./maintenance";
import { cancelActorLocalWork, listActorLocalWork, queueActorLocalWork, scheduleActorLocalWork } from "./actor-local-work";

export { ProcessAgent } from "./agent";
export { ProcessWorkflow } from "./workflow";
export { EvaluationWorkflow } from "./evaluation-workflow";
export { ActorReleaseRolloutWorkflow } from "./actor-release-rollout-workflow";
export { ProcessDisposalWorkflow } from "./process-disposal-workflow";
export { TenantRetentionWorkflow } from "./retention-workflow";

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
    tenantId: c.get("tenantId"), tenantName: tenant?.name ?? c.get("tenantId"), accentColor: tenant?.accent_color ?? "#1f7a5b",
    environment: c.env.ENVIRONMENT, appDomain: c.env.APP_DOMAIN
  });
});

app.get("/api/access/operations", requireRoles("admin", "owner", "viewer"), async (c) =>
  c.json({ data: await getAccessOperations(c.env, c.get("tenantId")) }));

app.put("/api/access/emergency-plan", requireRoles("admin", "owner"), async (c) => {
  try {
    return c.json({ data: await updateEmergencyAccessPlan(c.env, c.get("tenantId"), c.get("actorId"),
      await c.req.json()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Emergency access plan could not be saved";
    return c.json({ error: message }, message.includes("changed") ? 409 : 400);
  }
});

app.post("/api/access/emergency-events/:eventId/review", requireRoles("admin", "owner"), async (c) => {
  try {
    const eventId = c.req.param("eventId");
    if (!eventId) return c.json({ error: "Emergency access event ID is required" }, 400);
    return c.json({ data: await reviewEmergencyAccessEvent(c.env, c.get("tenantId"), c.get("actorId"),
      eventId, await c.req.json()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Emergency access event could not be reviewed";
    return c.json({ error: message }, message.includes("changed") ? 409 : 400);
  }
});

app.get("/api/help-center", async (c) =>
  c.json({ data: await getHelpCenter(c.env, c.get("tenantId"), c.get("actorId"), c.get("role")) }));

app.post("/api/help-center/modules/:moduleId/acknowledge", async (c) => {
  try {
    const moduleId = c.req.param("moduleId");
    const body = await c.req.json<{ version?: number }>();
    if (!moduleId || !Number.isInteger(body.version) || Number(body.version) < 1) {
      return c.json({ error: "A valid learning module and version are required" }, 400);
    }
    const data = await acknowledgeLearning(
      c.env, c.get("tenantId"), c.get("actorId"), c.get("role"), moduleId, Number(body.version)
    );
    if (data.recorded) {
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "learning.module.acknowledged",
        "learning_module", moduleId, { version: body.version });
    }
    return c.json({ data }, data.recorded ? 201 : 200);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Training acknowledgement failed" }, 400);
  }
});

app.post("/api/help-center/requests", async (c) => {
  try {
    const data = await createHelpRequest(c.env, c.get("tenantId"), c.get("actorId"), await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "help.request.created",
      "help_request", data.id, { category: data.category, priority: data.priority, dueAt: data.dueAt });
    await emitNotification(c.env, c.get("tenantId"), {
      eventType: "help.request.created",
      title: `${data.priority === "high" ? "High-priority" : "New"} help request`,
      detail: `A ${data.category.replaceAll("_", " ")} request is due ${data.dueAt}.`,
      targetType: "help_request",
      targetId: data.id
    });
    return c.json({ data }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Help request could not be created" }, 400);
  }
});

app.patch("/api/help-center/requests/:requestId", requireRoles("admin", "builder", "owner", "operator"), async (c) => {
  try {
    const requestId = c.req.param("requestId");
    if (!requestId) return c.json({ error: "Help request ID is required" }, 400);
    const data = await updateHelpRequest(
      c.env, c.get("tenantId"), c.get("actorId"), requestId, await c.req.json()
    );
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "help.request.updated",
      "help_request", requestId, data);
    return c.json({ data });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Help request could not be updated" },
      error instanceof HelpRequestConflict ? 409 : 400);
  }
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

app.get("/api/configuration/export", requireRoles("admin", "owner"), async (c) => {
  c.header("content-disposition",
    `attachment; filename="workrr-configuration-${c.env.ENVIRONMENT}-${new Date().toISOString().slice(0, 10)}.json"`);
  c.header("cache-control", "no-store");
  return c.json(await exportConfigurationPackage(c.env, c.get("tenantId")));
});

app.post("/api/configuration/restore/preview", requireRoles("admin", "owner"), async (c) => {
  try {
    return c.json({ data: await previewConfigurationRestore((await c.req.json<{ package?: unknown }>()).package) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Configuration package is invalid" }, 400);
  }
});

app.post("/api/configuration/restore", requireRoles("admin", "owner"), async (c) => {
  try {
    return c.json({ data: await applyConfigurationRestore(
      c.env, c.get("tenantId"), c.get("actorId"), await c.req.json()
    ) }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Configuration restore failed" },
      error instanceof ConfigurationRestoreConflict ? 409 : 400);
  }
});

app.get("/api/lifecycle", requireRoles("admin", "owner", "operator", "viewer"), async (c) =>
  c.json({ data: await getManagedLifecycle(c.env, c.get("tenantId")) }));

app.put("/api/lifecycle", requireRoles("admin", "owner"), async (c) => {
  try {
    return c.json({ data: await updateManagedLifecycle(
      c.env, c.get("tenantId"), c.get("actorId"), await c.req.json()
    ) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Lifecycle settings could not be saved" }, 400);
  }
});

app.patch("/api/lifecycle/handoff/:checkId", requireRoles("admin", "owner"), async (c) => {
  try {
    const checkId = c.req.param("checkId");
    if (!checkId) return c.json({ error: "Handoff check ID is required" }, 400);
    return c.json({ data: await updateHandoffCheck(
      c.env, c.get("tenantId"), c.get("actorId"), checkId, await c.req.json()
    ) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Handoff evidence could not be saved" },
      error instanceof HandoffConflict ? 409 : 400);
  }
});

app.get("/api/lifecycle/support-bundle", requireRoles("admin", "owner", "operator"), async (c) => {
  c.header("content-disposition", `attachment; filename="workrr-support-${c.env.ENVIRONMENT}-${c.get("tenantId")}.json"`);
  c.header("cache-control", "no-store");
  return c.json(await exportSupportBundle(c.env, c.get("tenantId")));
});

app.get("/api/processes/:id/retirement",
  requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) => {
    const processId = c.req.param("id");
    if (!processId) return c.json({ error: "Process ID is required" }, 400);
    try {
      return c.json({ data: await getProcessRetirement(c.env, c.get("tenantId"), processId) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Retirement evidence could not be loaded" }, 404);
    }
  });

app.post("/api/processes/:id/retirement", requireRoles("admin", "builder", "owner"), async (c) => {
  const processId = c.req.param("id");
  if (!processId) return c.json({ error: "Process ID is required" }, 400);
  try {
    return c.json({ data: await requestProcessRetirement(
      c.env, c.get("tenantId"), c.get("actorId"), processId, await c.req.json()
    ) }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Retirement could not be requested" }, 400);
  }
});

app.patch("/api/processes/:id/retirement/:retirementId",
  requireRoles("admin", "owner"), async (c) => {
    const retirementId = c.req.param("retirementId");
    if (!retirementId) return c.json({ error: "Retirement ID is required" }, 400);
    try {
      return c.json({ data: await transitionProcessRetirement(
        c.env, c.get("tenantId"), c.get("actorId"), retirementId, await c.req.json()
      ) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Retirement could not be updated" }, 400);
    }
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

app.get("/api/provider-acceptance/microsoft",
  requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) =>
    c.json({ data: await getProviderAcceptance(c.env, c.get("tenantId")) }));

app.post("/api/provider-acceptance/microsoft",
  requireRoles("admin", "builder", "owner", "operator"), async (c) => {
    try {
      const body = await c.req.json<{ capabilities?: string[] }>();
      const data = await runMicrosoftAcceptance(
        c.env, c.get("tenantId"), c.get("actorId"), body.capabilities ?? []
      );
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"),
        "connection.provider_acceptance_completed", "connection", data.connectionId, {
          provider: data.provider, status: data.status, requested: data.requested,
          resultStatuses: data.results.map((result) => ({
            capability: result.capability, status: result.status, httpStatus: result.httpStatus
          }))
        });
      return c.json({ data }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Provider acceptance could not run";
      return c.json({ error: message }, message.includes("not connected") ? 409 : 400);
    }
  });

app.get("/api/notifications", requireRoles("admin", "owner", "operator", "viewer"), async (c) => {
  const [policies, events, credentials, microsoftEmail] = await Promise.all([
    c.env.DB.prepare(`SELECT p.*, r.name credential_name, r.secret_binding,
      m.email owner_email, m.display_name owner_name,
      CASE WHEN p.channel = 'email' THEN EXISTS (
        SELECT 1 FROM oauth_connections o WHERE o.tenant_id=p.tenant_id AND o.provider='microsoft'
        AND o.status='connected' AND LOWER(o.scopes_json) LIKE '%mail.send%'
      ) WHEN r.secret_binding = 'NOTIFICATION_WEBHOOK_SECRET' THEN ? ELSE 0 END credential_configured
      FROM notification_policies p LEFT JOIN integration_credential_refs r
      ON r.id = p.credential_ref_id AND r.tenant_id = p.tenant_id
      LEFT JOIN tenant_members m ON m.id=p.owner_id AND m.tenant_id=p.tenant_id
      WHERE p.tenant_id = ? ORDER BY p.event_type, p.channel`)
      .bind(c.env.NOTIFICATION_WEBHOOK_SECRET ? 1 : 0, c.get("tenantId")).all(),
    c.env.DB.prepare(`SELECT e.*, p.channel, p.acknowledgement_required, p.escalation_minutes,
      m.display_name owner_name, a.display_name acknowledged_by_name
      FROM notification_events e
      LEFT JOIN notification_policies p ON p.id=e.policy_id AND p.tenant_id=e.tenant_id
      LEFT JOIN tenant_members m ON m.id=p.owner_id AND m.tenant_id=p.tenant_id
      LEFT JOIN tenant_members a ON a.id=e.acknowledged_by AND a.tenant_id=e.tenant_id
      WHERE e.tenant_id=? ORDER BY e.created_at DESC LIMIT 100`).bind(c.get("tenantId")).all(),
    c.env.DB.prepare(`SELECT id, name, provider, secret_binding, purpose, status, last_validated_at,
      CASE WHEN secret_binding = 'NOTIFICATION_WEBHOOK_SECRET' THEN ? ELSE 0 END configured
      FROM integration_credential_refs WHERE tenant_id = ? ORDER BY name`)
      .bind(c.env.NOTIFICATION_WEBHOOK_SECRET ? 1 : 0, c.get("tenantId")).all(),
    c.env.DB.prepare(`SELECT account_email, account_name, status,
      CASE WHEN status='connected' AND LOWER(scopes_json) LIKE '%mail.send%' THEN 1 ELSE 0 END configured
      FROM oauth_connections WHERE tenant_id=? AND provider='microsoft'`).bind(c.get("tenantId")).first()
  ]);
  return c.json({ data: { policies: policies.results, events: events.results, credentials: credentials.results, microsoftEmail } });
});

app.patch("/api/notifications/policies/:id", requireRoles("admin", "owner"), async (c) => {
  const policyId = c.req.param("id");
  if (!policyId) return c.json({ error: "Notification policy ID is required" }, 400);
  const body = await c.req.json<{ enabled?: boolean; destination?: string | null; ownerId?: string | null;
    acknowledgementRequired?: boolean; escalationMinutes?: number; quietHoursEnabled?: boolean;
    quietStartHourUtc?: number; quietEndHourUtc?: number; criticalBypass?: boolean;
    digestMode?: "immediate" | "hourly" | "daily"; digestHourUtc?: number }>();
  const policy = await c.env.DB.prepare(`SELECT p.channel, p.destination, p.owner_id,
    p.acknowledgement_required, p.escalation_minutes, p.quiet_hours_enabled,
    p.quiet_start_hour_utc, p.quiet_end_hour_utc, p.critical_bypass, p.digest_mode,
    p.digest_hour_utc, r.secret_binding
    FROM notification_policies p LEFT JOIN integration_credential_refs r ON r.id = p.credential_ref_id AND r.tenant_id = p.tenant_id
    WHERE p.id = ? AND p.tenant_id = ?`).bind(policyId, c.get("tenantId"))
    .first<{ channel: string; destination: string | null; owner_id: string | null;
      acknowledgement_required: number; escalation_minutes: number; quiet_hours_enabled: number;
      quiet_start_hour_utc: number; quiet_end_hour_utc: number; critical_bypass: number;
      digest_mode: "immediate" | "hourly" | "daily"; digest_hour_utc: number;
      secret_binding: string | null }>();
  if (!policy) return c.json({ error: "Notification policy not found" }, 404);
  const destination = body.destination === undefined ? policy.destination : body.destination?.trim() || null;
  if (policy.channel === "webhook" && destination) {
    try { safeWebhookDestination(destination); } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid webhook destination" }, 400);
    }
  }
  if (policy.channel === "email" && destination) {
    try { safeEmailDestination(destination); } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid email destination" }, 400);
    }
  }
  if (policy.channel === "webhook" && body.enabled === true &&
      (!destination || policy.secret_binding !== "NOTIFICATION_WEBHOOK_SECRET" || !c.env.NOTIFICATION_WEBHOOK_SECRET)) {
    return c.json({ error: "Configure a public HTTPS destination and the outbound signing credential before enabling delivery" }, 409);
  }
  if (policy.channel === "email" && body.enabled === true) {
    if (!destination) return c.json({ error: "Configure one notification recipient before enabling email delivery" }, 409);
    const connected = await c.env.DB.prepare(`SELECT 1 ready FROM oauth_connections
      WHERE tenant_id=? AND provider='microsoft' AND status='connected'
      AND LOWER(scopes_json) LIKE '%mail.send%'`).bind(c.get("tenantId")).first();
    if (!connected) return c.json({
      error: "Reconnect Microsoft 365 with Send notifications (Mail.Send) permission before enabling email delivery",
    }, 409);
  }
  let ownerId = body.ownerId === undefined ? policy.owner_id : body.ownerId || null;
  const acknowledgementRequired = body.acknowledgementRequired === undefined
    ? Boolean(policy.acknowledgement_required) : body.acknowledgementRequired;
  const escalationMinutes = body.escalationMinutes === undefined
    ? Number(policy.escalation_minutes) : Number(body.escalationMinutes);
  if (!Number.isInteger(escalationMinutes) || escalationMinutes < 0 || escalationMinutes > 10080) {
    return c.json({ error: "Escalation timing must be 0–10,080 minutes" }, 400);
  }
  if (policy.channel !== "in_app" && (body.ownerId !== undefined || body.acknowledgementRequired !== undefined ||
      body.escalationMinutes !== undefined)) {
    return c.json({ error: "Human response controls apply only to in-app notification tasks" }, 400);
  }
  if (ownerId) {
    const owner = await c.env.DB.prepare(`SELECT id FROM tenant_members WHERE id=? AND tenant_id=?
      AND status='active' AND role IN ('admin','owner','operator')`).bind(ownerId, c.get("tenantId")).first();
    if (!owner) return c.json({ error: "Notification owner must be an active administrator, owner, or operator" }, 400);
  }
  if (policy.channel === "in_app" && acknowledgementRequired && (!ownerId || escalationMinutes < 1)) {
    return c.json({ error: "Acknowledged in-app alerts require an owner and escalation timing" }, 400);
  }
  const quietHoursEnabled = body.quietHoursEnabled === undefined
    ? Boolean(policy.quiet_hours_enabled) : body.quietHoursEnabled;
  const quietStartHourUtc = body.quietStartHourUtc === undefined
    ? Number(policy.quiet_start_hour_utc) : Number(body.quietStartHourUtc);
  const quietEndHourUtc = body.quietEndHourUtc === undefined
    ? Number(policy.quiet_end_hour_utc) : Number(body.quietEndHourUtc);
  const criticalBypass = body.criticalBypass === undefined
    ? Boolean(policy.critical_bypass) : body.criticalBypass;
  if (policy.channel === "in_app" && (body.quietHoursEnabled !== undefined ||
      body.quietStartHourUtc !== undefined || body.quietEndHourUtc !== undefined ||
      body.criticalBypass !== undefined)) {
    return c.json({ error: "Quiet hours apply only to external notification delivery" }, 400);
  }
  if (![quietStartHourUtc, quietEndHourUtc].every((hour) => Number.isInteger(hour) && hour >= 0 && hour <= 23) ||
      (quietHoursEnabled && quietStartHourUtc === quietEndHourUtc)) {
    return c.json({ error: "Quiet-hour start and end must be different UTC hours from 0–23" }, 400);
  }
  const digestMode = body.digestMode ?? policy.digest_mode;
  const digestHourUtc = body.digestHourUtc === undefined ? Number(policy.digest_hour_utc) : Number(body.digestHourUtc);
  if (!["immediate", "hourly", "daily"].includes(digestMode) ||
      !Number.isInteger(digestHourUtc) || digestHourUtc < 0 || digestHourUtc > 23) {
    return c.json({ error: "Digest mode and UTC delivery hour are invalid" }, 400);
  }
  if (policy.channel !== "email" && (body.digestMode !== undefined || body.digestHourUtc !== undefined)) {
    return c.json({ error: "Digest aggregation applies only to email delivery" }, 400);
  }
  const result = await c.env.DB.prepare(`UPDATE notification_policies SET enabled = COALESCE(?, enabled),
    destination = CASE WHEN ? = 1 THEN ? ELSE destination END,
    owner_id = CASE WHEN ? = 1 THEN ? ELSE owner_id END,
    acknowledgement_required = CASE WHEN ? = 1 THEN ? ELSE acknowledgement_required END,
    escalation_minutes = CASE WHEN ? = 1 THEN ? ELSE escalation_minutes END,
    quiet_hours_enabled = CASE WHEN ? = 1 THEN ? ELSE quiet_hours_enabled END,
    quiet_start_hour_utc = CASE WHEN ? = 1 THEN ? ELSE quiet_start_hour_utc END,
    quiet_end_hour_utc = CASE WHEN ? = 1 THEN ? ELSE quiet_end_hour_utc END,
    critical_bypass = CASE WHEN ? = 1 THEN ? ELSE critical_bypass END,
    digest_mode = CASE WHEN ? = 1 THEN ? ELSE digest_mode END,
    digest_hour_utc = CASE WHEN ? = 1 THEN ? ELSE digest_hour_utc END,
    updated_at = CURRENT_TIMESTAMP WHERE id = ? AND tenant_id = ?`)
    .bind(typeof body.enabled === "boolean" ? Number(body.enabled) : null, Number(body.destination !== undefined),
      destination, Number(body.ownerId !== undefined), ownerId,
      Number(body.acknowledgementRequired !== undefined), Number(acknowledgementRequired),
      Number(body.escalationMinutes !== undefined), escalationMinutes,
      Number(body.quietHoursEnabled !== undefined), Number(quietHoursEnabled),
      Number(body.quietStartHourUtc !== undefined), quietStartHourUtc,
      Number(body.quietEndHourUtc !== undefined), quietEndHourUtc,
      Number(body.criticalBypass !== undefined), Number(criticalBypass),
      Number(body.digestMode !== undefined), digestMode,
      Number(body.digestHourUtc !== undefined), digestHourUtc,
      policyId, c.get("tenantId")).run();
  if (result.meta.changes) await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "notification_policy.updated",
    "notification_policy", policyId, { enabled: body.enabled, destinationConfigured: Boolean(destination),
      ownerId, acknowledgementRequired, escalationMinutes, quietHoursEnabled, quietStartHourUtc,
      quietEndHourUtc, criticalBypass, digestMode, digestHourUtc });
  return c.json({ updated: result.meta.changes === 1 });
});

app.post("/api/notifications/events/:id/acknowledge",
  requireRoles("admin", "owner", "operator"), async (c) => {
    const eventId = c.req.param("id");
    if (!eventId) return c.json({ error: "Notification event ID is required" }, 400);
    const body: { note?: string } = await c.req.json<{ note?: string }>().catch(() => ({}));
    try {
      return c.json({ data: await acknowledgeNotification(
        c.env, c.get("tenantId"), c.get("actorId"), eventId, body.note
      ) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Notification could not be acknowledged";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
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
  if (!["webhook", "email"].includes(policy.channel)) {
    return c.json({ error: "Only external delivery policies can be tested" }, 409);
  }
  if (policy.channel === "webhook") {
    try { safeWebhookDestination(policy.destination); } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid webhook destination" }, 409);
    }
    if (policy.secret_binding !== "NOTIFICATION_WEBHOOK_SECRET" || !c.env.NOTIFICATION_WEBHOOK_SECRET) {
      return c.json({ error: "Outbound webhook signing credential is not configured" }, 409);
    }
  } else {
    try { safeEmailDestination(policy.destination); } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Invalid email destination" }, 409);
    }
    const connected = await c.env.DB.prepare(`SELECT 1 ready FROM oauth_connections
      WHERE tenant_id=? AND provider='microsoft' AND status='connected'
      AND LOWER(scopes_json) LIKE '%mail.send%'`).bind(tenantId).first();
    if (!connected) return c.json({ error: "Microsoft 365 Mail.Send permission is not connected" }, 409);
  }
  const eventId = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO notification_events
    (id, tenant_id, policy_id, event_type, severity, title, detail, target_type, target_id, delivery_status)
    SELECT ?, tenant_id, id, event_type, severity, 'Workrr delivery test',
      'This signed test verifies the configured notification destination.', 'notification_policy', id, 'pending'
    FROM notification_policies WHERE id = ? AND tenant_id = ?`)
    .bind(eventId, policyId, tenantId).run();
  await c.env.PROCESS_QUEUE.send({ kind: "notification_delivery", tenantId, eventId,
    channel: policy.channel as "webhook" | "email" }, { contentType: "json" });
  await writeAudit(c.env, tenantId, c.get("actorId"), "notification_policy.test_queued", "notification_policy", policyId, { eventId });
  return c.json({ eventId, status: "pending" }, 202);
});

app.get("/api/members", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, email, display_name, role, status, created_at, last_seen_at
    FROM tenant_members WHERE tenant_id = ? ORDER BY display_name`).bind(c.get("tenantId")).all();
  return c.json({ data: results });
});

app.get("/api/deployment-verification",
  requireRoles("admin", "owner", "operator", "viewer"), async (c) =>
    c.json({ data: await getDeploymentVerification(c.env, c.get("tenantId")) }));

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

app.get("/api/approval-delegations",
  requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) =>
    c.json({ data: await listApprovalDelegations(c.env, c.get("tenantId")) }));

app.put("/api/approval-delegations/:memberId",
  requireRoles("admin", "owner", "operator", "reviewer"), async (c) => {
    try {
      const memberId = c.req.param("memberId");
      if (!memberId) return c.json({ error: "Member ID is required" }, 400);
      const data = await setApprovalDelegation(c.env, c.get("tenantId"), c.get("actorId"),
        c.get("role"), memberId, await c.req.json());
      return c.json({ data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Approval delegation could not be saved";
      return c.json({ error: message }, error instanceof DelegationConflict ? 409 :
        message.includes("active approval-eligible") ? 404 :
          message.includes("Only an owner") ? 403 : 400);
    }
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

app.get("/api/processes", async (c) => {
  const processes = await listBlueprints(c.env, c.get("tenantId"));
  if (c.get("role") !== "consumer") return c.json({ data: processes });
  return c.json({ data: processes
    .filter((process) => process.status === "active" && process.activeReleaseId)
    .map((process) => ({
      id: process.id,
      name: process.name,
      description: process.description,
      executionProfile: process.executionProfile,
      modelProfile: process.modelProfile,
      promptReleaseId: null,
      autonomy: process.autonomy,
      status: process.status,
      operatingMode: process.operatingMode,
      activeReleaseId: process.activeReleaseId,
      inputSchemaJson: process.inputSchemaJson,
      outputSchemaJson: process.outputSchemaJson,
      tools: process.tools,
      updatedAt: process.updatedAt
    })) });
});

app.get("/api/process-schedules", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) =>
  c.json({ data: await listSchedules(c.env, c.get("tenantId"), c.req.query("process")) }));

app.post("/api/processes/:id/schedules", requireRoles("admin", "builder", "owner"), async (c) => {
  const processId = c.req.param("id");
  if (!processId) return c.json({ error: "Process ID is required" }, 400);
  try {
    const result = await createSchedule(c.env, c.get("tenantId"), c.get("actorId"), processId, await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "process_schedule.created",
      "process_schedule", result.id, result);
    return c.json({ data: result }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Schedule could not be created" }, 400);
  }
});

app.patch("/api/process-schedules/:id", requireRoles("admin", "builder", "owner"), async (c) => {
  const scheduleId = c.req.param("id");
  if (!scheduleId) return c.json({ error: "Schedule ID is required" }, 400);
  try {
    const result = await updateSchedule(c.env, c.get("tenantId"), scheduleId, await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "process_schedule.updated",
      "process_schedule", scheduleId, result);
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Schedule could not be updated" }, 400);
  }
});

app.post("/api/process-schedules/:id/run", requireRoles("admin", "builder", "owner", "operator"), async (c) => {
  const scheduleId = c.req.param("id");
  if (!scheduleId) return c.json({ error: "Schedule ID is required" }, 400);
  try {
    const result = await dispatchScheduleNow(c.env, c.get("tenantId"), scheduleId);
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "process_schedule.dispatched",
      "process_schedule", scheduleId, result);
    return c.json({ data: result }, 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Schedule could not be dispatched" }, 400);
  }
});

app.get("/api/process-templates", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, name, description, execution_profile, model_profile, autonomy,
    tools_json, category, starter_json FROM process_templates ORDER BY category, name`).all();
  return c.json({ data: results });
});

app.get("/api/opportunities", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) =>
  c.json({ data: await listOpportunities(c.env, c.get("tenantId")) }));

app.get("/api/opportunities/:id/brief", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) => {
  const opportunityId = c.req.param("id");
  if (!opportunityId) return c.json({ error: "Opportunity id is required" }, 400);
  const brief = await getOpportunityImplementationBrief(
    c.env, c.get("tenantId"), opportunityId, c.get("actorEmail")
  );
  if (!brief) return c.json({ error: "Opportunity was not found" }, 404);
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
  if (c.req.query("format") === "json") {
    c.header("content-disposition", `attachment; filename="workrr-opportunity-${opportunityId}.json"`);
    return c.json({ data: brief });
  }
  c.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  c.header("content-disposition", `inline; filename="workrr-opportunity-${opportunityId}.html"`);
  return c.html(renderOpportunityBriefHtml(brief));
});

app.post("/api/opportunities", requireRoles("admin", "builder", "owner", "operator"), async (c) => {
  try {
    return c.json({ data: await createOpportunity(
      c.env, c.get("tenantId"), c.get("actorId"), await c.req.json()
    ) }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Opportunity could not be captured" }, 400);
  }
});

app.put("/api/opportunities/:id", requireRoles("admin", "builder", "owner", "operator"), async (c) => {
  try {
    const opportunityId = c.req.param("id");
    if (!opportunityId) return c.json({ error: "Opportunity id is required" }, 400);
    const body = await c.req.json<Record<string, unknown> & { expectedRevision?: number; changeReason?: string }>();
    return c.json({ data: await updateOpportunity(
      c.env, c.get("tenantId"), c.get("actorId"), opportunityId,
      Number(body.expectedRevision), String(body.changeReason ?? ""), body as never
    ) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Opportunity evidence could not be revised";
    return c.json({ error: message }, error instanceof OpportunityRevisionConflict ? 409 :
      message === "Opportunity was not found" ? 404 : 400);
  }
});

app.get("/api/opportunities/:id/revisions", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) => {
  try {
    const opportunityId = c.req.param("id");
    if (!opportunityId) return c.json({ error: "Opportunity id is required" }, 400);
    return c.json({ data: await listOpportunityRevisions(c.env, c.get("tenantId"), opportunityId) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Opportunity history could not load" }, 404);
  }
});

app.get("/api/opportunities/:id/readiness", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) => {
  try {
    const opportunityId = c.req.param("id");
    if (!opportunityId) return c.json({ error: "Opportunity id is required" }, 400);
    return c.json({ data: await getOpportunityReadiness(c.env, c.get("tenantId"), opportunityId) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Opportunity readiness could not load" }, 404);
  }
});

app.patch("/api/opportunities/:id/readiness/:checkKey", requireRoles("admin", "builder", "owner", "operator"), async (c) => {
  try {
    const opportunityId = c.req.param("id");
    const checkKey = c.req.param("checkKey");
    if (!opportunityId || !checkKey) return c.json({ error: "Opportunity and check are required" }, 400);
    return c.json({ data: await updateOpportunityReadiness(
      c.env, c.get("tenantId"), c.get("actorId"), opportunityId, checkKey, await c.req.json()
    ) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Opportunity readiness could not be updated";
    return c.json({ error: message }, message.includes("not found") ? 404 : 400);
  }
});

app.patch("/api/opportunities/:id/qualification", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    const opportunityId = c.req.param("id");
    if (!opportunityId) return c.json({ error: "Opportunity id is required" }, 400);
    return c.json({ data: await qualifyOpportunity(
      c.env, c.get("tenantId"), c.get("actorId"), opportunityId, await c.req.json()
    ) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Opportunity could not be qualified";
    return c.json({ error: message }, message === "Opportunity was not found" ? 404 : 400);
  }
});

app.post("/api/opportunities/:id/convert", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    const opportunityId = c.req.param("id");
    if (!opportunityId) return c.json({ error: "Opportunity id is required" }, 400);
    const body = await c.req.json<{ templateId?: string }>();
    return c.json({ data: await convertOpportunity(
      c.env, c.get("tenantId"), c.get("actorId"), opportunityId, body.templateId
    ) }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Opportunity could not become a process";
    return c.json({ error: message }, message === "Opportunity was not found" ? 404 : 400);
  }
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

app.post("/api/value/measurements", requireRoles("admin", "owner", "operator"), async (c) => {
  try {
    return c.json({ data: await recordValueMeasurement(
      c.env, c.get("tenantId"), c.get("actorId"), await c.req.json()
    ) }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Value measurement could not be recorded" },
      isDlpBlocked(error) ? 422 : 400);
  }
});

app.post("/api/value/measurements/:id/void", requireRoles("admin", "owner"), async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Value measurement ID is required" }, 400);
  const body: { reason?: string; expectedRevision?: number } =
    await c.req.json<{ reason?: string; expectedRevision?: number }>().catch(() => ({}));
  try {
    return c.json({ data: await voidValueMeasurement(
      c.env, c.get("tenantId"), c.get("actorId"), id, body.reason, body.expectedRevision
    ) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Value measurement could not be corrected" },
      isDlpBlocked(error) ? 422 : 409);
  }
});

app.put("/api/value/targets/:processId", requireRoles("admin", "owner"), async (c) => {
  const processId = c.req.param("processId");
  if (!processId) return c.json({ error: "Process ID is required" }, 400);
  try {
    return c.json({ data: await updateValueTarget(
      c.env, c.get("tenantId"), c.get("actorId"), processId, await c.req.json()
    ) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Value target could not be saved" },
      isDlpBlocked(error) ? 422 : error instanceof ValueTargetConflict ? 409 : 400);
  }
});

app.get("/api/usage", requireRoles("admin", "owner", "operator", "viewer"), async (c) =>
  c.json({ data: await getUsageLedger(c.env, c.get("tenantId")) }));

app.post("/api/usage/reconciliations", requireRoles("admin", "owner"), async (c) => {
  try {
    return c.json({ data: await importBillingEvidence(
      c.env, c.get("tenantId"), c.get("actorId"), await c.req.json()
    ) }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Billing evidence import failed" }, 400);
  }
});

app.post("/api/usage/reconciliations/:id/void", requireRoles("admin", "owner"), async (c) => {
  const id = c.req.param("id");
  if (!id) return c.json({ error: "Reconciliation ID is required" }, 400);
  const body: { reason?: string } = await c.req.json<{ reason?: string }>().catch(() => ({}));
  try {
    return c.json({ data: await voidBillingEvidence(
      c.env, c.get("tenantId"), c.get("actorId"), id, body.reason
    ) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Billing evidence could not be voided" }, 409);
  }
});

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

app.get("/api/processes/:id/studio",
  requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
  const processId = c.req.param("id");
  if (!processId) return c.json({ error: "Process ID is required" }, 400);
  const studio = await getStudio(c.env, c.get("tenantId"), processId);
  return studio ? c.json({ data: studio }) : c.json({ error: "Process not found" }, 404);
});

app.get("/api/processes/:id/autonomy-safety",
  requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
    try {
      const processId = c.req.param("id");
      if (!processId) return c.json({ error: "Process ID is required" }, 400);
      return c.json({ data: await getAutonomySafety(c.env, c.get("tenantId"), processId) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Autonomy safety state could not load" }, 404);
    }
  });

app.patch("/api/processes/:id/autonomy-safety", requireRoles("admin", "owner"), async (c) => {
  try {
    const processId = c.req.param("id");
    if (!processId) return c.json({ error: "Process ID is required" }, 400);
    return c.json({ data: await updateAutonomySafetyPolicy(c.env, c.get("tenantId"), c.get("actorId"),
      processId, await c.req.json()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Autonomy fallback policy could not be saved";
    return c.json({ error: message }, message.includes("changed") ? 409 : 400);
  }
});

app.post("/api/processes/:id/autonomy-safety/clear", requireRoles("admin", "owner"), async (c) => {
  try {
    const processId = c.req.param("id");
    if (!processId) return c.json({ error: "Process ID is required" }, 400);
    return c.json({ data: await clearAutonomySafetyCap(c.env, c.get("tenantId"), c.get("actorId"),
      processId, await c.req.json()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Autonomy fallback could not be cleared";
    return c.json({ error: message }, message.includes("changed") ? 409 : 400);
  }
});

app.get("/api/processes/:id/actor-release-rollouts",
  requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
    const processId = c.req.param("id");
    if (!processId) return c.json({ error: "Process ID is required" }, 400);
    return c.json({ data: await listActorReleaseRollouts(c.env, c.get("tenantId"), processId) });
  });

app.post("/api/processes/:id/actor-release-rollouts", requireRoles("admin", "owner"), async (c) => {
  try {
    const processId = c.req.param("id");
    if (!processId) return c.json({ error: "Process ID is required" }, 400);
    const result = await createActorReleaseRollout(c.env, c.get("tenantId"), c.get("actorId"),
      processId, await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "actor_release.rollout_queued",
      "process", processId, result);
    return c.json({ data: result }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Actor release rollout could not be started";
    return c.json({ error: message }, message.includes("already active") || message.includes("changed") ||
      message.includes("Confirm") ? 409 : 400);
  }
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

app.post("/api/processes/:id/releases/:releaseId/rollback", requireRoles("admin", "owner"), async (c) => {
  try {
    const processId = c.req.param("id");
    const releaseId = c.req.param("releaseId");
    if (!processId || !releaseId) return c.json({ error: "Process and release IDs are required" }, 400);
    const result = await rollbackRelease(c.env, c.get("tenantId"), processId, releaseId,
      c.get("actorId"), await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "process_release.rolled_back",
      "process", processId, {
        fromReleaseId: result.previousReleaseId, toReleaseId: result.releaseId,
        version: result.version, reason: result.reason
      });
    return c.json(result);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Release rollback failed" }, 400);
  }
});

app.get("/api/overview", async (c) => {
  return c.json(await getOverviewData(c.env, c.get("tenantId")));
});

app.get("/api/executions", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
  const status = c.req.query("status");
  const blueprintId = c.req.query("process");
  const filters: string[] = ["tenant_id = ?"];
  const bindings: string[] = [c.get("tenantId")];
  if (status) { filters.push("status = ?"); bindings.push(status); }
  if (blueprintId) { filters.push("blueprint_id = ?"); bindings.push(blueprintId); }
  const { results } = await c.env.DB.prepare(`SELECT id, blueprint_id, instance_key, execution_profile, status,
    input_preview, output_preview, model, input_tokens, output_tokens, total_tokens, started_at, completed_at, error,
    autonomy_level, autonomy_disposition, approval_id
    FROM executions WHERE ${filters.join(" AND ")} ORDER BY started_at DESC LIMIT 100`).bind(...bindings).all();
  return c.json({ data: results });
});

app.get("/api/recovery", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) =>
  c.json({ data: await getRecoveryOperations(c.env, c.get("tenantId")) }));

app.get("/api/shadow-reviews",
  requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) =>
    c.json({ data: await listShadowReviews(c.env, c.get("tenantId")) }));

app.patch("/api/shadow-reviews/:executionId",
  requireRoles("admin", "builder", "owner", "operator", "reviewer"), async (c) => {
    try {
      const executionId = c.req.param("executionId");
      if (!executionId) return c.json({ error: "Execution ID is required" }, 400);
      const result = await reviewShadowExecution(c.env, c.get("tenantId"), c.get("actorId"),
        executionId, await c.req.json());
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "shadow.reviewed",
        "execution", executionId, { verdict: result?.verdict, revision: result?.revision });
      return c.json({ data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Shadow review could not be saved";
      return c.json({ error: message }, error instanceof ShadowReviewConflict ? 409 :
        isDlpBlocked(error) ? 422 : message.includes("not found") ? 404 : 400);
    }
  });

app.patch("/api/recovery/:id", requireRoles("admin", "owner", "operator"), async (c) => {
  try {
    const taskId = c.req.param("id");
    if (!taskId) return c.json({ error: "Recovery task ID is required" }, 400);
    const result = await updateRecoveryTask(c.env, c.get("tenantId"), c.get("actorId"), c.get("role"),
      taskId, await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), `recovery.${result.action}`,
      "execution_recovery", taskId, {
        executionId: result.executionId, status: result.status, assignedTo: result.assignedTo,
        resolutionExecutionId: result.resolutionExecutionId, note: result.note, revision: result.revision
      });
    return c.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recovery task could not be updated";
    return c.json({ error: message }, error instanceof RecoveryConflict ? 409 :
      message.includes("not found") ? 404 : 400);
  }
});

app.get("/api/executions/:id", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
  const executionId = c.req.param("id");
  if (!executionId) return c.json({ error: "Execution ID is required" }, 400);
  const evidence = await getExecutionEvidence(c.env, c.get("tenantId"), executionId);
  if (!evidence) return c.json({ error: "Execution not found" }, 404);
  const shadowReview = evidence.execution.autonomy_disposition === "shadowed"
    ? await getShadowReview(c.env, c.get("tenantId"), executionId) : null;
  return c.json({ data: evidence.execution, approvals: evidence.approvals, audit: evidence.audit,
    citations: evidence.citations, toolInvocations: evidence.toolInvocations, toolActions: evidence.toolActions,
    explanation: explainExecution(evidence), shadowReview });
});

app.get("/api/executions/:id/actor-work",
  requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
    try {
      const executionId = c.req.param("id");
      if (!executionId) return c.json({ error: "Execution ID is required" }, 400);
      const result = await listActorLocalWork(c.env, c.get("tenantId"), executionId);
      c.header("cache-control", "no-store");
      return c.json({ data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Actor-local work could not be loaded";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
  });

app.post("/api/executions/:id/actor-work/queue",
  requireRoles("admin", "builder", "owner", "operator"), async (c) => {
    try {
      const executionId = c.req.param("id");
      if (!executionId) return c.json({ error: "Execution ID is required" }, 400);
      const result = await queueActorLocalWork(c.env, c.get("tenantId"), executionId, await c.req.json());
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "agent.local_task_queued",
        "execution", executionId, { taskId: result.taskId });
      return c.json({ data: result }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Actor-local task could not be queued";
      return c.json({ error: message }, isDlpBlocked(error) ? 422 : message.includes("not found") ? 404 : 400);
    }
  });

app.post("/api/executions/:id/actor-work/schedules",
  requireRoles("admin", "builder", "owner", "operator"), async (c) => {
    try {
      const executionId = c.req.param("id");
      if (!executionId) return c.json({ error: "Execution ID is required" }, 400);
      const result = await scheduleActorLocalWork(c.env, c.get("tenantId"), executionId, await c.req.json());
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "agent.local_follow_up_scheduled",
        "execution", executionId, { taskId: result.taskId, scheduleId: result.scheduleId, dueAt: result.dueAt });
      return c.json({ data: result }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Actor-local follow-up could not be scheduled";
      return c.json({ error: message }, isDlpBlocked(error) ? 422 : message.includes("not found") ? 404 : 400);
    }
  });

app.delete("/api/executions/:id/actor-work/schedules/:scheduleId",
  requireRoles("admin", "builder", "owner", "operator"), async (c) => {
    try {
      const executionId = c.req.param("id");
      const scheduleId = c.req.param("scheduleId");
      if (!executionId || !scheduleId) return c.json({ error: "Execution and schedule IDs are required" }, 400);
      const result = await cancelActorLocalWork(c.env, c.get("tenantId"), executionId, scheduleId);
      if (!result.cancelled) return c.json({ error: "Active actor schedule not found" }, 404);
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "agent.local_follow_up_cancelled",
        "execution", executionId, { scheduleId });
      return c.json({ data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Actor-local follow-up could not be cancelled";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
  });

app.get("/api/executions/:id/evidence-export",
  requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
    const executionId = c.req.param("id");
    if (!executionId) return c.json({ error: "Execution ID is required" }, 400);
    const evidence = await getExecutionEvidence(c.env, c.get("tenantId"), executionId);
    if (!evidence) return c.json({ error: "Execution not found" }, 404);
    const safeFilenameId = executionId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "evidence";
    c.header("content-disposition", `attachment; filename="workrr-execution-${safeFilenameId}.json"`);
    c.header("cache-control", "no-store");
    return c.json(exportRedactedExecutionEvidence(evidence));
  });

app.get("/api/executions/:id/memory",
  requireRoles("admin", "builder", "owner", "operator"), async (c) => {
    try {
      const executionId = c.req.param("id");
      if (!executionId) return c.json({ error: "Execution ID is required" }, 400);
      c.header("cache-control", "no-store");
      return c.json({ data: await listExecutionMemory(c.env, c.get("tenantId"), executionId) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Actor memory could not be loaded";
      return c.json({ error: message }, message.includes("not found") ? 404 : 409);
    }
  });

app.patch("/api/executions/:executionId/memory/:turnId",
  requireRoles("admin", "builder", "owner", "operator"), async (c) => {
    try {
      const executionId = c.req.param("executionId");
      const turnId = c.req.param("turnId");
      if (!executionId || !turnId) return c.json({ error: "Execution and memory turn IDs are required" }, 400);
      const input = await c.req.json<{
        action?: string; expectedRevision?: number; content?: string; reason?: string;
      }>();
      const turn = await governExecutionMemory(c.env, c.get("tenantId"), c.get("actorId"),
        executionId, turnId, input);
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), `memory.${input.action}`,
        "execution_memory", turnId, {
          executionId, revision: turn.revision, status: turn.status
        });
      c.header("cache-control", "no-store");
      return c.json({ data: turn });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Actor memory could not be changed";
      const status = isDlpBlocked(error) ? 422 : message.includes("changed") ? 409 :
        message.includes("not found") ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

app.post("/api/executions/:executionId/memory/facts",
  requireRoles("admin", "builder", "owner", "operator"), async (c) => {
    try {
      const executionId = c.req.param("executionId");
      if (!executionId) return c.json({ error: "Execution ID is required" }, 400);
      const fact = await proposeExecutionFact(c.env, c.get("tenantId"), c.get("actorId"),
        executionId, await c.req.json());
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "memory_fact.proposed",
        "execution_memory_fact", fact.id, {
          executionId, category: fact.category, sourceTurnId: fact.sourceTurnId,
          revision: fact.revision, status: fact.status, expiresAt: fact.expiresAt
        });
      c.header("cache-control", "no-store");
      return c.json({ data: fact }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Durable fact could not be proposed";
      const status = isDlpBlocked(error) ? 422 : message.includes("not found") ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

app.patch("/api/executions/:executionId/memory/facts/:factId",
  requireRoles("admin", "builder", "owner", "operator"), async (c) => {
    try {
      const executionId = c.req.param("executionId");
      const factId = c.req.param("factId");
      if (!executionId || !factId) return c.json({ error: "Execution and durable fact IDs are required" }, 400);
      const input = await c.req.json<{
        action?: string; expectedRevision?: number; content?: string; reason?: string; expiresAt?: string;
      }>();
      const fact = await governExecutionFact(c.env, c.get("tenantId"), c.get("actorId"),
        executionId, factId, input);
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), `memory_fact.${input.action}`,
        "execution_memory_fact", fact.id, {
          executionId, category: fact.category, sourceTurnId: fact.sourceTurnId,
          revision: fact.revision, status: fact.status, expiresAt: fact.expiresAt
        });
      c.header("cache-control", "no-store");
      return c.json({ data: fact });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Durable fact could not be changed";
      const status = isDlpBlocked(error) ? 422 : message.includes("changed") ? 409 :
        message.includes("not found") ? 404 : 400;
      return c.json({ error: message }, status);
    }
  });

app.post("/api/executions/:id/actor-release",
  requireRoles("admin", "builder", "owner", "operator"), async (c) => {
    try {
      const executionId = c.req.param("id");
      if (!executionId) return c.json({ error: "Execution ID is required" }, 400);
      const result = await migrateExecutionActorRelease(c.env, c.get("tenantId"), c.get("actorId"),
        executionId, await c.req.json());
      if (result.changed) {
        await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "actor_release.migrated",
          "execution_actor", executionId, {
            fromReleaseId: result.fromReleaseId, toReleaseId: result.toReleaseId,
            targetVersion: result.targetVersion
          });
      }
      c.header("cache-control", "no-store");
      return c.json({ data: result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Actor release could not be migrated";
      return c.json({ error: message }, message.includes("not found") ? 404 :
        message.includes("changed") || message.includes("Confirm") ? 409 : 400);
    }
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

app.get("/api/launchpad/threads", requireRoles("admin", "builder", "owner", "operator", "consumer"), async (c) => {
  const blueprintId = c.req.query("blueprintId")?.trim();
  return c.json({ data: await listLaunchpadThreads(
    c.env, c.get("tenantId"), c.get("actorId"), blueprintId || undefined
  ) });
});

app.post("/api/launchpad/processes/:blueprintId/threads",
  requireRoles("admin", "builder", "owner", "operator", "consumer"), async (c) => {
    try {
      const blueprintId = c.req.param("blueprintId") ?? "";
      const body = await c.req.json<{ title?: string }>();
      const data = await createLaunchpadThread(
        c.env, c.get("tenantId"), c.get("actorId"), blueprintId, body.title
      );
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "launchpad.thread.created",
        "process_thread", data.id, { blueprintId });
      return c.json({ data }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Conversation could not be created" }, 400);
    }
  });

app.get("/api/launchpad/threads/:threadId",
  requireRoles("admin", "builder", "owner", "operator", "consumer"), async (c) => {
    try {
      c.header("cache-control", "no-store");
      return c.json({ data: await getLaunchpadConversation(
        c.env, c.get("tenantId"), c.get("actorId"), c.req.param("threadId") ?? ""
      ) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Conversation could not be loaded";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
  });

app.post("/api/launchpad/threads/:threadId/messages",
  requireRoles("admin", "builder", "owner", "operator", "consumer"), async (c) => {
    try {
      const body = await c.req.json<{ input?: string }>();
      const threadId = c.req.param("threadId") ?? "";
      const data = await executeLaunchpadThread(
        c.env, c.get("tenantId"), c.get("actorId"), threadId, body.input ?? ""
      );
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "launchpad.thread.executed",
        "process_thread", threadId, { executionId: data.executionId, status: data.status });
      return c.json({ data }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Conversation could not be executed";
      return c.json({ error: message }, isDlpBlocked(error) || isContractViolation(error) ? 422 :
        message.includes("not found") ? 404 : 400);
    }
  });

app.post("/api/launchpad/processes/:blueprintId/run",
  requireRoles("admin", "builder", "owner", "operator", "consumer"), async (c) => {
    try {
      const body = await c.req.json<{ input?: string }>();
      const blueprintId = c.req.param("blueprintId") ?? "";
      const data = await executeLaunchpadProcess(
        c.env, c.get("tenantId"), c.get("actorId"), blueprintId, body.input ?? ""
      );
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "launchpad.process.executed",
        "execution", data.executionId, { blueprintId, status: data.status });
      return c.json({ data }, 202);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Process could not be executed";
      return c.json({ error: message }, isDlpBlocked(error) || isContractViolation(error) ? 422 : 400);
    }
  });

app.patch("/api/launchpad/threads/:threadId",
  requireRoles("admin", "builder", "owner", "operator", "consumer"), async (c) => {
    try {
      const body = await c.req.json<{ archived?: boolean }>();
      if (typeof body.archived !== "boolean") return c.json({ error: "Archived state is required" }, 400);
      const data = await setLaunchpadThreadArchived(
        c.env, c.get("tenantId"), c.get("actorId"), c.req.param("threadId") ?? "", body.archived
      );
      await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), `launchpad.thread.${data.status}`,
        "process_thread", data.id, {});
      return c.json({ data });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Conversation could not be updated";
      return c.json({ error: message }, message.includes("not found") ? 404 : 400);
    }
  });

app.post("/api/execute", requireRoles("admin", "builder", "owner", "operator", "consumer"), async (c) => {
  let request = await c.req.json<ExecutionRequest>();
  if (!request.blueprintId || !request.input) return c.json({ error: "blueprintId and input are required" }, 400);
  try {
    if (c.get("role") === "consumer") {
      request = await governConsumerExecutionRequest(c.env, c.get("tenantId"), c.get("actorId"), request);
    }
    return c.json(await executeRequest(c.env, c.get("tenantId"), request), 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Execution failed" },
      isDlpBlocked(error) || isContractViolation(error) ? 422 : 400);
  }
});

app.post("/api/execute/async", requireRoles("admin", "builder", "owner", "operator", "consumer"), async (c) => {
  let request = await c.req.json<ExecutionRequest>();
  if (!request.blueprintId || !request.input) return c.json({ error: "blueprintId and input are required" }, 400);
  try {
    if (c.get("role") === "consumer") {
      request = await governConsumerExecutionRequest(c.env, c.get("tenantId"), c.get("actorId"), request);
    }
    const admission = await assertAsyncExecutionAdmission(c.env, c.get("tenantId"), request.blueprintId);
    if (admission.deferred) return c.json(await executeRequest(c.env, c.get("tenantId"), request), 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Execution admission failed" }, 409);
  }
  const executionId = crypto.randomUUID();
  let protectedRequest: ExecutionRequest;
  try { protectedRequest = await sanitizeAsyncExecutionInput(c.env, c.get("tenantId"), request, executionId); }
  catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Execution admission failed" },
      isDlpBlocked(error) || isContractViolation(error) ? 422 : 400);
  }
  const job: QueueJob = { ...protectedRequest, executionId, attempt: 0, tenantId: c.get("tenantId") };
  await enqueueProcessJob(c.env, job, "api");
  return c.json({ executionId, status: "queued" }, 202);
});

app.get("/api/queue-operations", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) =>
  c.json({ data: await getQueueOperations(c.env, c.get("tenantId")) }));

app.get("/api/tool-actions", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
  const tenantId = c.get("tenantId");
  const [summary, actions] = await Promise.all([
    c.env.DB.prepare(`SELECT status, COUNT(*) count FROM tool_action_dispatches
      WHERE tenant_id=? GROUP BY status ORDER BY status`).bind(tenantId).all(),
    c.env.DB.prepare(`SELECT d.*, i.tool_name, i.handler_key, i.input_json, i.output_json,
      b.name process_name, a.title approval_title
      FROM tool_action_dispatches d
      JOIN tool_invocations i ON i.id=d.invocation_id AND i.tenant_id=d.tenant_id
      JOIN executions e ON e.id=d.execution_id AND e.tenant_id=d.tenant_id
      JOIN agent_blueprints b ON b.id=e.blueprint_id AND b.tenant_id=e.tenant_id
      JOIN approvals a ON a.id=d.approval_id AND a.tenant_id=d.tenant_id
      WHERE d.tenant_id=? ORDER BY d.updated_at DESC LIMIT 100`).bind(tenantId).all()
  ]);
  return c.json({ data: { summary: summary.results, actions: actions.results } });
});

app.post("/api/queue-jobs/:id/replay", requireRoles("admin", "owner", "operator"), async (c) => {
  const queueJobId = c.req.param("id");
  if (!queueJobId) return c.json({ error: "Queue job ID is required" }, 400);
  const source = await c.env.DB.prepare(`SELECT q.id, q.execution_id, q.status, e.blueprint_id,
    e.execution_profile, e.instance_key, e.input_preview
    FROM process_queue_jobs q JOIN executions e ON e.id = q.execution_id AND e.tenant_id = q.tenant_id
    WHERE q.id = ? AND q.tenant_id = ?`)
    .bind(queueJobId, c.get("tenantId")).first<{
      id: string; execution_id: string; status: string; blueprint_id: string;
      execution_profile: string; instance_key: string | null; input_preview: string;
    }>();
  if (!source) return c.json({ error: "Queue job not found or has no replayable execution" }, 404);
  if (!["dead_lettered", "enqueue_failed"].includes(source.status)) {
    return c.json({ error: "Only failed or dead-lettered Queue jobs can be replayed" }, 409);
  }
  try {
    await assertAsyncExecutionAdmission(c.env, c.get("tenantId"), source.blueprint_id);
    const executionId = crypto.randomUUID();
    const request = replayRequest(source);
    const protectedRequest = await sanitizeAsyncExecutionInput(c.env, c.get("tenantId"), request, executionId);
    const job: QueueJob = { ...protectedRequest, executionId, attempt: 0, tenantId: c.get("tenantId") };
    const replayJobId = await enqueueProcessJob(c.env, job, "replay", source.id);
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "queue_job.replayed",
      "queue_job", replayJobId, { replayedFrom: source.id, sourceExecutionId: source.execution_id, executionId });
    return c.json({ data: { queueJobId: replayJobId, executionId, status: "queued" } }, 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Queue job replay failed" },
      isDlpBlocked(error) ? 422 : 409);
  }
});

app.get("/api/approvals", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
  const status = c.req.query("status");
  const filter = status && ["pending", "approved", "rejected", "expired"].includes(status) ? " AND a.status = ?" : "";
  const statement = c.env.DB.prepare(`SELECT a.*, origin.display_name delegated_from_name,
    CASE WHEN a.status='pending' AND a.due_at IS NOT NULL AND datetime(a.due_at)<datetime('now') THEN 1 ELSE 0 END overdue,
    MAX(0, CAST((julianday('now')-julianday(a.requested_at))*1440 AS INTEGER)) age_minutes
    FROM approvals a LEFT JOIN tenant_members origin
      ON origin.id=a.assigned_via_delegation_from AND origin.tenant_id=a.tenant_id
    WHERE a.tenant_id = ?${filter}
    ORDER BY CASE WHEN a.status='pending' THEN 0 ELSE 1 END,
      CASE WHEN a.status='pending' THEN COALESCE(a.due_at, '9999-12-31') END,
      COALESCE(a.last_activity_at, a.requested_at) DESC LIMIT 100`);
  const { results } = await (filter ? statement.bind(c.get("tenantId"), status) : statement.bind(c.get("tenantId"))).all();
  return c.json({ data: results });
});

app.get("/api/approvals/:id", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
  const [approval, audit, actions, messages] = await Promise.all([
    c.env.DB.prepare(`SELECT a.*, e.blueprint_id, e.input_preview, e.output_preview, e.model,
      origin.display_name delegated_from_name,
      CASE WHEN a.status='pending' AND a.due_at IS NOT NULL AND datetime(a.due_at)<datetime('now') THEN 1 ELSE 0 END overdue,
      MAX(0, CAST((julianday('now')-julianday(a.requested_at))*1440 AS INTEGER)) age_minutes
      FROM approvals a JOIN executions e ON e.id = a.execution_id
      LEFT JOIN tenant_members origin ON origin.id=a.assigned_via_delegation_from
        AND origin.tenant_id=a.tenant_id
      WHERE a.id = ? AND a.tenant_id = ?`).bind(c.req.param("id"), c.get("tenantId")).first(),
    c.env.DB.prepare(`SELECT actor_id, event_type, detail_json, created_at FROM audit_events
      WHERE tenant_id = ? AND ((target_type = 'approval' AND target_id = ?) OR
        (target_type = 'tool_action' AND target_id IN
          (SELECT id FROM tool_action_dispatches WHERE tenant_id=? AND approval_id=?))) ORDER BY created_at`)
      .bind(c.get("tenantId"), c.req.param("id"), c.get("tenantId"), c.req.param("id")).all(),
    c.env.DB.prepare(`SELECT d.*, i.tool_name, i.handler_key, i.input_json, i.output_json
      FROM tool_action_dispatches d JOIN tool_invocations i ON i.id=d.invocation_id AND i.tenant_id=d.tenant_id
      WHERE d.tenant_id=? AND d.approval_id=? ORDER BY d.created_at`)
      .bind(c.get("tenantId"), c.req.param("id")).all(),
    c.env.DB.prepare(`SELECT id, author_id, author_email, kind, body, created_at
      FROM approval_messages WHERE tenant_id=? AND approval_id=? ORDER BY created_at`)
      .bind(c.get("tenantId"), c.req.param("id")).all()
  ]);
  if (!approval) return c.json({ error: "Review item not found" }, 404);
  return c.json({ data: approval, audit: audit.results, actions: actions.results, messages: messages.results });
});

app.post("/api/approvals/:id/assign", requireRoles("admin", "owner", "operator", "reviewer"), async (c) => {
  const approvalId = c.req.param("id");
  const body = await c.req.json<{ assignedTo?: string }>();
  if (!approvalId || !body.assignedTo) return c.json({ error: "assignedTo is required" }, 400);
  try {
    return c.json(await assignApproval(c.env, c.get("tenantId"), c.get("actorId"), approvalId, body.assignedTo));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Review assignment failed" }, 409);
  }
});

app.patch("/api/approvals/:id/proposal", requireRoles("admin", "owner", "reviewer"), async (c) => {
  try {
    const approvalId = c.req.param("id");
    if (!approvalId) return c.json({ error: "Approval ID is required" }, 400);
    const result = await reviseApprovalProposal(c.env, c.get("tenantId"), c.get("actorId"),
      approvalId, await c.req.json());
    return c.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Proposal could not be edited";
    return c.json({ error: message }, error instanceof ApprovalProposalConflict ? 409 :
      isDlpBlocked(error) || isContractViolation(error) ? 422 :
        message.includes("not found") ? 404 : 400);
  }
});

app.get("/api/approval-assignees", requireRoles("admin", "owner", "operator", "reviewer"), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, email, display_name, role FROM tenant_members
    WHERE tenant_id=? AND status='active' AND role IN ('admin','owner','operator','reviewer')
    ORDER BY display_name`).bind(c.get("tenantId")).all();
  return c.json({ data: results });
});

app.post("/api/approvals/:id/messages",
  requireRoles("admin", "builder", "owner", "operator", "reviewer"), async (c) => {
    const approvalId = c.req.param("id");
    const body = await c.req.json<{ kind?: ApprovalMessageKind; body?: string }>();
    if (!approvalId || !body.kind ||
      !["comment", "information_request", "information_response", "escalation"].includes(body.kind) ||
      typeof body.body !== "string") return c.json({ error: "A valid message kind and body are required" }, 400);
    try {
      return c.json({ data: await addApprovalMessage(c.env, c.get("tenantId"), c.get("actorId"),
        c.get("actorEmail"), c.get("role"), approvalId, body.kind, body.body) }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Approval collaboration update failed" }, 409);
    }
  });

app.post("/api/tool-actions/:id/retry", requireRoles("admin", "owner", "operator"), async (c) => {
  const dispatchId = c.req.param("id");
  if (!dispatchId) return c.json({ error: "Approved action ID is required" }, 400);
  try {
    return c.json(await retryToolAction(c.env, c.get("tenantId"), c.get("actorId"), dispatchId), 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Approved action retry failed" }, 409);
  }
});

app.post("/api/tool-actions/:id/cancel", requireRoles("admin", "owner", "operator"), async (c) => {
  const dispatchId = c.req.param("id");
  if (!dispatchId) return c.json({ error: "Approved action ID is required" }, 400);
  const body: { note?: string } = await c.req.json<{ note?: string }>().catch(() => ({}));
  try {
    return c.json(await cancelToolAction(c.env, c.get("tenantId"), c.get("actorId"), dispatchId, body.note));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Approved action cancellation failed" }, 409);
  }
});

app.get("/api/audit", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, actor_id, event_type, target_type, target_id, detail_json, created_at
    FROM audit_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200`)
    .bind(c.get("tenantId")).all();
  return c.json({ data: results });
});

app.get("/api/governance", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) =>
  c.json({ data: await getGovernance(c.env, c.get("tenantId")) }));

app.get("/api/governance/retention", requireRoles("admin", "owner", "viewer"), async (c) =>
  c.json({ data: await getRetentionOperations(c.env, c.get("tenantId")) }));

app.put("/api/governance/retention", requireRoles("admin", "owner"), async (c) => {
  try {
    return c.json({ data: await updateRetentionControls(
      c.env, c.get("tenantId"), c.get("actorId"), await c.req.json<Record<string, unknown>>()
    ) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Retention policy update failed" }, 400);
  }
});

app.get("/api/governance/retention/preview", requireRoles("admin", "owner", "viewer"), async (c) =>
  c.json({ data: await previewRetention(c.env, c.get("tenantId")) }));

app.post("/api/governance/retention/enforce", requireRoles("admin", "owner"), async (c) => {
  try {
    const body: { confirmation?: string } = await c.req.json<{ confirmation?: string }>().catch(() => ({}));
    if (body.confirmation !== "ENFORCE RETENTION") {
      return c.json({ error: "Manual enforcement requires the exact confirmation" }, 400);
    }
    return c.json({ data: await enforceTenantRetention(c.env, c.get("tenantId")) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Retention enforcement failed" }, 409);
  }
});

app.post("/api/knowledge-sources", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    return c.json({ data: await createKnowledgeSource(c.env, c.get("tenantId"), c.get("actorId"),
      await c.req.formData()) }, 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Knowledge source could not be created" },
      isDlpBlocked(error) ? 422 : 400);
  }
});

app.post("/api/knowledge-sources/:id/reindex", requireRoles("admin", "builder", "owner"), async (c) => {
  const sourceId = c.req.param("id");
  if (!sourceId) return c.json({ error: "Knowledge source ID is required" }, 400);
  try {
    return c.json({ data: await queueKnowledgeReindex(c.env, c.get("tenantId"), c.get("actorId"), sourceId) }, 202);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Knowledge source could not be reindexed" }, 404);
  }
});

app.post("/api/knowledge-sources/:id/review", requireRoles("admin", "builder", "owner"), async (c) => {
  const sourceId = c.req.param("id");
  if (!sourceId) return c.json({ error: "Knowledge source ID is required" }, 400);
  try {
    return c.json({ data: await reviewKnowledgeSource(c.env, c.get("tenantId"), c.get("actorId"),
      sourceId, await c.req.json<{ expiresAt?: string | null }>()) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Knowledge source review failed" }, 400);
  }
});

app.delete("/api/knowledge-sources/:id", requireRoles("admin", "builder", "owner"), async (c) => {
  const sourceId = c.req.param("id");
  if (!sourceId) return c.json({ error: "Knowledge source ID is required" }, 400);
  try {
    return c.json({ data: await deleteKnowledgeSource(c.env, c.get("tenantId"), c.get("actorId"), sourceId) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Knowledge source could not be removed" }, 404);
  }
});

app.post("/api/knowledge/query", requireRoles("admin", "builder", "owner", "operator", "reviewer", "viewer"), async (c) => {
  try {
    const body = await c.req.json<{ query?: string; blueprintId?: string }>();
    return c.json({ data: await queryKnowledge(c.env, c.get("tenantId"), body.query ?? "", body.blueprintId) });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Knowledge query failed" }, 400);
  }
});

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

app.get("/api/governance/privacy-report", requireRoles("admin", "owner", "viewer"), async (c) => {
  const governance = await getGovernance(c.env, c.get("tenantId"));
  const report = await getPrivacyArchitectureReport(c.env, c.get("tenantId"), c.get("actorEmail"),
    governance.readiness);
  c.header("cache-control", "no-store");
  c.header("x-content-type-options", "nosniff");
  if (c.req.query("format") === "json") {
    c.header("content-disposition",
      `attachment; filename="workrr-privacy-architecture-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json({ data: report });
  }
  c.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'");
  c.header("content-disposition",
    `attachment; filename="workrr-privacy-architecture-${new Date().toISOString().slice(0, 10)}.html"`);
  return c.html(renderPrivacyArchitectureHtml(report));
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
    const pendingReview = "pendingReview" in result ? result.pendingReview : undefined;
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"),
      pendingReview ? "evaluation_rubric_package.review_submitted" : "evaluation_rubric_package.imported",
      pendingReview ? "rubric_package_review" : "tenant", pendingReview ?? c.get("tenantId"), result);
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Rubric package could not be imported" }, 400);
  }
});

app.post("/api/evaluation-rubric-reviews/:id/:decision", requireRoles("admin", "owner"), async (c) => {
  const decision = c.req.param("decision");
  const reviewId = c.req.param("id");
  if (decision !== "approved" && decision !== "rejected") return c.json({ error: "Decision must be approved or rejected" }, 400);
  if (!reviewId) return c.json({ error: "Review ID is required" }, 400);
  try {
    const body = await c.req.json<{ note?: string }>();
    const result = await reviewRubricPackage(c.env, c.get("tenantId"), c.get("actorId"),
      reviewId, decision, body.note ?? "");
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), `evaluation_rubric_package.${decision}`,
      "rubric_package_review", reviewId, result);
    return c.json({ data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rubric package review failed";
    return c.json({ error: message }, message.includes("already complete") ? 409 : 400);
  }
});

app.post("/api/evaluation-rubric-publishers/from-review/:id", requireRoles("admin", "owner"), async (c) => {
  const reviewId = c.req.param("id");
  if (!reviewId) return c.json({ error: "Review ID is required" }, 400);
  try {
    const body = await c.req.json<{ policy?: "manual" | "auto_approve" | "block" }>();
    const result = await createRubricPublisherTrust(c.env, c.get("tenantId"), c.get("actorId"),
      reviewId, body.policy ?? "manual");
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "evaluation_rubric_publisher.trusted",
      "rubric_publisher", result.keyId, { publisherName: result.publisherName, policy: result.policy });
    return c.json({ data: result }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Publisher trust could not be created" }, 400);
  }
});

app.patch("/api/evaluation-rubric-publishers/:id", requireRoles("admin", "owner"), async (c) => {
  const trustId = c.req.param("id");
  if (!trustId) return c.json({ error: "Publisher trust ID is required" }, 400);
  try {
    const result = await updateRubricPublisherTrust(c.env, c.get("tenantId"), trustId, await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "evaluation_rubric_publisher.updated",
      "rubric_publisher", trustId, result);
    return c.json({ data: result });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Publisher trust could not be updated" }, 400);
  }
});

app.post("/api/evaluation-rubric-key-rotations/:id/:decision", requireRoles("admin", "owner"), async (c) => {
  const id = c.req.param("id");
  const decision = c.req.param("decision");
  if (!id) return c.json({ error: "Rotation ID is required" }, 400);
  if (decision !== "approved" && decision !== "rejected") {
    return c.json({ error: "Decision must be approved or rejected" }, 400);
  }
  try {
    return c.json({ data: await reviewRubricKeyRotation(c.env, c.get("tenantId"), c.get("actorId"),
      id, decision, await c.req.json<{ overlapDays?: number; note?: string }>()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rubric key rotation review failed";
    return c.json({ error: message }, message.includes("already complete") ? 409 : 400);
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
  try {
    return c.json(await listApiLogs(c.env, c.get("tenantId"), {
      direction: c.req.query("direction"), outcome: c.req.query("outcome"),
      search: c.req.query("search"), cursor: c.req.query("cursor"), limit: c.req.query("limit")
    }));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "API logs could not be loaded" }, 400);
  }
});

app.get("/api/webhooks", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT id, name, blueprint_id, status, accepted_events_json, created_at, last_received_at,
    CASE WHEN secret_binding = 'WEBHOOK_INBOX_SECRET' THEN ? ELSE 0 END secret_configured
    FROM webhook_endpoints WHERE tenant_id = ? ORDER BY name`).bind(c.env.WEBHOOK_INBOX_SECRET ? 1 : 0, c.get("tenantId")).all();
  return c.json({ data: results });
});

app.post("/api/webhooks", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    return c.json({ data: await createWebhookEndpoint(
      c.env, c.get("tenantId"), c.get("actorId"), await c.req.json()
    ) }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Webhook could not be created" }, 400);
  }
});

app.put("/api/webhooks/:id", requireRoles("admin", "builder", "owner"), async (c) => {
  const endpointId = c.req.param("id");
  if (!endpointId) return c.json({ error: "Webhook endpoint ID is required" }, 400);
  try {
    return c.json({ data: await updateWebhookEndpoint(
      c.env, c.get("tenantId"), c.get("actorId"), endpointId, await c.req.json()
    ) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook could not be updated";
    return c.json({ error: message }, message.includes("not found") ? 404 : 409);
  }
});

app.get("/api/webhooks/:id/receipts",
  requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) => {
    const endpointId = c.req.param("id");
    if (!endpointId) return c.json({ error: "Webhook endpoint ID is required" }, 400);
    try {
      return c.json({ data: await listWebhookReceipts(c.env, c.get("tenantId"), endpointId) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Webhook receipts could not be loaded" }, 404);
    }
  });

app.get("/api/tools", requireRoles("admin", "builder", "owner", "operator", "viewer"), async (c) =>
  c.json({ data: await listTools(c.env, c.get("tenantId")) }));

app.get("/api/tool-adapters", requireRoles("admin", "builder", "owner", "operator", "viewer"), (c) =>
  c.json({ data: listBoundAdapters() }));

app.post("/api/tools", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    const data = await createTool(c.env, c.get("tenantId"), c.get("actorId"), await c.req.json());
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "tool.created", "tool", data.id,
      { name: data.name, processCount: data.processCount });
    return c.json({ data }, 201);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Tool could not be created" }, 400);
  }
});

app.put("/api/tools/:id/bindings", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    const toolId = c.req.param("id");
    if (!toolId) return c.json({ error: "Tool id is required" }, 400);
    const body = await c.req.json<{ processIds?: string[] }>();
    if (!Array.isArray(body.processIds)) return c.json({ error: "processIds is required" }, 400);
    const data = await setToolBindings(c.env, c.get("tenantId"), toolId, c.get("actorId"), body.processIds);
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"), "tool.bindings_updated", "tool", data.id,
      { processCount: data.processCount });
    return c.json({ data });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Tool bindings could not be updated" }, 400);
  }
});

app.patch("/api/tools/:id/status", requireRoles("admin", "builder", "owner"), async (c) => {
  try {
    const toolId = c.req.param("id");
    if (!toolId) return c.json({ error: "Tool id is required" }, 400);
    const body = await c.req.json<{ enabled?: boolean }>();
    if (typeof body.enabled !== "boolean") return c.json({ error: "enabled is required" }, 400);
    const data = await setToolEnabled(c.env, c.get("tenantId"), toolId, body.enabled);
    await writeAudit(c.env, c.get("tenantId"), c.get("actorId"),
      body.enabled ? "tool.enabled" : "tool.disabled", "tool", data.id, { enabled: data.enabled });
    return c.json({ data });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Tool status could not be updated" }, 400);
  }
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
  if (status === "healthy") {
    await markConnectionSuccess(c.env, tenantId, String(connection.id), detail);
  } else if (status === "attention") {
    await markConnectionAttention(c.env, tenantId, String(connection.id), detail);
  } else {
    await c.env.DB.prepare(`UPDATE connections SET status='disconnected', last_checked_at=CURRENT_TIMESTAMP,
      health_message=? WHERE id=? AND tenant_id=?`).bind(detail, connection.id, tenantId).run();
  }
  await writeAudit(c.env, tenantId, c.get("actorId"), "connection.checked", "connection", String(connection.id), { status, detail });
  return c.json({ data: { id: connection.id, status, detail, checkedAt: new Date().toISOString() } });
});

app.patch("/api/connections/:id/lifecycle", requireRoles("admin", "builder", "owner", "operator"), async (c) => {
  try {
    const connectionId = c.req.param("id");
    if (!connectionId) return c.json({ error: "Connection id is required" }, 400);
    const body = await c.req.json<{
      credentialExpiresAt?: string | null;
      rotationOwner?: string | null;
      lastRotatedAt?: string | null;
    }>();
    return c.json({ data: await updateConnectionLifecycle(
      c.env, c.get("tenantId"), c.get("actorId"), connectionId, body
    ) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Connection lifecycle could not be updated";
    return c.json({ error: message }, message === "Connection was not found" ? 404 : 400);
  }
});

app.patch("/api/webhooks/:id/status", requireRoles("admin", "builder", "owner"), async (c) => {
  const webhookId = c.req.param("id");
  const body = await c.req.json<{ status?: "active" | "disabled" }>();
  if (!webhookId || !body.status || !["active", "disabled"].includes(body.status)) return c.json({ error: "Valid status is required" }, 400);
  try {
    return c.json(await setWebhookEndpointStatus(
      c.env, c.get("tenantId"), c.get("actorId"), webhookId, body.status
    ));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook status could not be changed";
    return c.json({ error: message }, message.includes("not found") ? 404 : 409);
  }
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
  const body: { note?: string; expectedRevision?: number } =
    await c.req.json<{ note?: string; expectedRevision?: number }>().catch(() => ({}));
  try {
    return c.json(await decideApproval(c.env, c.get("tenantId"), c.get("actorId"),
      approvalId, decision, Number(body.expectedRevision), body.note));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "Approval decision failed" }, 409);
  }
});

app.get("/api/system/capabilities", (c) => c.json({
  executionProfiles,
  modelProfiles,
  workersAIModels: workersAIModelCatalog,
  primitives: ["Workers", "Agents SDK", "Durable Objects", "D1", "Workers AI", "Queues", "Workflows", "Cron"],
  promptCache: "Agent-local SQLite plus Workers AI session affinity",
  gateway: "planned"
}));

app.get("/api/system/version", requireRoles("admin", "owner", "operator", "builder", "viewer"), async (c) =>
  c.json({ data: await getPlatformVersion(c.env) }));

const handler: ExportedHandler<Env, WorkrrQueueJob> = {
  fetch: app.fetch,
  async queue(batch, env) {
    for (const message of batch.messages) {
      if (message.body.kind === "notification_delivery") {
        try {
          await deliverNotification(env, message.body.tenantId, message.body.eventId, message.body.channel);
          message.ack();
        } catch (error) {
          console.error(JSON.stringify({ event: "notification_delivery_failed", eventId: message.body.eventId, error: String(error) }));
          if (message.attempts >= 5) await failNotificationDelivery(env, message.body.tenantId, message.body.eventId, error);
          message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
        }
        continue;
      }
      if (message.body.kind === "knowledge_index") {
        const job: KnowledgeIndexJob = message.body;
        try {
          await indexKnowledgeSource(env, job);
          message.ack();
        } catch (error) {
          console.error(JSON.stringify({ event: "knowledge_index_failed", sourceId: job.sourceId, error: String(error) }));
          if (message.attempts >= 5) await markKnowledgeIndexFailure(env, job, error);
          message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
        }
        continue;
      }
      if (message.body.kind === "process_disposal") {
        const job: ProcessDisposalJob = message.body;
        try {
          await disposeProcess(env, job.tenantId, job.retirementId);
          message.ack();
        } catch (error) {
          console.error(JSON.stringify({ event: "process_disposal_failed", retirementId: job.retirementId,
            error: String(error) }));
          message.ack();
        }
        continue;
      }
      if (message.body.kind === "tool_action") {
        const job: ToolActionJob = message.body;
        try {
          await processToolAction(env, job);
          message.ack();
        } catch (error) {
          console.error(JSON.stringify({ event: "tool_action_failed", dispatchId: job.dispatchId, error: String(error) }));
          const terminal = message.attempts >= 5;
          await markToolActionFailure(env, job, error, terminal);
          if (terminal) message.ack();
          else message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
        }
        continue;
      }
      const job: QueueJob = message.body;
      try {
        await markQueueProcessing(env, job, message.attempts);
        const result = await executeRequest(env, job.tenantId ?? "demo", job, job.executionId);
        await markQueueFinished(env, job, result.status === "deferred" ? "deferred" : "completed");
        await env.DB.prepare(`UPDATE schedule_dispatches SET status = ?, completed_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ? AND execution_id = ? AND status = 'queued'`)
          .bind(result.status === "deferred" ? "deferred" : "completed",
            job.tenantId ?? "demo", job.executionId).run();
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ event: "queue_job_failed", executionId: job.executionId, error: String(error) }));
        const terminal = (error instanceof ContractViolationError && error.direction === "input") || message.attempts >= 5;
        await markQueueFailure(env, job, message.attempts, error, terminal);
        await env.DB.prepare("UPDATE executions SET status = ?, error = ?, completed_at = ? WHERE id = ? AND tenant_id = ?")
          .bind(terminal ? "failed" : "queued", error instanceof Error ? error.message : String(error), terminal ? new Date().toISOString() : null,
            job.executionId, job.tenantId ?? "demo").run();
        if (terminal) {
          await env.DB.prepare(`UPDATE schedule_dispatches SET status = 'failed', error = ?, completed_at = CURRENT_TIMESTAMP
            WHERE tenant_id = ? AND execution_id = ?`).bind(
              error instanceof Error ? error.message : String(error), job.tenantId ?? "demo", job.executionId).run();
          await emitNotification(env, job.tenantId ?? "demo", {
            eventType: "queue.retry_exhausted", title: "Process job exhausted retries",
            detail: error instanceof Error ? error.message : String(error), targetType: "execution", targetId: job.executionId
          });
        }
        if (terminal) message.ack();
        else message.retry({ delaySeconds: Math.min(300, 2 ** message.attempts) });
      }
    }
  },
  async scheduled(_controller, env, ctx) {
    const now = new Date();
    ctx.waitUntil(runScheduledMaintenance(env, [
      { name: "housekeeping", run: () => env.DB.batch([
        env.DB.prepare(`DELETE FROM oauth_states WHERE expires_at < ? OR
          (used_at IS NOT NULL AND used_at < ?)`).bind(
            now.toISOString(), new Date(now.getTime() - 24 * 60 * 60_000).toISOString()),
        env.DB.prepare("DELETE FROM smoke_fixtures WHERE expires_at < ?").bind(now.toISOString()),
        env.DB.prepare(`DELETE FROM process_queue_jobs
          WHERE status IN ('completed','deferred') AND completed_at < ?`).bind(
            new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString()),
        env.DB.prepare(`DELETE FROM process_queue_jobs
          WHERE status IN ('dead_lettered','enqueue_failed') AND completed_at < ?`).bind(
            new Date(now.getTime() - 90 * 24 * 60 * 60_000).toISOString()),
        env.DB.prepare(`DELETE FROM platform_maintenance_runs
          WHERE started_at < ?`).bind(new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString()),
        env.DB.prepare(`INSERT INTO audit_events
          (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
          VALUES (?, 'demo', 'system', 'maintenance.tick', 'platform', 'workrr', ?)`)
          .bind(crypto.randomUUID(), JSON.stringify({ at: now.toISOString() }))
      ]).then(() => undefined) },
      { name: "process_schedules", run: () => dispatchDueSchedules(env, now) },
      { name: "tool_action_recovery", run: () => enqueueRecoverableToolActions(env) },
      { name: "knowledge_expiry", run: () => expireKnowledgeSources(env, now) },
      { name: "connection_expiry_alerts", run: () => emitConnectionExpiryAlerts(env, now) },
      { name: "notification_escalation", run: () => escalateUnacknowledgedNotifications(env, now) },
      { name: "approval_escalation", run: () => escalateOverdueApprovals(env, now) },
      { name: "notification_delivery", run: () => enqueueDueNotificationDeliveries(env, now) },
      { name: "process_disposal", run: () => enqueueDueProcessDisposals(env, now) },
      { name: "tenant_retention", run: () => enforceAllTenantRetention(env, now) },
      { name: "rubric_key_expiry", run: () => expireRubricPublisherKeys(env, now) },
      { name: "autonomy_safety", run: () => evaluateAllAutonomySafety(env, now) },
      { name: "access_session_expiry", run: () => expireAccessSessions(env, now) },
      { name: "value_target_reviews", run: () => emitValueTargetReviewAlerts(env, now) }
    ], now).then(async (result) => {
      await emitMaintenanceDegradedAlerts(env, result);
      return result;
    }));
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
