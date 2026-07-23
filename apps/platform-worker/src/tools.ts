import type { ToolPolicy } from "@workrr/contracts";
import { normalizeProcessSchema } from "./contracts";
import { boundAdapterCatalog, isBoundAdapter } from "./tool-adapters";
import type { Env } from "./types";

export interface ToolDefinitionInput {
  name: string;
  description: string;
  adapterKind?: ToolPolicy["adapterKind"];
  handlerKey?: string | null;
  connectionId?: string | null;
  accessMode: ToolPolicy["accessMode"];
  riskLevel: ToolPolicy["riskLevel"];
  inputSchema?: unknown;
  outputSchema?: unknown;
  dataClassification?: ToolPolicy["dataClassification"];
  owner: string;
  rateLimitPerMinute?: number;
  supportInstructions?: string;
  processIds?: string[];
}

export async function listTools(env: Env, tenantId: string) {
  const { results } = await env.DB.prepare(`SELECT t.*, c.name connection_name, c.status connection_status,
    c.secret_configured connection_secret_configured,
    CASE
      WHEN t.handler_key IS NULL THEN 0
      WHEN t.handler_key='microsoft.profile.get' AND c.status='healthy' AND c.secret_configured=1 THEN 1
      WHEN t.handler_key='microsoft.mail.list' AND c.status='healthy' AND c.secret_configured=1
        AND EXISTS (SELECT 1 FROM json_each(c.scopes_json) s WHERE lower(CAST(s.value AS TEXT))='mail.readbasic') THEN 1
      WHEN t.handler_key='microsoft.calendar.list' AND c.status='healthy' AND c.secret_configured=1
        AND EXISTS (SELECT 1 FROM json_each(c.scopes_json) s WHERE lower(CAST(s.value AS TEXT))='calendars.readbasic') THEN 1
      WHEN t.handler_key='microsoft.calendar.event.create' AND c.status='healthy' AND c.secret_configured=1
        AND EXISTS (SELECT 1 FROM json_each(c.scopes_json) s WHERE lower(CAST(s.value AS TEXT))='calendars.readwrite') THEN 1
      ELSE 0
    END handler_ready,
    COALESCE(group_concat(DISTINCT b.name), '') process_names,
    COALESCE(group_concat(DISTINCT b.id), '') process_ids
    FROM tool_definitions t
    LEFT JOIN connections c ON c.id=t.connection_id AND c.tenant_id=t.tenant_id
    LEFT JOIN process_tool_bindings pt ON pt.tool_id=t.id AND pt.tenant_id=t.tenant_id AND pt.enabled=1
    LEFT JOIN agent_blueprints b ON b.id=pt.blueprint_id AND b.tenant_id=pt.tenant_id
    WHERE t.tenant_id=? GROUP BY t.id ORDER BY t.enabled DESC, t.name`)
    .bind(tenantId).all();
  return results;
}

