import type { Env } from "./types";
import { evaluateReleaseGate } from "./evaluation";
import { normalizeProcessSchema } from "./contracts";
import { releaseToolPolicies } from "./tools";

interface ReleaseInput {
  systemPrompt: string;
  instructions: string[];
  guardrails: string[];
  modelProfile: string;
  autonomy: string;
  releaseNotes?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export async function getStudio(env: Env, tenantId: string, blueprintId: string) {
  const [blueprint, prompt, releases, runStats, activations] = await Promise.all([
    env.DB.prepare("SELECT * FROM agent_blueprints WHERE tenant_id = ? AND id = ?").bind(tenantId, blueprintId).first(),
    env.DB.prepare(`SELECT p.* FROM prompt_releases p WHERE p.blueprint_id = ? ORDER BY
      CASE WHEN p.id = (SELECT prompt_release_id FROM agent_blueprints WHERE tenant_id = ? AND id = ?) THEN 0 ELSE 1 END,
      p.version DESC LIMIT 1`).bind(blueprintId, tenantId, blueprintId).first(),
    env.DB.prepare(`SELECT id, version, prompt_release_id, model_profile, autonomy, status, release_notes,
      created_by, created_at, published_at, published_by, checksum, evaluation_status, evaluated_at,
      input_schema_json, output_schema_json, tool_policy_json FROM process_releases
      WHERE tenant_id = ? AND blueprint_id = ? ORDER BY version DESC`).bind(tenantId, blueprintId).all(),
    env.DB.prepare(`SELECT status, COUNT(*) count FROM executions WHERE tenant_id = ? AND blueprint_id = ?
      AND started_at >= datetime('now','-7 days') GROUP BY status`).bind(tenantId, blueprintId).all(),
    env.DB.prepare(`SELECT a.*, f.version from_version, t.version to_version,
      m.display_name activated_by_name
      FROM release_activations a
      LEFT JOIN process_releases f ON f.id=a.from_release_id AND f.tenant_id=a.tenant_id
      JOIN process_releases t ON t.id=a.to_release_id AND t.tenant_id=a.tenant_id
      LEFT JOIN tenant_members m ON m.id=a.activated_by AND m.tenant_id=a.tenant_id
      WHERE a.tenant_id=? AND a.blueprint_id=? ORDER BY a.activated_at DESC LIMIT 30`)
      .bind(tenantId, blueprintId).all()
  ]);
  if (!blueprint) return null;
  const row = blueprint as Record<string, unknown>;
  const activeRelease = releases.results.find((release) =>
    String((release as Record<string, unknown>).id) === String(row.active_release_id ?? ""));
  const activeTools = parseToolNames((activeRelease as Record<string, unknown> | undefined)?.tool_policy_json,
    JSON.parse(String(row.tools_json)) as string[]);
  return {
    blueprint,
    prompt,
    releases: releases.results, activations: activations.results,
    runStats: runStats.results,
    activeTools,
    topology: topologyFor(String(row.execution_profile), String(row.autonomy), activeTools)
  };
}

export async function createDraftRelease(env: Env, tenantId: string, blueprintId: string, actorId: string, input: ReleaseInput) {
  if (!input.systemPrompt.trim()) throw new Error("System prompt is required");
  const inputSchema = normalizeProcessSchema(input.inputSchema, "input");
  const outputSchema = normalizeProcessSchema(input.outputSchema, "output");
  const [blueprint, toolPolicies] = await Promise.all([
    env.DB.prepare("SELECT execution_profile FROM agent_blueprints WHERE tenant_id = ? AND id = ?")
      .bind(tenantId, blueprintId).first<{ execution_profile: string }>(),
    releaseToolPolicies(env, tenantId, blueprintId)
  ]);
  if (!blueprint) throw new Error("Process not found");
  const versionRow = await env.DB.prepare("SELECT COALESCE(MAX(version), 0) + 1 version FROM process_releases WHERE tenant_id = ? AND blueprint_id = ?")
    .bind(tenantId, blueprintId).first<{ version: number }>();
  const version = versionRow?.version ?? 1;
  const releaseId = `release-${blueprintId}-v${version}-${crypto.randomUUID().slice(0, 8)}`;
  const promptReleaseId = `prompt-${blueprintId}-v${version}-${crypto.randomUUID().slice(0, 8)}`;
  const compiled = { promptReleaseId, modelProfile: input.modelProfile, autonomy: input.autonomy,
    executionProfile: blueprint.execution_profile, inputSchema, outputSchema, toolPolicies };
  const checksum = await sha256(JSON.stringify({ ...input, inputSchema, outputSchema, compiled }));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO prompt_releases
      (id, blueprint_id, version, system_prompt, instructions_json, guardrails_json, checksum, status, release_notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
      .bind(promptReleaseId, blueprintId, version, input.systemPrompt.trim(), JSON.stringify(input.instructions), JSON.stringify(input.guardrails), checksum, input.releaseNotes ?? "", actorId),
    env.DB.prepare(`INSERT INTO process_releases
      (id, tenant_id, blueprint_id, version, prompt_release_id, model_profile, autonomy, compiled_json,
       checksum, status, release_notes, created_by, input_schema_json, output_schema_json, tool_policy_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`)
      .bind(releaseId, tenantId, blueprintId, version, promptReleaseId, input.modelProfile, input.autonomy,
        JSON.stringify(compiled), checksum, input.releaseNotes ?? "", actorId,
        inputSchema ? JSON.stringify(inputSchema) : null, outputSchema ? JSON.stringify(outputSchema) : null,
        JSON.stringify(toolPolicies))
  ]);
  return { releaseId, promptReleaseId, version, checksum, status: "draft" as const };
}

