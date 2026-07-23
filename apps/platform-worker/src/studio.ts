import type { Env } from "./types";
import { evaluateReleaseGate } from "./evaluation";
import { normalizeProcessSchema } from "./contracts";
import { releaseToolPolicies } from "./tools";
import { inferenceModelCatalog, modelProfiles, supportedInferenceModels } from "@workrr/contracts";
import { getAutonomySafety } from "./autonomy-safety";
import { assertTenantModelAllowed } from "./model-governance";
import { requireAiGatewaySetting } from "./ai-gateway";
import { assertExternalModelAllowed, dataClassifications, normalizeDataClassification } from "./data-governance";
import { analyzePromptBudget, assertPromptBudget } from "./prompt-budget";

interface ReleaseInput {
  systemPrompt: string;
  instructions: string[];
  guardrails: string[];
  modelProfile: string;
  modelId?: string;
  autonomy: string;
  releaseNotes?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  topology?: unknown;
  dataClassification?: string;
}

export interface BusinessTopologyStep {
  id: string;
  type: "step" | "decision" | "checkpoint";
  label: string;
}

export async function getStudio(env: Env, tenantId: string, blueprintId: string) {
  const actorCohortCte = `WITH latest_execution AS (
      SELECT id execution_id, instance_key, process_release_id, started_at,
        ROW_NUMBER() OVER (PARTITION BY instance_key ORDER BY started_at DESC, id DESC) rank
      FROM executions WHERE tenant_id=? AND blueprint_id=? AND instance_key IS NOT NULL
    ), latest_migration AS (
      SELECT instance_key, to_release_id, migrated_at,
        ROW_NUMBER() OVER (PARTITION BY instance_key ORDER BY migrated_at DESC, id DESC) rank
      FROM actor_release_migrations WHERE tenant_id=? AND blueprint_id=?
    ), actor_release AS (
      SELECT le.execution_id, le.instance_key, le.started_at last_active_at,
        CASE WHEN lm.migrated_at IS NOT NULL
          AND julianday(lm.migrated_at) >= julianday(le.started_at)
          THEN lm.to_release_id ELSE le.process_release_id END effective_release_id,
        lm.migrated_at
      FROM latest_execution le
      LEFT JOIN latest_migration lm ON lm.instance_key=le.instance_key AND lm.rank=1
      WHERE le.rank=1
    )`;
  const [blueprint, prompt, releases, runStats, activations, actorCohorts, recentActors, launchReadiness,
    approvedModels] = await Promise.all([
    env.DB.prepare("SELECT * FROM agent_blueprints WHERE tenant_id = ? AND id = ?").bind(tenantId, blueprintId).first(),
    env.DB.prepare(`SELECT p.* FROM prompt_releases p WHERE p.blueprint_id = ? ORDER BY
      CASE WHEN p.id = (SELECT prompt_release_id FROM agent_blueprints WHERE tenant_id = ? AND id = ?) THEN 0 ELSE 1 END,
      p.version DESC LIMIT 1`).bind(blueprintId, tenantId, blueprintId).first(),
    env.DB.prepare(`SELECT id, version, prompt_release_id, model_profile, model_id, autonomy, status, release_notes,
      created_by, created_at, published_at, published_by, checksum, evaluation_status, evaluated_at,
      input_schema_json, output_schema_json, tool_policy_json, topology_json, data_classification FROM process_releases
      WHERE tenant_id = ? AND blueprint_id = ? ORDER BY version DESC`).bind(tenantId, blueprintId).all(),
    env.DB.prepare(`SELECT status, COUNT(*) count,
      ROUND(AVG(CASE WHEN input_tokens > 0 THEN input_tokens END)) average_input_tokens,
      ROUND(AVG(CASE WHEN total_tokens > 0 THEN total_tokens END)) average_total_tokens,
      ROUND(AVG(model_latency_ms)) average_model_latency_ms
      FROM executions WHERE tenant_id = ? AND blueprint_id = ?
      AND process_release_id=(SELECT active_release_id FROM agent_blueprints WHERE tenant_id=? AND id=?)
      AND started_at >= datetime('now','-7 days') GROUP BY status`)
      .bind(tenantId, blueprintId, tenantId, blueprintId).all(),
    env.DB.prepare(`SELECT a.*, f.version from_version, t.version to_version,
      m.display_name activated_by_name
      FROM release_activations a
      LEFT JOIN process_releases f ON f.id=a.from_release_id AND f.tenant_id=a.tenant_id
      JOIN process_releases t ON t.id=a.to_release_id AND t.tenant_id=a.tenant_id
      LEFT JOIN tenant_members m ON m.id=a.activated_by AND m.tenant_id=a.tenant_id
      WHERE a.tenant_id=? AND a.blueprint_id=? ORDER BY a.activated_at DESC LIMIT 30`)
      .bind(tenantId, blueprintId).all(),
    env.DB.prepare(`${actorCohortCte}
      SELECT ar.effective_release_id release_id, pr.version, pr.status, COUNT(*) actor_count,
        MAX(COALESCE(ar.migrated_at, ar.last_active_at)) latest_evidence_at
      FROM actor_release ar
      LEFT JOIN process_releases pr ON pr.id=ar.effective_release_id AND pr.tenant_id=?
      GROUP BY ar.effective_release_id, pr.version, pr.status
      ORDER BY pr.version DESC`).bind(tenantId, blueprintId, tenantId, blueprintId, tenantId).all(),
    env.DB.prepare(`${actorCohortCte}
      SELECT ar.*, pr.version, pr.status
      FROM actor_release ar
      LEFT JOIN process_releases pr ON pr.id=ar.effective_release_id AND pr.tenant_id=?
      ORDER BY julianday(COALESCE(ar.migrated_at, ar.last_active_at)) DESC LIMIT 50`)
      .bind(tenantId, blueprintId, tenantId, blueprintId, tenantId).all(),
    getProcessLaunchReadiness(env, tenantId, blueprintId),
    env.DB.prepare(`SELECT p.model_id, m.context_tokens FROM tenant_model_policies p
      JOIN model_catalog m ON m.model_id=p.model_id
      WHERE p.tenant_id=? AND p.enabled=1 AND m.status='active' ORDER BY p.model_id`)
      .bind(tenantId).all<{ model_id: string; context_tokens: number }>()
  ]);
  if (!blueprint) return null;
  const autonomySafety = await getAutonomySafety(env, tenantId, blueprintId);
  const row = blueprint as Record<string, unknown>;
  const activeRelease = releases.results.find((release) =>
    String((release as Record<string, unknown>).id) === String(row.active_release_id ?? ""));
  const activeTools = parseToolNames((activeRelease as Record<string, unknown> | undefined)?.tool_policy_json,
    JSON.parse(String(row.tools_json)) as string[]);
  const activeReleaseId = String(row.active_release_id ?? "");
  const cohorts = actorCohorts.results.map((cohort) => {
    const item = cohort as Record<string, unknown>;
    return { ...item, actor_count: Number(item.actor_count ?? 0), state: item.release_id
      ? String(item.release_id) === activeReleaseId ? "current" : "pinned_previous"
      : "unattributed" };
  });
  const actors = recentActors.results.map((actor) => {
    const item = actor as Record<string, unknown>;
    return { ...item, state: item.effective_release_id
      ? String(item.effective_release_id) === activeReleaseId ? "current" : "pinned_previous"
      : "unattributed" };
  });
  const selectedRelease = (activeRelease as Record<string, unknown> | undefined) ??
    releases.results[0] as Record<string, unknown> | undefined;
  const selectedModelId = String(selectedRelease?.model_id ?? row.model_id ?? "");
  const selectedContext = approvedModels.results.find((model) => model.model_id === selectedModelId)?.context_tokens;
  const promptRow = prompt as Record<string, unknown> | null;
  const promptBudget = promptRow && selectedContext ? analyzePromptBudget({
    systemPrompt: String(promptRow.system_prompt ?? ""),
    instructions: parseStringList(promptRow.instructions_json),
    guardrails: parseStringList(promptRow.guardrails_json),
    contextTokens: Number(selectedContext),
    executionProfile: String(row.execution_profile)
  }) : null;
  const completedStats = runStats.results.find((item) =>
    String((item as Record<string, unknown>).status) === "completed") as Record<string, unknown> | undefined;
  return {
    blueprint,
    prompt,
    releases: releases.results, activations: activations.results,
    runStats: runStats.results,
    actorAdoption: {
      supported: !["instant", "workflow"].includes(String(row.execution_profile)),
      knownActors: cohorts.reduce((sum, cohort) => sum + Number(cohort.actor_count), 0),
      currentActors: cohorts.filter((cohort) => cohort.state === "current")
        .reduce((sum, cohort) => sum + Number(cohort.actor_count), 0),
      pinnedPreviousActors: cohorts.filter((cohort) => cohort.state === "pinned_previous")
        .reduce((sum, cohort) => sum + Number(cohort.actor_count), 0),
      unattributedActors: cohorts.filter((cohort) => cohort.state === "unattributed")
        .reduce((sum, cohort) => sum + Number(cohort.actor_count), 0),
      cohorts, actors
    },
    launchReadiness,
    approvedModelIds: approvedModels.results.map((model) => model.model_id),
    modelContextTokens: Object.fromEntries(approvedModels.results.map((model) =>
      [model.model_id, Number(model.context_tokens)])),
    promptBudget: promptBudget ? {
      ...promptBudget,
      measured: {
        sampleCount: Number(completedStats?.count ?? 0),
        averageInputTokens: completedStats?.average_input_tokens == null ? null :
          Number(completedStats.average_input_tokens),
        averageTotalTokens: completedStats?.average_total_tokens == null ? null :
          Number(completedStats.average_total_tokens),
        averageModelLatencyMs: completedStats?.average_model_latency_ms == null ? null :
          Number(completedStats.average_model_latency_ms),
        windowDays: 7
      }
    } : null,
    autonomySafety,
    activeTools,
    topology: topologyFromRelease(
      (activeRelease as Record<string, unknown> | undefined)?.topology_json,
      String(row.execution_profile), String(row.autonomy), activeTools
    )
  };
}

