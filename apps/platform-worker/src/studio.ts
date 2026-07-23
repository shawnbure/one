import type { Env } from "./types";

interface ReleaseInput {
  systemPrompt: string;
  instructions: string[];
  guardrails: string[];
  modelProfile: string;
  autonomy: string;
  releaseNotes?: string;
}

export async function getStudio(env: Env, tenantId: string, blueprintId: string) {
  const [blueprint, prompt, releases, runStats] = await Promise.all([
    env.DB.prepare("SELECT * FROM agent_blueprints WHERE tenant_id = ? AND id = ?").bind(tenantId, blueprintId).first(),
    env.DB.prepare(`SELECT p.* FROM prompt_releases p JOIN agent_blueprints b ON b.prompt_release_id = p.id
      WHERE b.tenant_id = ? AND b.id = ?`).bind(tenantId, blueprintId).first(),
    env.DB.prepare(`SELECT id, version, prompt_release_id, model_profile, autonomy, status, release_notes,
      created_by, created_at, published_at, published_by, checksum FROM process_releases
      WHERE tenant_id = ? AND blueprint_id = ? ORDER BY version DESC`).bind(tenantId, blueprintId).all(),
    env.DB.prepare(`SELECT status, COUNT(*) count FROM executions WHERE tenant_id = ? AND blueprint_id = ?
      AND started_at >= datetime('now','-7 days') GROUP BY status`).bind(tenantId, blueprintId).all()
  ]);
  if (!blueprint) return null;
  const row = blueprint as Record<string, unknown>;
  return {
    blueprint,
    prompt,
    releases: releases.results,
    runStats: runStats.results,
    topology: topologyFor(String(row.execution_profile), String(row.autonomy), JSON.parse(String(row.tools_json)) as string[])
  };
}

export async function createDraftRelease(env: Env, tenantId: string, blueprintId: string, actorId: string, input: ReleaseInput) {
  if (!input.systemPrompt.trim()) throw new Error("System prompt is required");
  const blueprint = await env.DB.prepare("SELECT execution_profile FROM agent_blueprints WHERE tenant_id = ? AND id = ?")
    .bind(tenantId, blueprintId).first<{ execution_profile: string }>();
  if (!blueprint) throw new Error("Process not found");
  const versionRow = await env.DB.prepare("SELECT COALESCE(MAX(version), 0) + 1 version FROM process_releases WHERE tenant_id = ? AND blueprint_id = ?")
    .bind(tenantId, blueprintId).first<{ version: number }>();
  const version = versionRow?.version ?? 1;
  const releaseId = `release-${blueprintId}-v${version}-${crypto.randomUUID().slice(0, 8)}`;
  const promptReleaseId = `prompt-${blueprintId}-v${version}-${crypto.randomUUID().slice(0, 8)}`;
  const compiled = { promptReleaseId, modelProfile: input.modelProfile, autonomy: input.autonomy, executionProfile: blueprint.execution_profile };
  const checksum = await sha256(JSON.stringify({ input, compiled }));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO prompt_releases
      (id, blueprint_id, version, system_prompt, instructions_json, guardrails_json, checksum, status, release_notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
      .bind(promptReleaseId, blueprintId, version, input.systemPrompt.trim(), JSON.stringify(input.instructions), JSON.stringify(input.guardrails), checksum, input.releaseNotes ?? "", actorId),
    env.DB.prepare(`INSERT INTO process_releases
      (id, tenant_id, blueprint_id, version, prompt_release_id, model_profile, autonomy, compiled_json, checksum, status, release_notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
      .bind(releaseId, tenantId, blueprintId, version, promptReleaseId, input.modelProfile, input.autonomy, JSON.stringify(compiled), checksum, input.releaseNotes ?? "", actorId)
  ]);
  return { releaseId, promptReleaseId, version, checksum, status: "draft" as const };
}

export async function publishRelease(env: Env, tenantId: string, blueprintId: string, releaseId: string, actorId: string) {
  const release = await env.DB.prepare(`SELECT * FROM process_releases WHERE id = ? AND tenant_id = ? AND blueprint_id = ?`)
    .bind(releaseId, tenantId, blueprintId).first<Record<string, string | number>>();
  if (!release) throw new Error("Process release not found");
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE process_releases SET status = 'retired' WHERE tenant_id = ? AND blueprint_id = ? AND status = 'published'").bind(tenantId, blueprintId),
    env.DB.prepare("UPDATE process_releases SET status = 'published', published_at = ?, published_by = ? WHERE id = ?").bind(now, actorId, releaseId),
    env.DB.prepare("UPDATE prompt_releases SET status = 'published', published_at = ? WHERE id = ?").bind(now, release.prompt_release_id),
    env.DB.prepare(`UPDATE agent_blueprints SET prompt_release_id = ?, model_profile = ?, autonomy = ?, active_release_id = ?, updated_at = ?
      WHERE tenant_id = ? AND id = ?`).bind(release.prompt_release_id, release.model_profile, release.autonomy, releaseId, now, tenantId, blueprintId)
  ]);
  return { releaseId, version: Number(release.version), status: "published" as const, publishedAt: now };
}

function topologyFor(profile: string, autonomy: string, tools: string[]) {
  const nodes = [{ id: "trigger", type: "trigger", label: profile === "workflow" ? "Workflow trigger" : "Process request" }];
  if (profile === "workflow") nodes.push({ id: "queue", type: "queue", label: "Durable workflow" });
  nodes.push({ id: "agent", type: "agent", label: profile === "instant" ? "Instant agent" : "Durable agent" });
  for (const [index, tool] of tools.entries()) nodes.push({ id: `tool-${index}`, type: "tool", label: tool.replaceAll("_", " ") });
  if (["approve", "guarded"].includes(autonomy)) nodes.push({ id: "approval", type: "approval", label: "Human checkpoint" });
  nodes.push({ id: "outcome", type: "outcome", label: "Business outcome" });
  return { nodes, edges: nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id })) };
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
