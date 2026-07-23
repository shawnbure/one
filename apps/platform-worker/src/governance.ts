import type { Env } from "./types";
import { getDeploymentVerification } from "./deployment-verification";

export async function getGovernance(env: Env, tenantId: string) {
  const deploymentVerificationPromise = getDeploymentVerification(env, tenantId);
  const [processes, connections, knowledge, evaluations, retention, members, audit, incidents, webhooks, credentials,
    tenantControl, dlpRules, dlpEvents, tools, modelPolicy] = await Promise.all([
    env.DB.prepare(`SELECT b.id, b.name, b.model_profile, b.prompt_release_id, b.active_release_id, b.autonomy,
      b.operating_mode, b.risk_level, b.business_owner, b.department, r.model_id,
      r.evaluation_status, r.evaluated_at,
      (SELECT MAX(e.completed_at) FROM executions e
        WHERE e.tenant_id=b.tenant_id AND e.blueprint_id=b.id
          AND e.process_release_id=b.active_release_id AND e.status='completed') model_last_success_at
      FROM agent_blueprints b LEFT JOIN process_releases r
        ON r.id=b.active_release_id AND r.tenant_id=b.tenant_id
      WHERE b.tenant_id = ? ORDER BY b.name`).bind(tenantId).all(),
    env.DB.prepare(`SELECT c.*, o.account_email oauth_account_email, o.account_name oauth_account_name,
      o.scopes_json oauth_scopes_json, o.status oauth_status, o.last_error oauth_last_error,
      o.connected_at oauth_connected_at
      FROM connections c LEFT JOIN oauth_connections o ON o.connection_id=c.id AND o.tenant_id=c.tenant_id
      WHERE c.tenant_id = ? ORDER BY c.name`).bind(tenantId).all(),
    env.DB.prepare("SELECT * FROM knowledge_sources WHERE tenant_id = ? ORDER BY name").bind(tenantId).all(),
    env.DB.prepare(`SELECT e.*, b.name process_name FROM evaluation_scenarios e JOIN agent_blueprints b ON b.id = e.blueprint_id
      WHERE e.tenant_id = ? ORDER BY e.last_run_at DESC`).bind(tenantId).all(),
    env.DB.prepare("SELECT * FROM retention_policies WHERE tenant_id = ? ORDER BY data_class").bind(tenantId).all(),
    env.DB.prepare("SELECT id, email, display_name, role, status, last_seen_at FROM tenant_members WHERE tenant_id = ? ORDER BY display_name").bind(tenantId).all(),
    env.DB.prepare("SELECT id, actor_id, event_type, target_type, target_id, created_at FROM audit_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 30").bind(tenantId).all(),
    env.DB.prepare("SELECT * FROM incidents WHERE tenant_id = ? ORDER BY opened_at DESC LIMIT 20").bind(tenantId).all(),
    env.DB.prepare(`SELECT id, name, blueprint_id, status, accepted_events_json, created_at, last_received_at,
      CASE WHEN secret_binding = 'WEBHOOK_INBOX_SECRET' THEN ? ELSE 0 END secret_configured
      FROM webhook_endpoints WHERE tenant_id = ? ORDER BY name`).bind(env.WEBHOOK_INBOX_SECRET ? 1 : 0, tenantId).all(),
    env.DB.prepare(`SELECT id, name, provider, secret_binding, purpose, last_validated_at,
      CASE WHEN secret_binding = 'NOTIFICATION_WEBHOOK_SECRET' THEN ? ELSE 0 END configured
      FROM integration_credential_refs WHERE tenant_id = ? ORDER BY name`)
      .bind(env.NOTIFICATION_WEBHOOK_SECRET ? 1 : 0, tenantId).all(),
    env.DB.prepare("SELECT mode, incident_id, reason, updated_by, updated_at FROM tenant_operating_controls WHERE tenant_id = ?")
      .bind(tenantId).first(),
    env.DB.prepare(`SELECT detector, label, action, direction, enabled, updated_by, updated_at
      FROM dlp_rules WHERE tenant_id=? ORDER BY detector`).bind(tenantId).all(),
    env.DB.prepare(`SELECT direction, stage, detector, action, match_count, execution_id, blueprint_id, created_at
      FROM dlp_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 30`).bind(tenantId).all(),
    env.DB.prepare(`SELECT t.id, t.adapter_kind, t.connection_id, t.enabled,
      COUNT(pt.blueprint_id) process_count,
      CASE WHEN t.adapter_kind='mock' THEN 1
        WHEN c.status='healthy' AND c.secret_configured=1 THEN 1 ELSE 0 END ready
      FROM tool_definitions t
      LEFT JOIN connections c ON c.id=t.connection_id AND c.tenant_id=t.tenant_id
      LEFT JOIN process_tool_bindings pt ON pt.tool_id=t.id AND pt.tenant_id=t.tenant_id AND pt.enabled=1
      WHERE t.tenant_id=? GROUP BY t.id`).bind(tenantId).all(),
    env.DB.prepare(`SELECT m.model_id, m.label, m.provider, m.status,
      COALESCE(p.enabled,0) enabled,
      (SELECT COUNT(*) FROM agent_blueprints b JOIN process_releases r
        ON r.id=b.active_release_id AND r.tenant_id=b.tenant_id
        WHERE b.tenant_id=? AND r.model_id=m.model_id) active_processes
      FROM model_catalog m
      LEFT JOIN tenant_model_policies p ON p.tenant_id=? AND p.model_id=m.model_id
      WHERE m.status='active' ORDER BY m.input_usd_per_million, m.model_id`)
      .bind(tenantId, tenantId).all()
  ]);
  const processRows = processes.results as Array<Record<string, unknown>>;
  const connectionRows = connections.results as Array<Record<string, unknown>>;
  const evaluationRows = evaluations.results as Array<Record<string, unknown>>;
  const credentialRows = credentials.results as Array<Record<string, unknown>>;
  const knowledgeRows = knowledge.results as Array<Record<string, unknown>>;
  const toolRows = tools.results as Array<Record<string, unknown>>;
  const deploymentVerification = await deploymentVerificationPromise;
  const requiredConnectionRows = connectionRows.filter((row) => row.kind !== "oauth" || row.status !== "disconnected");
  const lifecycleConnectionRows = requiredConnectionRows.filter((row) => row.kind !== "model_provider");
  const lifecycleReadyRows = lifecycleConnectionRows.filter((row) =>
    Boolean(row.rotation_owner) && (row.kind === "oauth" || Boolean(row.credential_expires_at)));
  const models = buildModelInventory(processRows);
  const readyModels = models.filter((model) => model.ready).length;
  return {
    processes: processRows,
    connections: connectionRows,
    knowledge: knowledge.results,
    evaluations: evaluationRows,
    retention: retention.results,
    members: members.results,
    audit: audit.results,
    incidents: incidents.results,
    tenantControl: tenantControl ?? { mode: "active", incident_id: null, reason: null, updated_by: "system", updated_at: null },
    webhooks: webhooks.results,
    credentials: credentialRows,
    dlpRules: dlpRules.results,
    dlpEvents: dlpEvents.results,
    deploymentVerification,
    models,
    modelPolicy: modelPolicy.results,
    readiness: [
      { id: "identity", label: "Cloudflare Access trust boundary", ready: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD), detail: env.ACCESS_TEAM_DOMAIN ? "JWT verification configured" : "Access application configuration required", action: "Customer setup", actionLabel: "Open setup" },
      ...deploymentVerification.checks.map((check) => ({ ...check, action: check.id === "service-principal" ? "Team & roles" : "Customer setup", actionLabel: check.id === "service-principal" ? "Manage principals" : "Open verification" })),
      { id: "members", label: "Organization membership and roles", ready: members.results.length > 0, detail: `${members.results.length} active membership records`, action: "Team & roles", actionLabel: "Manage team" },
      { id: "releases", label: "Published process releases", ready: processRows.every((row) => Boolean(row.active_release_id)), detail: `${processRows.filter((row) => row.active_release_id).length}/${processRows.length} processes pinned`, action: "Processes", actionLabel: "Open processes" },
      { id: "models", label: "Recent Workers AI execution evidence",
        ready: models.length > 0 && readyModels === models.length,
        detail: `${readyModels}/${models.length} model identities have successful execution or passing evaluation evidence from the last 30 days`,
        action: "Evaluations", actionLabel: "Run evaluations" },
      { id: "connections", label: "Connection secret readiness", ready: requiredConnectionRows.every((row) => Number(row.secret_configured) === 1), detail: `${requiredConnectionRows.filter((row) => Number(row.secret_configured) === 1).length}/${requiredConnectionRows.length} required connections configured`, action: "Connections", actionLabel: "Open connections" },
      { id: "connection-lifecycle", label: "Credential rotation ownership", ready: lifecycleReadyRows.length === lifecycleConnectionRows.length,
        detail: `${lifecycleReadyRows.length}/${lifecycleConnectionRows.length} external credentials have an owner and expiry strategy`,
        action: "Connections", actionLabel: "Assign owners" },
      { id: "delivery", label: "Outbound delivery credentials", ready: credentialRows.every((row) => Number(row.configured) === 1), detail: `${credentialRows.filter((row) => Number(row.configured) === 1).length}/${credentialRows.length} Cloudflare secret references ready`, action: "Notifications", actionLabel: "Open delivery" },
      { id: "evaluations", label: "Evaluation release gates", ready: evaluationRows.length > 0 && evaluationRows.every((row) => row.status === "passing"), detail: `${evaluationRows.filter((row) => row.status === "passing").length}/${evaluationRows.length} scenarios passing`, action: "Evaluations", actionLabel: "Review evaluations" },
      { id: "retention", label: "Retention and deletion policy", ready: retention.results.length > 0, detail: `${retention.results.length} policies defined`, action: "Governance", actionLabel: "Review retention" },
      { id: "dlp", label: "Model-boundary DLP policy", ready: dlpRules.results.length === 6,
        detail: `${dlpRules.results.filter((row) => Number((row as Record<string, unknown>).enabled) === 1).length}/6 detectors enabled`, action: "Governance", actionLabel: "Review DLP" },
      { id: "knowledge", label: "Governed knowledge review", ready: knowledgeRows.every((row) =>
        !row.object_key || (row.status === "ready" && (!row.expires_at || new Date(String(row.expires_at)) > new Date()))),
        detail: `${knowledgeRows.filter((row) => row.object_key && row.status === "ready").length}/${knowledgeRows.filter((row) => row.object_key).length} indexed sources retrieval-ready`, action: "Knowledge", actionLabel: "Review knowledge" },
      { id: "tools", label: "Typed tool readiness", ready: toolRows.filter((row) => Number(row.enabled) && Number(row.process_count)).every((row) => Number(row.ready) === 1),
        detail: `${toolRows.filter((row) => Number(row.enabled) && Number(row.process_count) && Number(row.ready)).length}/${toolRows.filter((row) => Number(row.enabled) && Number(row.process_count)).length} bound tools ready`, action: "Connections", actionLabel: "Review tools" },
      { id: "observability", label: "Workers logs and traces", ready: true, detail: "Cloudflare observability enabled", action: "API logs", actionLabel: "Open logs" }
    ],
    dataFlow: ["Process input", "Cloudflare Worker", "Durable Agent / Workflow", "Workers AI", "Typed tool policy", "Human checkpoint", "Business outcome"]
  };
}

