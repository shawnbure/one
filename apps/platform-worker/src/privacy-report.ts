import type { Env } from "./types";

type Row = Record<string, unknown>;

export interface PrivacyArchitectureReport {
  schema: "workrr-privacy-architecture/v1";
  generatedAt: string;
  generatedBy: string;
  organization: { id: string; name: string; environment: string; identityBoundary: string; supportAccess: string };
  posture: string[];
  services: Array<{ service: string; purpose: string; data: string; boundary: string }>;
  processes: Row[];
  dataSources: { knowledge: Row[]; inboundWebhooks: Row[]; inboundEmail: Row[] };
  storageAndRetention: Array<{ store: string; content: string; retention: string; deletion: string }>;
  models: Array<{ profile: string; modelId: string; provider: string; processes: number }>;
  externalDestinations: Row[];
  credentials: Row[];
  tools: Row[];
  dataEgressPolicies?: Row[];
  humanOversight: { pendingDecisions: number; consequentialActions: number; processPolicies: Row[] };
  loggingAndExport: string[];
  releaseInventory: Row[];
  governanceReviews: Row[];
  readiness: Array<{ id: string; label: string; ready: boolean; detail: string }>;
  subprocessors: Array<{ provider: string; purpose: string; enabledBy: string }>;
  limitations: string[];
}