export async function createDraftRelease(env: Env, tenantId: string, blueprintId: string, actorId: string, input: ReleaseInput) {
  if (!input.systemPrompt.trim()) throw new Error("System prompt is required");
  if (!(input.modelProfile in modelProfiles)) throw new Error("Select a supported Cloudflare model profile");
  const modelId = input.modelId ?? modelProfiles[input.modelProfile as keyof typeof modelProfiles].model;
  if (!supportedInferenceModels.includes(modelId as typeof supportedInferenceModels[number])) {
    throw new Error("Select a supported Cloudflare inference model");
  }
  const selectedModel = inferenceModelCatalog[modelId as keyof typeof inferenceModelCatalog];
  if (selectedModel.profile !== input.modelProfile) {
    throw new Error(`The selected model requires the ${selectedModel.profile} model profile`);
  }
  await assertTenantModelAllowed(env, tenantId, modelId);
  const inputSchema = normalizeProcessSchema(input.inputSchema, "input");
  const outputSchema = normalizeProcessSchema(input.outputSchema, "output");
  const [blueprint, toolPolicies, modelCatalog] = await Promise.all([
    env.DB.prepare("SELECT execution_profile, data_classification FROM agent_blueprints WHERE tenant_id = ? AND id = ?")
      .bind(tenantId, blueprintId).first<{ execution_profile: string; data_classification: string }>(),
    releaseToolPolicies(env, tenantId, blueprintId),
    env.DB.prepare(`SELECT context_tokens FROM model_catalog WHERE model_id=? AND status='active'`)
      .bind(modelId).first<{ context_tokens: number }>()
  ]);
  if (!blueprint) throw new Error("Process not found");
  if (!modelCatalog) throw new Error("Selected model context budget is unavailable");
  assertPromptBudget({
    systemPrompt: input.systemPrompt.trim(), instructions: input.instructions,
    guardrails: input.guardrails, contextTokens: Number(modelCatalog.context_tokens),
    executionProfile: blueprint.execution_profile
  });
  const dataClassification = normalizeDataClassification(input.dataClassification ?? blueprint.data_classification ?? "internal");
  const classificationRank = dataClassifications.indexOf(dataClassification);
  const higherTool = toolPolicies.find((tool) =>
    dataClassifications.indexOf(tool.dataClassification) > classificationRank);
  if (higherTool) {
    throw new Error(`Process classification must cover its ${higherTool.dataClassification} tool ${higherTool.name}`);
  }
  if (selectedModel.boundary === "ai_gateway") {
    await requireAiGatewaySetting(env, tenantId);
    await assertExternalModelAllowed(env, tenantId, dataClassification);
  }
  const topology = normalizeWorkflowTopology(
    blueprint.execution_profile, input.autonomy, toolPolicies.map((tool) => tool.name), input.topology
  );
  const versionRow = await env.DB.prepare("SELECT COALESCE(MAX(version), 0) + 1 version FROM process_releases WHERE tenant_id = ? AND blueprint_id = ?")
    .bind(tenantId, blueprintId).first<{ version: number }>();
  const version = versionRow?.version ?? 1;
  const releaseId = `release-${blueprintId}-v${version}-${crypto.randomUUID().slice(0, 8)}`;
  const promptReleaseId = `prompt-${blueprintId}-v${version}-${crypto.randomUUID().slice(0, 8)}`;
  const compiled = { promptReleaseId, modelProfile: input.modelProfile, modelId, autonomy: input.autonomy,
    dataClassification,
    executionProfile: blueprint.execution_profile, inputSchema, outputSchema, toolPolicies, topology };
  const checksum = await sha256(JSON.stringify({ ...input, inputSchema, outputSchema, compiled }));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO prompt_releases
      (id, blueprint_id, version, system_prompt, instructions_json, guardrails_json, checksum, status, release_notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`)
      .bind(promptReleaseId, blueprintId, version, input.systemPrompt.trim(), JSON.stringify(input.instructions), JSON.stringify(input.guardrails), checksum, input.releaseNotes ?? "", actorId),
    env.DB.prepare(`INSERT INTO process_releases
      (id, tenant_id, blueprint_id, version, prompt_release_id, model_profile, model_id, autonomy, compiled_json,
       checksum, status, release_notes, created_by, input_schema_json, output_schema_json, tool_policy_json,
       topology_json, data_classification)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(releaseId, tenantId, blueprintId, version, promptReleaseId, input.modelProfile, modelId, input.autonomy,
        JSON.stringify(compiled), checksum, input.releaseNotes ?? "", actorId,
        inputSchema ? JSON.stringify(inputSchema) : null, outputSchema ? JSON.stringify(outputSchema) : null,
        JSON.stringify(toolPolicies), JSON.stringify(topology), dataClassification)
  ]);
  return { releaseId, promptReleaseId, version, checksum, status: "draft" as const };
}