export async function createTool(env: Env, tenantId: string, actorId: string, input: ToolDefinitionInput) {
  const name = input.name.trim().toLowerCase().replaceAll("-", "_");
  if (!/^[a-z][a-z0-9_]{2,63}$/.test(name)) {
    throw new Error("Tool name must use 3–64 lowercase letters, numbers, or underscores");
  }
  const description = input.description.trim();
  if (description.length < 8 || description.length > 500) throw new Error("Tool description must be 8–500 characters");
  const owner = input.owner.trim();
  if (!owner || owner.length > 120) throw new Error("Tool owner is required");
  const adapterKind = input.adapterKind ?? "mock";
  if (!["mock", "http", "microsoft", "database", "import_export"].includes(adapterKind)) throw new Error("Unsupported tool adapter");
  const handlerKey = normalizeHandlerKey(input.handlerKey);
  if (handlerKey && !handlerKey.startsWith(`${adapterKind}.`)) throw new Error("Tool implementation does not match its adapter");
  if (isBoundAdapter(handlerKey) &&
    (input.accessMode !== boundAdapterCatalog[handlerKey].accessMode ||
      input.riskLevel !== boundAdapterCatalog[handlerKey].riskLevel)) {
    throw new Error("Tool access and risk must match the registered implementation");
  }
  if (!["read", "write"].includes(input.accessMode)) throw new Error("Tool access mode must be read or write");
  if (!["low", "medium", "high"].includes(input.riskLevel)) throw new Error("Tool risk level is invalid");
  const classification = input.dataClassification ?? "internal";
  if (!["public", "internal", "confidential", "restricted"].includes(classification)) throw new Error("Data classification is invalid");
  const rateLimit = Math.round(Number(input.rateLimitPerMinute ?? 60));
  if (!Number.isFinite(rateLimit) || rateLimit < 1 || rateLimit > 10_000) throw new Error("Rate limit must be between 1 and 10,000 per minute");
  const inputSchema = normalizeProcessSchema(isBoundAdapter(handlerKey)
    ? boundAdapterCatalog[handlerKey].inputSchema : input.inputSchema ?? defaultSchema, "input")!;
  const outputSchema = normalizeProcessSchema(input.outputSchema ?? defaultSchema, "output")!;
  const processIds = [...new Set(input.processIds ?? [])].slice(0, 50);
  await validateReferences(env, tenantId, input.connectionId ?? null, processIds, handlerKey);
  const id = `tool-${crypto.randomUUID()}`;
  const statements = [
    env.DB.prepare(`INSERT INTO tool_definitions
      (id, tenant_id, name, description, adapter_kind, connection_id, handler_key, access_mode, risk_level,
       input_schema_json, output_schema_json, data_classification, owner, rate_limit_per_minute,
       support_instructions, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, tenantId, name, description, adapterKind, input.connectionId ?? null,
        handlerKey, input.accessMode, input.riskLevel, JSON.stringify(inputSchema), JSON.stringify(outputSchema),
        classification, owner, rateLimit, (input.supportInstructions ?? "").trim().slice(0, 2000), actorId),
    ...processIds.map((processId) => env.DB.prepare(`INSERT INTO process_tool_bindings
      (tenant_id, blueprint_id, tool_id, enabled, created_by) VALUES (?, ?, ?, 1, ?)`)
      .bind(tenantId, processId, id, actorId))
  ];
  await env.DB.batch(statements);
  return { id, name, processCount: processIds.length };
}

export async function setToolBindings(env: Env, tenantId: string, toolId: string, actorId: string, processIds: string[]) {
  const unique = [...new Set(processIds)].slice(0, 50);
  const tool = await env.DB.prepare("SELECT id FROM tool_definitions WHERE id=? AND tenant_id=?")
    .bind(toolId, tenantId).first();
  if (!tool) throw new Error("Tool not found");
  await validateReferences(env, tenantId, null, unique);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM process_tool_bindings WHERE tenant_id=? AND tool_id=?").bind(tenantId, toolId),
    ...unique.map((processId) => env.DB.prepare(`INSERT INTO process_tool_bindings
      (tenant_id, blueprint_id, tool_id, enabled, created_by) VALUES (?, ?, ?, 1, ?)`)
      .bind(tenantId, processId, toolId, actorId))
  ]);
  return { id: toolId, processCount: unique.length };
}

export async function setToolEnabled(env: Env, tenantId: string, toolId: string, enabled: boolean) {
  const result = await env.DB.prepare(`UPDATE tool_definitions SET enabled=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=?`).bind(Number(enabled), toolId, tenantId).run();
  if (result.meta.changes !== 1) throw new Error("Tool not found");
  return { id: toolId, enabled };
}

export async function releaseToolPolicies(env: Env, tenantId: string, blueprintId: string): Promise<ToolPolicy[]> {
  const [native, mcp] = await Promise.all([
  env.DB.prepare(`SELECT t.id, t.name, t.version, t.adapter_kind, t.handler_key, t.access_mode,
    t.risk_level, t.connection_id, t.data_classification, t.rate_limit_per_minute,
    t.input_schema_json, t.output_schema_json, t.description, t.owner, t.support_instructions,
    CASE WHEN t.connection_id IS NULL AND t.adapter_kind='mock' THEN 1
      WHEN t.handler_key='microsoft.profile.get' AND c.status='healthy' AND c.secret_configured=1 THEN 1
      WHEN t.handler_key='microsoft.mail.list' AND c.status='healthy' AND c.secret_configured=1
        AND EXISTS (SELECT 1 FROM json_each(c.scopes_json) s WHERE lower(CAST(s.value AS TEXT))='mail.readbasic') THEN 1
      WHEN t.handler_key='microsoft.calendar.list' AND c.status='healthy' AND c.secret_configured=1
        AND EXISTS (SELECT 1 FROM json_each(c.scopes_json) s WHERE lower(CAST(s.value AS TEXT))='calendars.readbasic') THEN 1
      WHEN t.handler_key='microsoft.calendar.event.create' AND c.status='healthy' AND c.secret_configured=1
        AND EXISTS (SELECT 1 FROM json_each(c.scopes_json) s WHERE lower(CAST(s.value AS TEXT))='calendars.readwrite') THEN 1
      WHEN t.handler_key IS NULL AND c.status='healthy' AND c.secret_configured=1 THEN 1
      ELSE 0 END connection_ready
    FROM process_tool_bindings pt
    JOIN tool_definitions t ON t.id=pt.tool_id AND t.tenant_id=pt.tenant_id
    LEFT JOIN connections c ON c.id=t.connection_id AND c.tenant_id=t.tenant_id
    WHERE pt.tenant_id=? AND pt.blueprint_id=? AND pt.enabled=1 AND t.enabled=1
    ORDER BY t.name`).bind(tenantId, blueprintId).all<Record<string, unknown>>(),
  env.DB.prepare(`SELECT t.id, t.ai_tool_name name, t.revision version, 'mcp' adapter_kind,
    'mcp.' || t.connector_id || '.' || t.ai_tool_name handler_key, t.access_mode, t.risk_level,
    t.connector_id connection_id, t.data_classification, t.rate_limit_per_minute,
    t.input_schema_json, '{"type":"object","additionalProperties":true}' output_schema_json,
    t.description, t.owner, 'Governed MCP connector tool' support_instructions,
    CASE WHEN c.status='ready' AND t.enabled=1 THEN 1 ELSE 0 END connection_ready
    FROM process_mcp_tool_bindings pt
    JOIN mcp_connector_tools t ON t.id=pt.mcp_tool_id AND t.tenant_id=pt.tenant_id
    JOIN mcp_connectors c ON c.id=t.connector_id AND c.tenant_id=t.tenant_id
    WHERE pt.tenant_id=? AND pt.blueprint_id=? AND pt.enabled=1 AND t.enabled=1
    ORDER BY t.title`).bind(tenantId, blueprintId).all<Record<string, unknown>>()
  ]);
  return [...native.results, ...mcp.results].slice(0, 20).map((row) => ({
    id: String(row.id), name: String(row.name), version: Number(row.version),
    adapterKind: row.adapter_kind as ToolPolicy["adapterKind"],
    handlerKey: row.handler_key ? String(row.handler_key) : null,
    accessMode: row.access_mode as ToolPolicy["accessMode"],
    riskLevel: row.risk_level as ToolPolicy["riskLevel"],
    connectionId: row.connection_id ? String(row.connection_id) : null,
    connectionReady: Boolean(row.connection_ready),
    dataClassification: row.data_classification as ToolPolicy["dataClassification"],
    rateLimitPerMinute: Number(row.rate_limit_per_minute),
    inputSchemaJson: String(row.input_schema_json),
    outputSchemaJson: String(row.output_schema_json),
    description: String(row.description),
    owner: String(row.owner),
    supportInstructions: String(row.support_instructions ?? "")
  }));
}

export async function ensureTemplateTools(env: Env, tenantId: string, blueprintId: string,
  actorId: string, owner: string, names: string[]) {
  for (const rawName of [...new Set(names)].slice(0, 50)) {
    const name = rawName.trim().toLowerCase().replaceAll("-", "_");
    if (!/^[a-z][a-z0-9_]{2,63}$/.test(name)) continue;
    const write = /^(create|update|send|delete|approve)_/.test(name);
    await env.DB.prepare(`INSERT OR IGNORE INTO tool_definitions
      (id, tenant_id, name, description, adapter_kind, access_mode, risk_level, owner, created_by)
      VALUES (?, ?, ?, ?, 'mock', ?, ?, ?, ?)`)
      .bind(`tool-${crypto.randomUUID()}`, tenantId, name,
        `Template capability for ${name.replaceAll("_", " ")}`, write ? "write" : "read",
        write ? "medium" : "low", owner || "Operations", actorId).run();
    await env.DB.prepare(`INSERT OR IGNORE INTO process_tool_bindings
      (tenant_id, blueprint_id, tool_id, enabled, created_by)
      SELECT ?, ?, id, 1, ? FROM tool_definitions WHERE tenant_id=? AND name=?`)
      .bind(tenantId, blueprintId, actorId, tenantId, name).run();
  }
}

export async function ensurePortableTools(env: Env, tenantId: string, blueprintId: string,
  actorId: string, policies: ToolPolicy[]) {
  for (const policy of policies.slice(0, 50)) {
    const inputSchema = normalizeProcessSchema(policy.inputSchemaJson, "input")!;
    const outputSchema = normalizeProcessSchema(policy.outputSchemaJson, "output")!;
    await env.DB.prepare(`INSERT OR IGNORE INTO tool_definitions
      (id, tenant_id, name, description, version, adapter_kind, connection_id, handler_key, access_mode, risk_level,
       input_schema_json, output_schema_json, data_classification, owner, rate_limit_per_minute,
       support_instructions, enabled, created_by)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .bind(`tool-${crypto.randomUUID()}`, tenantId, policy.name,
        (policy.description || `Imported capability for ${policy.name.replaceAll("_", " ")}`).slice(0, 500),
        Math.max(1, Math.round(policy.version)), policy.adapterKind, normalizeHandlerKey(policy.handlerKey),
        policy.accessMode, policy.riskLevel,
        JSON.stringify(inputSchema), JSON.stringify(outputSchema), policy.dataClassification,
        (policy.owner || "Unassigned").slice(0, 120), policy.rateLimitPerMinute,
        (policy.supportInstructions || "").slice(0, 2000), actorId).run();
    await env.DB.prepare(`INSERT OR IGNORE INTO process_tool_bindings
      (tenant_id, blueprint_id, tool_id, enabled, created_by)
      SELECT ?, ?, id, 1, ? FROM tool_definitions WHERE tenant_id=? AND name=?`)
      .bind(tenantId, blueprintId, actorId, tenantId, policy.name).run();
  }
}

async function validateReferences(env: Env, tenantId: string, connectionId: string | null, processIds: string[],
  handlerKey: string | null = null) {
  if (handlerKey && !connectionId) throw new Error("A bound implementation requires a connection");
  if (connectionId) {
    const connection = await env.DB.prepare("SELECT id, kind, name FROM connections WHERE id=? AND tenant_id=?")
      .bind(connectionId, tenantId).first<{ id: string; kind: string; name: string }>();
    if (!connection) throw new Error("Connection not found");
    if (handlerKey?.startsWith("microsoft.") &&
      (connection.kind !== "oauth" || connection.name !== "Microsoft 365")) {
      throw new Error("Microsoft implementations require the tenant Microsoft 365 connection");
    }
  }
  if (processIds.length) {
    const placeholders = processIds.map(() => "?").join(",");
    const count = await env.DB.prepare(`SELECT COUNT(*) count FROM agent_blueprints
      WHERE tenant_id=? AND id IN (${placeholders})`).bind(tenantId, ...processIds).first<{ count: number }>();
    if (Number(count?.count) !== processIds.length) throw new Error("One or more processes were not found");
  }
}

const defaultSchema = { type: "object", additionalProperties: true };

function normalizeHandlerKey(value: string | null | undefined) {
  const key = value?.trim() || null;
  if (key && !["microsoft.profile.get", "microsoft.mail.list", "microsoft.calendar.list",
    "microsoft.calendar.event.create"].includes(key)) {
    throw new Error("Unsupported tool implementation");
  }
  return key;
}
