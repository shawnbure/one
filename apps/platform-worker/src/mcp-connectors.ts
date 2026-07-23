import { getAgentByName } from "agents";
import { normalizeProcessSchema } from "./contracts";
import type { McpConnectorAgent } from "./mcp-connector-agent";
import type { Env } from "./types";

export interface McpConnectorInput {
  name?: string;
  serverUrl?: string;
  transport?: "streamable-http" | "sse" | "auto";
}

export async function listMcpConnectors(env: Env, tenantId: string) {
  const [connectors, tools] = await Promise.all([
    env.DB.prepare(`SELECT id, name, server_url, transport, status, tool_count,
      last_discovered_at, last_error, revision, created_at, updated_at
      FROM mcp_connectors WHERE tenant_id=? ORDER BY name`).bind(tenantId).all(),
    env.DB.prepare(`SELECT t.id, t.connector_id, t.server_tool_name, t.ai_tool_name, t.title,
      t.description, t.input_schema_json, t.access_mode, t.risk_level, t.data_classification,
      t.owner, t.rate_limit_per_minute, t.enabled, t.revision,
      COALESCE(group_concat(DISTINCT b.id), '') process_ids,
      COALESCE(group_concat(DISTINCT b.name), '') process_names
      FROM mcp_connector_tools t
      LEFT JOIN process_mcp_tool_bindings pt ON pt.mcp_tool_id=t.id
        AND pt.tenant_id=t.tenant_id AND pt.enabled=1
      LEFT JOIN agent_blueprints b ON b.id=pt.blueprint_id AND b.tenant_id=pt.tenant_id
      WHERE t.tenant_id=? GROUP BY t.id ORDER BY t.title`).bind(tenantId).all()
  ]);
  return { connectors: connectors.results, tools: tools.results };
}