export function buildModelInventory(processRows: Array<Record<string, unknown>>, now = Date.now()) {
  const evidenceWindowMs = 30 * 86_400_000;
  const modelKeys = [...new Set(processRows.map((row) =>
    `${String(row.model_profile)}\u0000${String(row.model_id ?? "")}`))];
  return modelKeys.map((key) => {
    const [profile, rawModelId] = key.split("\u0000");
    const matching = processRows.filter((row) =>
      String(row.model_profile) === profile && String(row.model_id ?? "") === rawModelId);
    const evidence = matching.flatMap((row) => [
      row.model_last_success_at ? { at: String(row.model_last_success_at), kind: "successful execution" } : null,
      row.evaluation_status === "passing" && row.evaluated_at
        ? { at: String(row.evaluated_at), kind: "passing evaluation" } : null
    ]).filter((item): item is { at: string; kind: string } => Boolean(item))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
    return {
      profile: profile!,
      modelId: rawModelId || "Legacy profile mapping",
      provider: "Cloudflare Workers AI",
      processes: matching.length,
      boundary: "Cloudflare account",
      ready: Boolean(rawModelId && evidence && Date.parse(evidence.at) >= now - evidenceWindowMs),
      lastVerifiedAt: evidence?.at ?? null,
      evidence: evidence?.kind ?? null
    };
  });
}