export async function getPrivacyArchitectureReport(env: Env, tenantId: string, generatedBy: string,
  readiness: PrivacyArchitectureReport["readiness"]): Promise<PrivacyArchitectureReport> {
  const [tenant, processes, knowledge, webhooks, emailRoutes, retention, connections, tools, notifications, approvals,
    governanceReviews, dataEgressPolicies] =
    await Promise.all([
      env.DB.prepare("SELECT id, name FROM tenants WHERE id=?").bind(tenantId).first<Row>(),
      env.DB.prepare(`SELECT b.id, b.name, b.department, b.business_owner, b.risk_level, b.status,
        b.execution_profile, b.autonomy, b.operating_mode, b.model_profile, b.prompt_release_id,
        b.active_release_id, COALESCE(r.data_classification,b.data_classification,'internal') data_classification, r.model_id
        FROM agent_blueprints b LEFT JOIN process_releases r
          ON r.id=b.active_release_id AND r.tenant_id=b.tenant_id
        WHERE b.tenant_id=? ORDER BY b.name`).bind(tenantId).all<Row>(),
      env.DB.prepare(`SELECT name, source_type, owner, sensitivity, status, provenance,
        allowed_processes_json, reviewed_at, expires_at FROM knowledge_sources
        WHERE tenant_id=? ORDER BY name`).bind(tenantId).all<Row>(),
      env.DB.prepare(`SELECT name, status, accepted_events_json, blueprint_id, last_received_at,
        CASE WHEN secret_binding IS NOT NULL THEN 1 ELSE 0 END signature_required
        FROM webhook_endpoints WHERE tenant_id=? ORDER BY name`).bind(tenantId).all<Row>(),
      env.DB.prepare(`SELECT r.name, r.address, r.status, r.blueprint_id, b.execution_profile,
        r.allowed_sender_domains_json, r.last_received_at
        FROM inbound_email_routes r JOIN agent_blueprints b
          ON b.id=r.blueprint_id AND b.tenant_id=r.tenant_id
        WHERE r.tenant_id=? ORDER BY r.name`).bind(tenantId).all<Row>(),
      env.DB.prepare(`SELECT name, data_class, retention_days, deletion_mode
        FROM retention_policies WHERE tenant_id=? ORDER BY data_class`).bind(tenantId).all<Row>(),
      env.DB.prepare(`SELECT name, kind, owner, status, access_mode, scopes_json,
        CASE WHEN secret_configured=1 THEN 'configured' ELSE 'required' END credential_status,
        last_checked_at FROM connections WHERE tenant_id=? ORDER BY name`).bind(tenantId).all<Row>(),
      env.DB.prepare(`SELECT t.name, t.adapter_kind, t.access_mode, t.risk_level, t.data_classification,
        t.owner, t.rate_limit_per_minute, t.enabled, c.name connection_name,
        COALESCE(group_concat(DISTINCT b.name), '') process_names
        FROM tool_definitions t
        LEFT JOIN connections c ON c.id=t.connection_id AND c.tenant_id=t.tenant_id
        LEFT JOIN process_tool_bindings pt ON pt.tool_id=t.id AND pt.tenant_id=t.tenant_id AND pt.enabled=1
        LEFT JOIN agent_blueprints b ON b.id=pt.blueprint_id AND b.tenant_id=pt.tenant_id
        WHERE t.tenant_id=? GROUP BY t.id ORDER BY t.name`).bind(tenantId).all<Row>(),
      env.DB.prepare(`SELECT event_type, channel, destination, enabled, severity
        FROM notification_policies WHERE tenant_id=? ORDER BY channel, event_type`).bind(tenantId).all<Row>(),
      env.DB.prepare(`SELECT status, COUNT(*) count FROM approvals WHERE tenant_id=? GROUP BY status`)
        .bind(tenantId).all<Row>(),
      env.DB.prepare(`SELECT name, cadence_days, next_due_at, last_completed_at,
        last_completed_by, evidence_reference,
        CASE WHEN julianday(next_due_at) < julianday('now') THEN 'overdue'
          WHEN julianday(next_due_at) <= julianday('now', '+14 days') THEN 'due'
          ELSE 'current' END status
        FROM tenant_governance_reviews WHERE tenant_id=? ORDER BY name`).bind(tenantId).all<Row>(),
      env.DB.prepare(`SELECT classification, external_model_allowed, external_tool_allowed,
        revision, updated_by, updated_at FROM tenant_data_egress_policies
        WHERE tenant_id=? ORDER BY CASE classification
          WHEN 'public' THEN 1 WHEN 'internal' THEN 2 WHEN 'confidential' THEN 3 ELSE 4 END`)
        .bind(tenantId).all<Row>()
    ]);
  const processRows = processes.results;
  const connectionRows = connections.results;
  const notificationRows = notifications.results;
  const modelProfiles = [...new Set(processRows.map((row) =>
    `${String(row.model_profile)}\u0000${String(row.model_id ?? "Legacy profile mapping")}`))];
  const pendingDecisions = Number(approvals.results.find((row) => row.status === "pending")?.count ?? 0);
  const consequentialActions = tools.results.filter((row) => row.access_mode === "write" && Number(row.enabled)).length;
  const externalDestinations = [
    ...notificationRows.filter((row) =>
      Number(row.enabled) && row.channel !== "in_app" && Boolean(row.destination)).map((row) => ({
      system: row.channel, purpose: row.event_type, destination: row.destination,
      status: "enabled", control: "Notification policy"
    })),
    ...connectionRows.filter((row) =>
      row.kind !== "model_provider" && row.status !== "disconnected").map((row) => ({
      system: row.name, purpose: row.kind, destination: "Provider-managed fixed endpoint",
      status: row.status, control: `${row.access_mode} · ${display(safeJson(row.scopes_json))}`
    }))
  ];
  const hasMicrosoft = connectionRows.some((row) =>
    String(row.kind).toLowerCase().includes("oauth") || String(row.name).toLowerCase().includes("microsoft"));
  return {
    schema: "workrr-privacy-architecture/v1",
    generatedAt: new Date().toISOString(),
    generatedBy,
    organization: {
      id: tenantId,
      name: String(tenant?.name ?? tenantId),
      environment: env.ENVIRONMENT,
      identityBoundary: env.ACCESS_TEAM_DOMAIN || "Cloudflare Access configuration required",
      supportAccess: "Only active tenant members and explicitly registered tenant-scoped service principals."
    },
    posture: [
      "Customer-dedicated Cloudflare deployment with tenant-scoped storage and authorization.",
      "Workers AI is the default inference provider; model profiles are explicitly inventoried below.",
      "Secrets remain Cloudflare bindings or encrypted delegated credentials and are never included in this report.",
      "Consequential external actions are policy-bound, attributable, and human-governed."
    ],
    services: [
      { service: "Cloudflare Workers", purpose: "Authenticated API, policy, and request routing",
        data: "Bounded request and response previews", boundary: "Customer Cloudflare account" },
      { service: "Cloudflare Durable Objects / Agents SDK", purpose: "Sticky conversation actors",
        data: "Thread messages and release-pinned actor state", boundary: "Per derived actor identity" },
      { service: "Cloudflare D1", purpose: "Control-plane configuration and searchable evidence",
        data: "Processes, releases, approvals, run summaries, audit", boundary: "Tenant-scoped queries" },
      { service: "Cloudflare R2 / Vectorize", purpose: "Governed knowledge and retrieval",
        data: "Approved source objects, chunks, embeddings, provenance", boundary: "Tenant metadata filters" },
      { service: "Cloudflare Queues / Workflows", purpose: "Recoverable asynchronous orchestration",
        data: "Identifiers and bounded process inputs", boundary: "Deployment-scoped bindings" },
      { service: "Cloudflare Workers AI", purpose: "Model inference",
        data: "DLP-processed prompt context", boundary: "Cloudflare account binding" }
    ],
    processes: processRows.map((row) => ({
      name: row.name, department: row.department, businessOwner: row.business_owner, risk: row.risk_level,
      status: row.status, executionProfile: row.execution_profile, autonomy: row.autonomy,
      operatingMode: row.operating_mode, dataClassification: row.data_classification
    })),
    dataSources: {
      knowledge: knowledge.results, inboundWebhooks: webhooks.results, inboundEmail: emailRoutes.results
    },
    storageAndRetention: [
      ...retention.results.map((row) => ({
        store: "Policy-defined tenant data", content: String(row.data_class),
        retention: `${row.retention_days} days`, deletion: String(row.deletion_mode)
      })),
      { store: "Durable Object SQLite", content: "Sticky conversation messages, approved provenance-bearing actor facts, and agent-local release bundle",
        retention: "Thread/process policy", deletion: "Actor-scoped administrative deletion" },
      { store: "R2 and Vectorize", content: "Governed knowledge objects, chunks, and embeddings",
        retention: "Source review and expiry policy", deletion: "Source removal deletes object, vectors, and metadata" }
    ],
    models: modelProfiles.map((key) => {
      const [profile, modelId] = key.split("\u0000");
      return { profile: profile!, modelId: modelId!, provider: "Cloudflare Workers AI",
        processes: processRows.filter((row) =>
          String(row.model_profile) === profile && String(row.model_id ?? "Legacy profile mapping") === modelId).length };
    }),
    externalDestinations,
    credentials: connectionRows.map((row) => ({
      system: row.name, owner: row.owner, access: row.access_mode, scopes: safeJson(row.scopes_json),
      status: row.status, credential: row.credential_status
    })),
    tools: tools.results,
    dataEgressPolicies: dataEgressPolicies.results.map((row) => ({
      dataClassification: row.classification,
      externalModelHandoff: Number(row.external_model_allowed) ? "Allowed" : "Blocked",
      externalToolEgress: Number(row.external_tool_allowed) ? "Allowed" : "Blocked",
      revision: row.revision, updatedBy: row.updated_by, updatedAt: row.updated_at
    })),
    humanOversight: {
      pendingDecisions, consequentialActions,
      processPolicies: processRows.map((row) => ({
        process: row.name, autonomy: row.autonomy, operatingMode: row.operating_mode, owner: row.business_owner
      }))
    },
    loggingAndExport: [
      "Administrative changes and consequential actions are written to the tenant audit timeline.",
      "Inbound and outbound API metadata is correlated without storing credential values.",
      "Execution evidence stores bounded previews, release IDs, policy snapshots, usage, and terminal status.",
      "Governance JSON, process packages, evaluation datasets, and this report are downloadable by authorized roles."
    ],
    releaseInventory: processRows.map((row) => ({
      process: row.name, promptRelease: row.prompt_release_id, processRelease: row.active_release_id,
      modelProfile: row.model_profile, dataClassification: row.data_classification
    })),
    governanceReviews: governanceReviews.results,
    readiness,
    subprocessors: [
      { provider: "Cloudflare", purpose: "Application runtime, storage, orchestration, security, and default inference",
        enabledBy: "Platform deployment" },
      ...(hasMicrosoft ? [{ provider: "Microsoft", purpose: "Explicitly connected Microsoft 365 reads, notifications, or approved actions",
        enabledBy: "Delegated tenant connection and selected scopes" }] : [])
    ],
    limitations: [
      "This generated report describes configured application controls; it is not legal advice or a compliance certification.",
      "Customer-specific support access, contractual terms, and data residency commitments must be documented separately.",
      "Connection health and readiness are point-in-time evidence as of the generation timestamp."
    ]
  };
}

