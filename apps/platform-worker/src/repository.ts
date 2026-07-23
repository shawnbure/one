import type { AgentBlueprint, PromptBundle } from "@workrr/contracts";
import type { BlueprintRow, Env, PromptRow } from "./types";
import { cappedAutonomy } from "./autonomy-safety";

export async function getBlueprint(env: Env, tenantId: string, id: string): Promise<AgentBlueprint | null> {
  return getBlueprintRow(env, tenantId, id, {});
}

export async function getBlueprintForRelease(env: Env, tenantId: string, id: string, releaseId: string):
Promise<AgentBlueprint | null> {
  return getBlueprintRow(env, tenantId, id, { processReleaseId: releaseId });
}

export async function getBlueprintForPromptRelease(env: Env, tenantId: string, id: string, promptReleaseId: string):
Promise<AgentBlueprint | null> {
  return getBlueprintRow(env, tenantId, id, { promptReleaseId });
}

async function getBlueprintRow(env: Env, tenantId: string, id: string,
  selector: { processReleaseId?: string; promptReleaseId?: string }):
Promise<AgentBlueprint | null> {
  const releaseJoin = selector.processReleaseId
    ? "JOIN process_releases r ON r.id=? AND r.blueprint_id=b.id AND r.tenant_id=b.tenant_id"
    : selector.promptReleaseId
      ? "JOIN process_releases r ON r.prompt_release_id=? AND r.blueprint_id=b.id AND r.tenant_id=b.tenant_id"
      : "LEFT JOIN process_releases r ON r.id=b.active_release_id AND r.tenant_id=b.tenant_id";
  const statement = env.DB.prepare(`SELECT b.*, r.id resolved_release_id, r.prompt_release_id resolved_prompt_release_id,
    r.model_profile resolved_model_profile, r.autonomy resolved_autonomy,
    r.model_id, r.input_schema_json, r.output_schema_json,
    COALESCE((SELECT json_group_array(json_set(policy.value, '$.connectionReady',
      CASE
        WHEN json_extract(policy.value, '$.adapterKind')='mock'
          AND json_extract(policy.value, '$.connectionId') IS NULL THEN 1
        WHEN json_extract(policy.value, '$.handlerKey')='microsoft.profile.get'
          AND c.status='healthy' AND c.secret_configured=1 THEN 1
        WHEN json_extract(policy.value, '$.handlerKey')='microsoft.mail.list'
          AND c.status='healthy' AND c.secret_configured=1
          AND EXISTS (SELECT 1 FROM json_each(c.scopes_json) s
            WHERE lower(CAST(s.value AS TEXT))='mail.readbasic') THEN 1
        WHEN json_extract(policy.value, '$.handlerKey')='microsoft.calendar.list'
          AND c.status='healthy' AND c.secret_configured=1
          AND EXISTS (SELECT 1 FROM json_each(c.scopes_json) s
            WHERE lower(CAST(s.value AS TEXT))='calendars.readbasic') THEN 1
        WHEN json_extract(policy.value, '$.handlerKey')='microsoft.calendar.event.create'
          AND c.status='healthy' AND c.secret_configured=1
          AND EXISTS (SELECT 1 FROM json_each(c.scopes_json) s
            WHERE lower(CAST(s.value AS TEXT))='calendars.readwrite') THEN 1
        WHEN json_extract(policy.value, '$.adapterKind')='mcp'
          AND EXISTS (
            SELECT 1 FROM mcp_connectors mc
            JOIN mcp_connector_tools mt ON mt.connector_id=mc.id AND mt.tenant_id=mc.tenant_id
            WHERE mc.id=json_extract(policy.value, '$.connectionId')
              AND mc.tenant_id=b.tenant_id AND mc.status='ready'
              AND mt.enabled=1 AND mt.available=1
              AND json_extract(policy.value, '$.handlerKey')=
                'mcp.' || mc.id || '.' || mt.ai_tool_name
          ) THEN 1
        WHEN json_extract(policy.value, '$.handlerKey') IS NULL
          AND c.status='healthy' AND c.secret_configured=1 THEN 1
        ELSE 0
      END))
      FROM json_each(r.tool_policy_json) policy
      LEFT JOIN connections c ON c.id=json_extract(policy.value, '$.connectionId')
        AND c.tenant_id=b.tenant_id), r.tool_policy_json, '[]') tool_policy_json
    FROM agent_blueprints b ${releaseJoin}
    WHERE b.tenant_id = ? AND b.id = ?`);
  const releaseSelector = selector.processReleaseId ?? selector.promptReleaseId;
  const row = await (releaseSelector ? statement.bind(releaseSelector, tenantId, id) : statement.bind(tenantId, id))
    .first<BlueprintRow & {
      resolved_release_id?: string | null; resolved_prompt_release_id?: string | null;
      resolved_model_profile?: string | null; resolved_autonomy?: string | null;
    }>();
  if (!row) return null;
  const configuredAutonomy = (row.resolved_autonomy ?? row.autonomy) as AgentBlueprint["autonomy"];
  const safetyAutonomyCap = (row.safety_autonomy_cap ?? null) as AgentBlueprint["safetyAutonomyCap"];
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    executionProfile: row.execution_profile as AgentBlueprint["executionProfile"],
    modelProfile: row.resolved_model_profile ?? row.model_profile,
    modelId: row.model_id ?? null,
    promptReleaseId: row.resolved_prompt_release_id ?? row.prompt_release_id,
    autonomy: cappedAutonomy(configuredAutonomy, safetyAutonomyCap),
    configuredAutonomy,
    safetyAutonomyCap,
    safetyCapReason: row.safety_cap_reason ?? null,
    status: row.status as AgentBlueprint["status"],
    tools: JSON.parse(row.tools_json) as string[],
    updatedAt: row.updated_at
    ,operatingMode: (row.operating_mode ?? "active") as AgentBlueprint["operatingMode"],
    activeReleaseId: row.resolved_release_id ?? row.active_release_id,
    inputSchemaJson: row.input_schema_json,
    outputSchemaJson: row.output_schema_json,
    toolPolicies: (JSON.parse(row.tool_policy_json || "[]") as Array<Record<string, unknown>>).map((tool) => ({
      ...tool,
      connectionReady: Boolean(tool.connectionReady)
    })) as AgentBlueprint["toolPolicies"]
  };
}

export async function getPromptBundle(env: Env, releaseId: string): Promise<PromptBundle | null> {
  const row = await env.DB.prepare("SELECT * FROM prompt_releases WHERE id = ?").bind(releaseId).first<PromptRow>();
  return row ? {
    releaseId: row.id,
    blueprintId: row.blueprint_id,
    version: row.version,
    systemPrompt: row.system_prompt,
    instructions: JSON.parse(row.instructions_json) as string[],
    guardrails: JSON.parse(row.guardrails_json) as string[],
    checksum: row.checksum,
    publishedAt: row.published_at
  } : null;
}

export async function listBlueprints(env: Env, tenantId: string): Promise<AgentBlueprint[]> {
  const { results } = await env.DB.prepare("SELECT * FROM agent_blueprints WHERE tenant_id = ? ORDER BY updated_at DESC").bind(tenantId).all<BlueprintRow>();
  return Promise.all(results.map(async (row) => (await getBlueprint(env, tenantId, row.id))!));
}