export async function publishRelease(env: Env, tenantId: string, blueprintId: string, releaseId: string, actorId: string) {
  const release = await env.DB.prepare(`SELECT * FROM process_releases WHERE id = ? AND tenant_id = ? AND blueprint_id = ?`)
    .bind(releaseId, tenantId, blueprintId).first<Record<string, string | number>>();
  if (!release) throw new Error("Process release not found");
  if (release.status !== "draft") throw new Error("Only a draft release can be published; use governed rollback for retired releases");
  await assertTenantModelAllowed(env, tenantId, String(release.model_id));
  const readiness = await getProcessLaunchReadiness(env, tenantId, blueprintId);
  if (!readiness.ready) throw new ProcessLaunchReadinessError(readiness);
  await assertStoredReleasePromptBudget(env, release);
  await evaluateReleaseGate(env, tenantId, actorId, blueprintId, releaseId);
  const now = new Date().toISOString();
  const active = await env.DB.prepare("SELECT active_release_id FROM agent_blueprints WHERE tenant_id=? AND id=?")
    .bind(tenantId, blueprintId).first<{ active_release_id: string | null }>();
  await env.DB.batch([
    env.DB.prepare("UPDATE process_releases SET status = 'retired' WHERE tenant_id = ? AND blueprint_id = ? AND status = 'published'").bind(tenantId, blueprintId),
    env.DB.prepare("UPDATE process_releases SET status = 'published', published_at = ?, published_by = ? WHERE id = ?").bind(now, actorId, releaseId),
    env.DB.prepare("UPDATE prompt_releases SET status = 'published', published_at = ? WHERE id = ?").bind(now, release.prompt_release_id),
    env.DB.prepare(`UPDATE agent_blueprints SET prompt_release_id = ?, model_profile = ?, autonomy = ?, active_release_id = ?,
      data_classification=?, status = CASE WHEN status = 'draft' THEN 'testing' ELSE status END,
      updated_at = ? WHERE tenant_id = ? AND id = ?`)
      .bind(release.prompt_release_id, release.model_profile, release.autonomy, releaseId,
        release.data_classification, now, tenantId, blueprintId),
    env.DB.prepare(`INSERT INTO release_activations
      (id, tenant_id, blueprint_id, from_release_id, to_release_id, activation_type, reason, activated_by, activated_at)
      VALUES (?, ?, ?, ?, ?, 'publish', ?, ?, ?)`)
      .bind(crypto.randomUUID(), tenantId, blueprintId, active?.active_release_id ?? null, releaseId,
        `Published release v${release.version} after its evaluation gate passed.`, actorId, now)
  ]);
  return { releaseId, version: Number(release.version), status: "published" as const, publishedAt: now };
}