export async function createMcpConnector(
  env: Env, tenantId: string, actorId: string, input: McpConnectorInput
) {
  const name = String(input.name ?? "").trim().replace(/\s+/g, " ");
  if (name.length < 3 || name.length > 80) throw new Error("MCP connector name must be 3 to 80 characters");
  const serverUrl = normalizeMcpUrl(input.serverUrl);
  const transport = input.transport ?? "streamable-http";
  if (!["streamable-http", "sse", "auto"].includes(transport)) throw new Error("MCP transport is invalid");
  const id = `mcp-${crypto.randomUUID()}`;
  await env.DB.prepare(`INSERT INTO mcp_connectors
    (id, tenant_id, name, server_url, transport, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, tenantId, name, serverUrl, transport, actorId).run();
  return { id, name, serverUrl, transport, status: "disabled", revision: 1 };
}

export async function connectMcpConnector(env: Env, tenantId: string, connectorId: string) {
  const connector = await connectorRow(env, tenantId, connectorId);
  const actor = await connectorActor(env, tenantId, connectorId);
  await env.DB.prepare(`UPDATE mcp_connectors SET status='connecting', last_error=NULL,
    updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`).bind(connectorId, tenantId).run();
  try {
    const result = await actor.configureConnector({
      tenantId, connectorId, name: connector.name, url: connector.server_url,
      transport: connector.transport, callbackHost: `https://${env.APP_DOMAIN}`
    });
    const oauthStateHash = result.state === "authenticating"
      ? await hashOAuthState(result.authUrl) : null;
    await env.DB.prepare(`UPDATE mcp_connectors SET status=?, oauth_state_hash=?,
      last_error=NULL, revision=revision+1, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=?`).bind(
        result.state === "ready" ? "ready" : "authenticating", oauthStateHash, connectorId, tenantId
      ).run();
    if (result.state === "ready") await discoverMcpTools(env, tenantId, connectorId);
    return {
      id: connectorId, status: result.state,
      authUrl: result.state === "authenticating" ? result.authUrl : null
    };
  } catch (error) {
    await env.DB.prepare(`UPDATE mcp_connectors SET status='attention', last_error=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
      .bind(safeError(error), connectorId, tenantId).run();
    throw error;
  }
}

export async function completeMcpOAuthCallback(env: Env, request: Request) {
  const state = new URL(request.url).searchParams.get("state");
  if (!state) throw new Error("MCP OAuth state is required");
  const stateHash = await sha256(state);
  const connector = await env.DB.prepare(`SELECT id, tenant_id FROM mcp_connectors
    WHERE oauth_state_hash=? AND updated_at >= datetime('now', '-20 minutes')`)
    .bind(stateHash).first<{ id: string; tenant_id: string }>();
  if (!connector) throw new Error("MCP OAuth state is invalid or expired");
  const actor = await connectorActor(env, connector.tenant_id, connector.id);
  const response = await actor.fetch(request);
  const inspection = await actor.inspectConnector(connector.tenant_id, connector.id);
  const server = inspection.servers[0];
  if (server?.state === "ready") {
    await env.DB.prepare(`UPDATE mcp_connectors SET oauth_state_hash=NULL, status='ready',
      last_error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
      .bind(connector.id, connector.tenant_id).run();
    await discoverMcpTools(env, connector.tenant_id, connector.id);
  } else {
    await env.DB.prepare(`UPDATE mcp_connectors SET oauth_state_hash=NULL, status='attention',
      last_error=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
      .bind(server?.error ?? "MCP authorization did not establish a ready connection",
        connector.id, connector.tenant_id).run();
  }
  return response;
}

export async function discoverMcpTools(env: Env, tenantId: string, connectorId: string) {
  await connectorRow(env, tenantId, connectorId);
  const actor = await connectorActor(env, tenantId, connectorId);
  const state = await actor.inspectConnector(tenantId, connectorId);
  const server = state.servers[0];
  if (!server || server.state !== "ready") {
    const detail = server?.error || `Connector state is ${server?.state ?? "unavailable"}`;
    await env.DB.prepare(`UPDATE mcp_connectors SET status='attention', last_error=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
      .bind(detail, connectorId, tenantId).run();
    throw new Error(detail);
  }
  const tools = state.tools.slice(0, 50).map((tool) => ({
    ...tool,
    inputSchema: normalizeExternalSchema(parseJson(tool.inputSchemaJson))
  }));
  const toolRows = await Promise.all(tools.map(async (tool) => ({
    ...tool, id: `mcp-tool-${await sha256(`${connectorId}:${tool.name}`)}`
  })));
  await env.DB.batch([
    ...toolRows.map((tool) => env.DB.prepare(`INSERT INTO mcp_connector_tools
      (id, tenant_id, connector_id, server_tool_name, ai_tool_name, title, description, input_schema_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, connector_id, server_tool_name) DO UPDATE SET
        ai_tool_name=excluded.ai_tool_name, title=excluded.title, description=excluded.description,
        input_schema_json=excluded.input_schema_json, discovered_at=CURRENT_TIMESTAMP,
        revision=mcp_connector_tools.revision+1, updated_at=CURRENT_TIMESTAMP`)
      .bind(tool.id, tenantId, connectorId,
        tool.name, tool.aiToolName, tool.title, tool.description, JSON.stringify(tool.inputSchema))),
    env.DB.prepare(`UPDATE mcp_connectors SET status='ready', tool_count=?,
      last_discovered_at=CURRENT_TIMESTAMP, last_error=NULL, revision=revision+1,
      updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
      .bind(tools.length, connectorId, tenantId)
  ]);
  return { id: connectorId, status: "ready", toolCount: tools.length };
}

export async function governMcpTool(env: Env, tenantId: string, actorId: string, toolId: string, input: {
  enabled?: boolean; accessMode?: "read" | "write"; riskLevel?: "low" | "medium" | "high";
  dataClassification?: "public" | "internal" | "confidential" | "restricted";
  owner?: string; rateLimitPerMinute?: number; processIds?: string[]; expectedRevision?: number;
}) {
  const current = await env.DB.prepare(`SELECT id, revision FROM mcp_connector_tools
    WHERE id=? AND tenant_id=?`).bind(toolId, tenantId).first<{ id: string; revision: number }>();
  if (!current) throw new Error("MCP tool was not found");
  if (input.expectedRevision !== current.revision) throw new Error("MCP tool changed; refresh before saving");
  const owner = String(input.owner ?? "").trim();
  const rate = Math.round(Number(input.rateLimitPerMinute ?? 30));
  if (!owner || owner.length > 120 || !Number.isFinite(rate) || rate < 1 || rate > 1000) {
    throw new Error("MCP tool requires an owner and a rate limit from 1 to 1,000");
  }
  if (!["read", "write"].includes(String(input.accessMode)) ||
    !["low", "medium", "high"].includes(String(input.riskLevel)) ||
    !["public", "internal", "confidential", "restricted"].includes(String(input.dataClassification))) {
    throw new Error("MCP tool governance is incomplete");
  }
  const processIds = [...new Set(input.processIds ?? [])].slice(0, 50);
  if (processIds.length) {
    const placeholders = processIds.map(() => "?").join(",");
    const count = await env.DB.prepare(`SELECT COUNT(*) count FROM agent_blueprints
      WHERE tenant_id=? AND id IN (${placeholders})`).bind(tenantId, ...processIds)
      .first<{ count: number }>();
    if (Number(count?.count ?? 0) !== processIds.length) throw new Error("One or more processes were not found");
  }
  const result = await env.DB.prepare(`UPDATE mcp_connector_tools SET enabled=?, access_mode=?,
    risk_level=?, data_classification=?, owner=?, rate_limit_per_minute=?,
    revision=revision+1, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND revision=?`).bind(
      input.enabled ? 1 : 0, input.accessMode, input.riskLevel, input.dataClassification,
      owner, rate, toolId, tenantId, current.revision
    ).run();
  if (result.meta.changes !== 1) throw new Error("MCP tool changed; refresh before saving");
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM process_mcp_tool_bindings
      WHERE tenant_id=? AND mcp_tool_id=?`).bind(tenantId, toolId),
    ...processIds.map((processId) => env.DB.prepare(`INSERT INTO process_mcp_tool_bindings
      (tenant_id, blueprint_id, mcp_tool_id, created_by) VALUES (?, ?, ?, ?)`)
      .bind(tenantId, processId, toolId, actorId))
  ]);
  return { id: toolId, enabled: Boolean(input.enabled), processCount: processIds.length,
    revision: current.revision + 1 };
}

export async function invokeMcpConnectorTool(
  env: Env, tenantId: string, connectorId: string, aiToolName: string, input: unknown
) {
  const actor = await connectorActor(env, tenantId, connectorId);
  const resultJson = await actor.invokeConnectorTool(
    tenantId, connectorId, aiToolName, JSON.stringify(input ?? {})
  );
  return parseJson(resultJson);
}

async function connectorActor(env: Env, tenantId: string, connectorId: string) {
  return getAgentByName<Env, McpConnectorAgent>(env.MCP_CONNECTOR, `${tenantId}/${connectorId}`);
}

async function connectorRow(env: Env, tenantId: string, connectorId: string) {
  const connector = await env.DB.prepare(`SELECT id, name, server_url, transport, status
    FROM mcp_connectors WHERE id=? AND tenant_id=?`).bind(connectorId, tenantId)
    .first<{ id: string; name: string; server_url: string;
      transport: "streamable-http" | "sse" | "auto"; status: string }>();
  if (!connector) throw new Error("MCP connector was not found");
  return connector;
}

function normalizeMcpUrl(value: unknown) {
  let url: URL;
  try { url = new URL(String(value ?? "")); }
  catch { throw new Error("MCP server URL is invalid"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("MCP server must use HTTPS without embedded credentials or fragments");
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") ||
    /^(?:10|127|169\.254|192\.168)\./.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
    host === "metadata.google.internal") {
    throw new Error("MCP server URL cannot target a private or metadata address");
  }
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeExternalSchema(value: unknown) {
  try { return normalizeProcessSchema(value, "input") ?? { type: "object", additionalProperties: true }; }
  catch { return { type: "object", additionalProperties: true }; }
}

function parseJson(value: string) {
  try { return JSON.parse(value) as unknown; }
  catch { return null; }
}

async function hashOAuthState(authUrl: string) {
  const state = new URL(authUrl).searchParams.get("state");
  if (!state) throw new Error("MCP OAuth provider did not return state");
  return sha256(state);
}

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/gi, "[url]").replace(/[A-Za-z0-9_-]{40,}/g, "[redacted]").slice(0, 300);
}
