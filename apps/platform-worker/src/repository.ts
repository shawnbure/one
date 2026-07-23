import type { AgentBlueprint, PromptBundle } from "@workrr/contracts";
import type { BlueprintRow, Env, PromptRow } from "./types";

export async function getBlueprint(env: Env, tenantId: string, id: string): Promise<AgentBlueprint | null> {
  const row = await env.DB.prepare(`SELECT b.*, r.input_schema_json, r.output_schema_json,
    COALESCE((SELECT json_group_array(json_set(policy.value, '$.connectionReady',
      CASE
        WHEN json_extract(policy.value, '$.adapterKind')='mock'
          AND json_extract(policy.value, '$.connectionId') IS NULL THEN 1
        WHEN c.status='healthy' AND c.secret_configured=1 THEN 1
        ELSE 0
      END))
      FROM json_each(r.tool_policy_json) policy
      LEFT JOIN connections c ON c.id=json_extract(policy.value, '$.connectionId')
        AND c.tenant_id=b.tenant_id), r.tool_policy_json, '[]') tool_policy_json
    FROM agent_blueprints b LEFT JOIN process_releases r ON r.id=b.active_release_id AND r.tenant_id=b.tenant_id
    WHERE b.tenant_id = ? AND b.id = ?`).bind(tenantId, id).first<BlueprintRow>();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    executionProfile: row.execution_profile as AgentBlueprint["executionProfile"],
    modelProfile: row.model_profile,
    promptReleaseId: row.prompt_release_id,
    autonomy: row.autonomy as AgentBlueprint["autonomy"],
    status: row.status as AgentBlueprint["status"],
    tools: JSON.parse(row.tools_json) as string[],
    updatedAt: row.updated_at
    ,operatingMode: (row.operating_mode ?? "active") as AgentBlueprint["operatingMode"],
    activeReleaseId: row.active_release_id,
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