export interface ProcessLaunchReadiness {
  ready: boolean;
  baselineConfigured: boolean;
  targetConfigured: boolean;
  targetCurrent: boolean;
  targetReviewDueAt: string | null;
  blockers: string[];
}

export class ProcessLaunchReadinessError extends Error {
  constructor(public readonly readiness: ProcessLaunchReadiness) {
    super(`Process is not ready to publish: ${readiness.blockers.join("; ")}`);
  }
}

export async function getProcessLaunchReadiness(
  env: Env, tenantId: string, blueprintId: string
): Promise<ProcessLaunchReadiness> {
  const row = await env.DB.prepare(`SELECT b.id,
      CASE WHEN d.blueprint_id IS NULL THEN 0 ELSE 1 END baseline_configured,
      CASE WHEN t.blueprint_id IS NULL THEN 0 ELSE 1 END target_configured,
      t.review_due_at target_review_due_at
    FROM agent_blueprints b
    LEFT JOIN process_discovery d ON d.blueprint_id=b.id AND d.tenant_id=b.tenant_id
    LEFT JOIN process_value_targets t ON t.blueprint_id=b.id AND t.tenant_id=b.tenant_id
    WHERE b.id=? AND b.tenant_id=? LIMIT 1`)
    .bind(blueprintId, tenantId).first<Record<string, unknown>>();
  if (!row) throw new Error("Process not found");
  const baselineConfigured = Number(row.baseline_configured) === 1;
  const targetConfigured = Number(row.target_configured) === 1;
  const targetReviewDueAt = targetConfigured ? String(row.target_review_due_at ?? "") || null : null;
  const targetCurrent = Boolean(targetReviewDueAt && new Date(targetReviewDueAt).getTime() > Date.now());
  const blockers: string[] = [];
  if (!baselineConfigured) blockers.push("complete the discovery baseline");
  if (!targetConfigured) blockers.push("have an owner approve a 30-day value target");
  else if (!targetCurrent) blockers.push("renew the expired value target review");
  return {
    ready: blockers.length === 0, baselineConfigured, targetConfigured, targetCurrent,
    targetReviewDueAt, blockers
  };
}

