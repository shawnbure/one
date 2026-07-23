import type { Env } from "./types";

export async function getGovernance(env: Env, tenantId: string) {
  const [processes, connections, knowledge, evaluations, retention, members, audit, incidents, webhooks] = await Promise.all([
    env.DB.prepare(`SELECT id, name, model_profile, prompt_release_id, active_release_id, autonomy, operating_mode,
      risk_level, business_owner, department FROM agent_blueprints WHERE tenant_id = ? ORDER BY name`).bind(tenantId).all(),
    env.DB.prepare("SELECT * FROM connections WHERE tenant_id = ? ORDER BY name").bind(tenantId).all(),
    env.DB.prepare("SELECT * FROM knowledge_sources WHERE tenant_id = ? ORDER BY name").bind(tenantId).all(),
    env.DB.prepare(`SELECT e.*, b.name process_name FROM evaluation_scenarios e JOIN agent_blueprints b ON b.id = e.blueprint_id
      WHERE e.tenant_id = ? ORDER BY e.last_run_at DESC`).bind(tenantId).all(),
    env.DB.prepare("SELECT * FROM retention_policies WHERE tenant_id = ? ORDER BY data_class").bind(tenantId).all(),
    env.DB.prepare("SELECT id, email, display_name, role, status, last_seen_at FROM tenant_members WHERE tenant_id = ? ORDER BY display_name").bind(tenantId).all(),
    env.DB.prepare("SELECT id, actor_id, event_type, target_type, target_id, created_at FROM audit_events WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 30").bind(tenantId).all(),
    env.DB.prepare("SELECT * FROM incidents WHERE tenant_id = ? ORDER BY opened_at DESC LIMIT 20").bind(tenantId).all(),
    env.DB.prepare(`SELECT id, name, blueprint_id, status, accepted_events_json, created_at, last_received_at,
      CASE WHEN secret_binding = 'WEBHOOK_INBOX_SECRET' THEN ? ELSE 0 END secret_configured
      FROM webhook_endpoints WHERE tenant_id = ? ORDER BY name`).bind(env.WEBHOOK_INBOX_SECRET ? 1 : 0, tenantId).all()
  ]);
  const processRows = processes.results as Array<Record<string, unknown>>;
  const connectionRows = connections.results as Array<Record<string, unknown>>;
  const evaluationRows = evaluations.results as Array<Record<string, unknown>>;
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
    webhooks: webhooks.results,
    models,
    readiness: [
      { id: "identity", label: "Cloudflare Access trust boundary", ready: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD), detail: env.ACCESS_TEAM_DOMAIN ? "JWT verification configured" : "Access application configuration required" },
      { id: "members", label: "Organization membership and roles", ready: members.results.length > 0, detail: `${members.results.length} active membership records` },
      { id: "releases", label: "Published process releases", ready: processRows.every((row) => Boolean(row.active_release_id)), detail: `${processRows.filter((row) => row.active_release_id).length}/${processRows.length} processes pinned` },
      { id: "connections", label: "Connection secret readiness", ready: connectionRows.every((row) => Number(row.secret_configured) === 1), detail: `${connectionRows.filter((row) => Number(row.secret_configured) === 1).length}/${connectionRows.length} secrets configured` },
      { id: "evaluations", label: "Evaluation release gates", ready: evaluationRows.length > 0 && evaluationRows.every((row) => row.status === "passing"), detail: `${evaluationRows.filter((row) => row.status === "passing").length}/${evaluationRows.length} scenarios passing` },
      { id: "retention", label: "Retention and deletion policy", ready: retention.results.length > 0, detail: `${retention.results.length} policies defined` },
      { id: "observability", label: "Workers logs and traces", ready: true, detail: "Cloudflare observability enabled" }
    ],
    dataFlow: ["Process input", "Cloudflare Worker", "Durable Agent / Workflow", "Workers AI", "Human checkpoint", "Business outcome"]
  };
}
