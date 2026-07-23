import type { Env } from "./types";

export async function getGovernance(env: Env, tenantId: string) {
  const [processes, connections, knowledge, evaluations, retention, members, audit, incidents, webhooks, credentials, tenantControl, dlpRules, dlpEvents] = await Promise.all([
    env.DB.prepare(`SELECT id, name, model_profile, prompt_release_id, active_release_id, autonomy, operating_mode,
      risk_level, business_owner, department FROM agent_blueprints WHERE tenant_id = ? ORDER BY name`).bind(tenantId).all(),
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
      FROM dlp_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT 30`).bind(tenantId).all()
  ]);
  const processRows = processes.results as Array<Record<string, unknown>>;
  const connectionRows = connections.results as Array<Record<string, unknown>>;
  const evaluationRows = evaluations.results as Array<Record<string, unknown>>;
  const credentialRows = credentials.results as Array<Record<string, unknown>>;
  const requiredConnectionRows = connectionRows.filter((row) => row.kind !== "oauth" || row.status !== "disconnected");
  const models = [...new Set(processRows.map((row) => String(row.model_profile)))].map((profile) => ({
    profile,
    provider: "Cloudflare Workers AI",
    processes: processRows.filter((row) => row.model_profile === profile).length,
    boundary: "Cloudflare account"
  }));
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
    models,
    readiness: [
      { id: "identity", label: "Cloudflare Access trust boundary", ready: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD), detail: env.ACCESS_TEAM_DOMAIN ? "JWT verification configured" : "Access application configuration required" },
      { id: "members", label: "Organization membership and roles", ready: members.results.length > 0, detail: `${members.results.length} active membership records` },
      { id: "releases", label: "Published process releases", ready: processRows.every((row) => Boolean(row.active_release_id)), detail: `${processRows.filter((row) => row.active_release_id).length}/${processRows.length} processes pinned` },
      { id: "connections", label: "Connection secret readiness", ready: requiredConnectionRows.every((row) => Number(row.secret_configured) === 1), detail: `${requiredConnectionRows.filter((row) => Number(row.secret_configured) === 1).length}/${requiredConnectionRows.length} required connections configured` },
      { id: "delivery", label: "Outbound delivery credentials", ready: credentialRows.every((row) => Number(row.configured) === 1), detail: `${credentialRows.filter((row) => Number(row.configured) === 1).length}/${credentialRows.length} Cloudflare secret references ready` },
      { id: "evaluations", label: "Evaluation release gates", ready: evaluationRows.length > 0 && evaluationRows.every((row) => row.status === "passing"), detail: `${evaluationRows.filter((row) => row.status === "passing").length}/${evaluationRows.length} scenarios passing` },
      { id: "retention", label: "Retention and deletion policy", ready: retention.results.length > 0, detail: `${retention.results.length} policies defined` },
      { id: "dlp", label: "Model-boundary DLP policy", ready: dlpRules.results.length === 6,
        detail: `${dlpRules.results.filter((row) => Number((row as Record<string, unknown>).enabled) === 1).length}/6 detectors enabled` },
      { id: "observability", label: "Workers logs and traces", ready: true, detail: "Cloudflare observability enabled" }
    ],
    dataFlow: ["Process input", "Cloudflare Worker", "Durable Agent / Workflow", "Workers AI", "Human checkpoint", "Business outcome"]
  };
}