export async function rollbackRelease(env: Env, tenantId: string, blueprintId: string,
  releaseId: string, actorId: string, input: { reason?: string; confirmVersion?: number }) {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5 || reason.length > 500) throw new Error("Rollback reason must be between 5 and 500 characters");
  const [blueprint, target] = await Promise.all([
    env.DB.prepare("SELECT active_release_id FROM agent_blueprints WHERE tenant_id=? AND id=?")
      .bind(tenantId, blueprintId).first<{ active_release_id: string | null }>(),
    env.DB.prepare(`SELECT id, version, prompt_release_id, model_profile, model_id, autonomy,
      data_classification, status, evaluation_status
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
  await assertTenantModelAllowed(env, tenantId, String(target.model_id));
  await assertStoredReleasePromptBudget(env, target);
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
      data_classification=?, active_release_id=?, updated_at=? WHERE tenant_id=? AND id=? AND active_release_id=?`)
      .bind(target.prompt_release_id, target.model_profile, target.autonomy, target.data_classification, releaseId, now,
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

export function normalizeWorkflowTopology(
  profile: string, autonomy: string, tools: string[], input: unknown
) {
  const raw = input && typeof input === "object" && Array.isArray((input as { businessSteps?: unknown }).businessSteps)
    ? (input as { businessSteps: unknown[] }).businessSteps : [];
  if (raw.length > 8) throw new Error("Workflow design supports at most 8 business steps");
  const seen = new Set<string>();
  const businessSteps = raw.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`Workflow step ${index + 1} is invalid`);
    const value = item as Record<string, unknown>;
    const label = String(value.label ?? "").trim().replace(/\s+/g, " ");
    const type = String(value.type ?? "step");
    if (label.length < 3 || label.length > 60) {
      throw new Error(`Workflow step ${index + 1} label must be 3 to 60 characters`);
    }
    if (!["step", "decision", "checkpoint"].includes(type)) {
      throw new Error(`Workflow step ${index + 1} has an unsupported type`);
    }
    const normalized = label.toLowerCase();
    if (seen.has(normalized)) throw new Error("Workflow step labels must be unique");
    seen.add(normalized);
    return {
      id: `business-${index + 1}`,
      type: type as BusinessTopologyStep["type"],
      label
    };
  });
  return topologyFor(profile, autonomy, tools, businessSteps);
}