export async function publishRelease(env: Env, tenantId: string, blueprintId: string, releaseId: string, actorId: string) {
  const release = await env.DB.prepare(`SELECT * FROM process_releases WHERE id = ? AND tenant_id = ? AND blueprint_id = ?`)
    .bind(releaseId, tenantId, blueprintId).first<Record<string, string | number>>();
  if (!release) throw new Error("Process release not found");
  if (release.status !== "draft") throw new Error("Only a draft release can be published; use governed rollback for retired releases");
  await evaluateReleaseGate(env, tenantId, actorId, blueprintId, releaseId);
  const now = new Date().toISOString();
  const active = await env.DB.prepare("SELECT active_release_id FROM agent_blueprints WHERE tenant_id=? AND id=?")
    .bind(tenantId, blueprintId).first<{ active_release_id: string | null }>();
  await env.DB.batch([
    env.DB.prepare("UPDATE process_releases SET status = 'retired' WHERE tenant_id = ? AND blueprint_id = ? AND status = 'published'").bind(tenantId, blueprintId),
    env.DB.prepare("UPDATE process_releases SET status = 'published', published_at = ?, published_by = ? WHERE id = ?").bind(now, actorId, releaseId),
    env.DB.prepare("UPDATE prompt_releases SET status = 'published', published_at = ? WHERE id = ?").bind(now, release.prompt_release_id),
    env.DB.prepare(`UPDATE agent_blueprints SET prompt_release_id = ?, model_profile = ?, autonomy = ?, active_release_id = ?,
      status = CASE WHEN status = 'draft' THEN 'testing' ELSE status END, updated_at = ? WHERE tenant_id = ? AND id = ?`)
      .bind(release.prompt_release_id, release.model_profile, release.autonomy, releaseId, now, tenantId, blueprintId),
    env.DB.prepare(`INSERT INTO release_activations
      (id, tenant_id, blueprint_id, from_release_id, to_release_id, activation_type, reason, activated_by, activated_at)
      VALUES (?, ?, ?, ?, ?, 'publish', ?, ?, ?)`)
      .bind(crypto.randomUUID(), tenantId, blueprintId, active?.active_release_id ?? null, releaseId,
        `Published release v${release.version} after its evaluation gate passed.`, actorId, now)
  ]);
  return { releaseId, version: Number(release.version), status: "published" as const, publishedAt: now };
}

export async function rollbackRelease(env: Env, tenantId: string, blueprintId: string,
  releaseId: string, actorId: string, input: { reason?: string; confirmVersion?: number }) {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5 || reason.length > 500) throw new Error("Rollback reason must be between 5 and 500 characters");
  const [blueprint, target] = await Promise.all([
    env.DB.prepare("SELECT active_release_id FROM agent_blueprints WHERE tenant_id=? AND id=?")
      .bind(tenantId, blueprintId).first<{ active_release_id: string | null }>(),
    env.DB.prepare(`SELECT id, version, prompt_release_id, model_profile, autonomy, status, evaluation_status
      FROM process_releases WHERE id=? AND tenant_id=? AND blueprint_id=?`)
      .bind(releaseId, tenantId, blueprintId).first<Record<string, string | number>>()
  ]);
  if (!blueprint || !target) throw new Error("Rollback release not found");
  if (target.status !== "retired") throw new Error("Only a retired release can be restored");
  if (Number(input.confirmVersion) !== Number(target.version)) {
    throw new Error(`Enter version ${target.version} to confirm rollback`);
  }
  if (target.evaluation_status !== "passing") {
    throw new Error("Rollback target must have passing evaluation evidence");
  }
  if (!blueprint.active_release_id || blueprint.active_release_id === releaseId) {
    throw new Error("Rollback target is already active");
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE process_releases SET status='retired'
      WHERE id=? AND tenant_id=? AND blueprint_id=? AND status='published'`)
      .bind(blueprint.active_release_id, tenantId, blueprintId),
    env.DB.prepare(`UPDATE process_releases SET status='published', published_at=?, published_by=?
      WHERE id=? AND tenant_id=? AND blueprint_id=? AND status='retired'`)
      .bind(now, actorId, releaseId, tenantId, blueprintId),
    env.DB.prepare("UPDATE prompt_releases SET status='published', published_at=? WHERE id=?")
      .bind(now, target.prompt_release_id),
    env.DB.prepare(`UPDATE agent_blueprints SET prompt_release_id=?, model_profile=?, autonomy=?,
      active_release_id=?, updated_at=? WHERE tenant_id=? AND id=? AND active_release_id=?`)
      .bind(target.prompt_release_id, target.model_profile, target.autonomy, releaseId, now,
        tenantId, blueprintId, blueprint.active_release_id),
    env.DB.prepare(`INSERT INTO release_activations
      (id, tenant_id, blueprint_id, from_release_id, to_release_id, activation_type, reason, activated_by, activated_at)
      VALUES (?, ?, ?, ?, ?, 'rollback', ?, ?, ?)`)
      .bind(crypto.randomUUID(), tenantId, blueprintId, blueprint.active_release_id, releaseId,
        reason, actorId, now)
  ]);
  return {
    releaseId, previousReleaseId: blueprint.active_release_id, version: Number(target.version),
    status: "published" as const, rolledBackAt: now, reason
  };
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
function parseToolNames(value: unknown, fallback: string[]) {
  if (typeof value !== "string" || !value) return fallback;
  try {
    const parsed = JSON.parse(value) as Array<{ name?: unknown }>;
    return Array.isArray(parsed) ? parsed.map((tool) => String(tool.name ?? "")).filter(Boolean) : fallback;
  } catch { return fallback; }
}