export function renderPrivacyArchitectureHtml(report: PrivacyArchitectureReport): string {
  const section = (title: string, body: string) => `<section><h2>${escapeHtml(title)}</h2>${body}</section>`;
  const rows = (items: Row[]) => items.length
    ? `<table><thead><tr>${Object.keys(items[0]!).map((key) => `<th>${escapeHtml(label(key))}</th>`).join("")}</tr></thead><tbody>${
      items.map((item) => `<tr>${Object.values(item).map((value) => `<td>${escapeHtml(display(value))}</td>`).join("")}</tr>`).join("")
    }</tbody></table>` : "<p class=\"empty\">None configured.</p>";
  const list = (items: string[]) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Privacy &amp; Architecture Summary — ${escapeHtml(report.organization.name)}</title><style>
body{margin:0;background:#f4f6f4;color:#17231e;font:14px/1.55 system-ui,-apple-system,sans-serif}main{max-width:1040px;margin:auto;padding:48px 28px}
header,section{margin-bottom:18px;padding:26px;background:#fff;border:1px solid #dfe6e2;border-radius:12px}header{background:#102019;color:#fff}
h1{margin:8px 0;font-size:30px}h2{margin:0 0 14px;font-size:18px}p{margin:5px 0}.eyebrow{color:#86c4aa;font-size:11px;font-weight:800;letter-spacing:.14em}
.meta{display:flex;gap:24px;flex-wrap:wrap;color:#c2d3cb}.posture{display:grid;grid-template-columns:1fr 1fr;gap:10px}.posture div{padding:14px;background:#edf6f1;border-radius:8px}
table{width:100%;border-collapse:collapse;display:block;overflow:auto}th,td{padding:9px;text-align:left;vertical-align:top;border-bottom:1px solid #e5ebe8;white-space:normal}
th{color:#53655d;font-size:11px;text-transform:uppercase}ul{padding-left:20px}.empty{color:#697870}footer{padding:12px;color:#66736d;font-size:12px}
@media(max-width:700px){main{padding:18px 10px}.posture{grid-template-columns:1fr}header,section{padding:18px}}@media print{body{background:#fff}main{max-width:none;padding:0}header,section{break-inside:avoid;border-color:#ccd5d0}}
</style></head><body><main><header><div class="eyebrow">WORKRR ONE · PRIVATE AI OPERATIONS</div>
<h1>Privacy &amp; Architecture Summary</h1><p>${escapeHtml(report.organization.name)} · ${escapeHtml(report.organization.environment)}</p>
<div class="meta"><span>Generated ${escapeHtml(report.generatedAt)}</span><span>By ${escapeHtml(report.generatedBy)}</span></div></header>
${section("Operating posture", `<div class="posture">${report.posture.map((item) => `<div>${escapeHtml(item)}</div>`).join("")}</div>`)}
${section("Cloudflare architecture", rows(report.services))}
${section("AI processes and human oversight", rows(report.processes) + `<p><strong>${report.humanOversight.pendingDecisions}</strong> pending decisions · <strong>${report.humanOversight.consequentialActions}</strong> enabled write tools</p>`)}
${section("Models", rows(report.models))}
${section("Classification and external egress", rows(report.dataEgressPolicies ?? []))}
${section("Data sources", "<h3>Knowledge</h3>" + rows(report.dataSources.knowledge) +
  "<h3>Inbound webhooks</h3>" + rows(report.dataSources.inboundWebhooks) +
  "<h3>Inbound email</h3>" + rows(report.dataSources.inboundEmail))}
${section("Storage, retention, and deletion", rows(report.storageAndRetention))}
${section("Connections and credential scopes", rows(report.credentials))}
${section("External destinations", rows(report.externalDestinations))}
${section("Typed tool boundary", rows(report.tools))}
${section("Release inventory", rows(report.releaseInventory))}
${section("Periodic governance reviews", rows(report.governanceReviews))}
${section("Logging and export behavior", list(report.loggingAndExport))}
${section("Subprocessors and platform services", rows(report.subprocessors))}
${section("Deployment readiness", rows(report.readiness.map((item) => ({ control: item.label, ready: item.ready ? "Ready" : "Needs attention", detail: item.detail }))))}
${section("Important limitations", list(report.limitations))}
<footer>Report schema ${escapeHtml(report.schema)} · No credential or secret values are included.</footer></main></body></html>`;
}

function safeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return []; }
}
function display(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.map(display).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
function label(value: string): string {
  return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!);
}