function topologyFor(
  profile: string, autonomy: string, tools: string[], businessSteps: BusinessTopologyStep[] = []
) {
  const nodes = [{ id: "trigger", type: "trigger", label: profile === "workflow" ? "Workflow trigger" : "Process request" }];
  if (profile === "workflow") nodes.push({ id: "queue", type: "queue", label: "Durable workflow" });
  nodes.push({ id: "agent", type: "agent", label: profile === "instant" ? "Instant agent" : "Durable agent" });
  nodes.push(...businessSteps);
  for (const [index, tool] of tools.entries()) nodes.push({ id: `tool-${index}`, type: "tool", label: tool.replaceAll("_", " ") });
  if (["approve", "guarded"].includes(autonomy)) nodes.push({ id: "approval", type: "approval", label: "Human checkpoint" });
  nodes.push({ id: "outcome", type: "outcome", label: "Business outcome" });
  return {
    version: 1, layout: "linear" as const, businessSteps, nodes,
    edges: nodes.slice(1).map((node, index) => ({ from: nodes[index]!.id, to: node.id }))
  };
}

function topologyFromRelease(value: unknown, profile: string, autonomy: string, tools: string[]) {
  if (typeof value === "string" && value) {
    try {
      const parsed = JSON.parse(value) as { businessSteps?: unknown };
      return normalizeWorkflowTopology(profile, autonomy, tools, parsed);
    } catch {
      // Legacy or malformed evidence is never trusted; render the platform-derived safe topology.
    }
  }
  return topologyFor(profile, autonomy, tools);
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function assertStoredReleasePromptBudget(env: Env, release: Record<string, unknown>) {
  const evidence = await env.DB.prepare(`SELECT p.system_prompt, p.instructions_json, p.guardrails_json,
    m.context_tokens, b.execution_profile
    FROM prompt_releases p
    JOIN agent_blueprints b ON b.id=p.blueprint_id
    JOIN model_catalog m ON m.model_id=?
    WHERE p.id=?`).bind(release.model_id, release.prompt_release_id).first<Record<string, unknown>>();
  if (!evidence) throw new Error("Release prompt budget evidence is unavailable");
  assertPromptBudget({
    systemPrompt: String(evidence.system_prompt ?? ""),
    instructions: parseStringList(evidence.instructions_json),
    guardrails: parseStringList(evidence.guardrails_json),
    contextTokens: Number(evidence.context_tokens),
    executionProfile: String(evidence.execution_profile)
  });
}
function parseToolNames(value: unknown, fallback: string[]) {
  if (typeof value !== "string" || !value) return fallback;
  try {
    const parsed = JSON.parse(value) as Array<{ name?: unknown }>;
    return Array.isArray(parsed) ? parsed.map((tool) => String(tool.name ?? "")).filter(Boolean) : fallback;
  } catch { return fallback; }
}

function parseStringList(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch { return []; }
}
