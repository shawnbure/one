import type { AgentBlueprint, PromptBundle } from "@workrr/contracts";
import type { BlueprintRow, Env, PromptRow } from "./types";

export async function getBlueprint(env: Env, tenantId: string, id: string): Promise<AgentBlueprint | null> {
  const row = await env.DB.prepare("SELECT * FROM agent_blueprints WHERE tenant_id = ? AND id = ?").bind(tenantId, id).first<BlueprintRow>();
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
