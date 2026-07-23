import { executionProfiles } from "@workrr/contracts";
import { createDraftRelease } from "./studio";
import type { Env } from "./types";

export interface PortableProcessPackage {
  schemaVersion: 1;
  exportedAt?: string;
  process: {
    name: string; description: string; executionProfile: string; modelProfile: string; autonomy: string;
    tools: string[]; businessOwner: string; department: string; riskLevel: string;
  };
  behavior: { systemPrompt: string; instructions: string[]; guardrails: string[]; releaseNotes?: string };
  provenance?: { sourceProcessId?: string; sourceReleaseId?: string; checksum?: string };
  secrets?: "excluded";
}

export async function exportProcessPackage(env: Env, tenantId: string, blueprintId: string): Promise<PortableProcessPackage | null> {
  const row = await env.DB.prepare(`SELECT b.*, p.system_prompt, p.instructions_json, p.guardrails_json, p.checksum,
    r.id source_release_id, r.release_notes FROM agent_blueprints b
    JOIN prompt_releases p ON p.id = b.prompt_release_id
    LEFT JOIN process_releases r ON r.id = b.active_release_id
    WHERE b.tenant_id = ? AND b.id = ?`).bind(tenantId, blueprintId).first<Record<string, string | null>>();
  if (!row) return null;
  return {
    schemaVersion: 1, exportedAt: new Date().toISOString(),
    process: { name: row.name!, description: row.description!, executionProfile: row.execution_profile!, modelProfile: row.model_profile!,
      autonomy: row.autonomy!, tools: parseStringArray(row.tools_json), businessOwner: row.business_owner || "Operations",
      department: row.department || "Operations", riskLevel: row.risk_level || "medium" },
    behavior: { systemPrompt: row.system_prompt!, instructions: parseStringArray(row.instructions_json),
      guardrails: parseStringArray(row.guardrails_json), releaseNotes: row.release_notes || "Imported process package" },
    provenance: { sourceProcessId: blueprintId, sourceReleaseId: row.source_release_id || undefined, checksum: row.checksum || undefined },
    secrets: "excluded"
  };
}

export async function importProcessPackage(env: Env, tenantId: string, actorId: string, value: unknown) {
  const pkg = validatePackage(value);
  const id = `${slug(pkg.process.name)}-${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO agent_blueprints
    (id, tenant_id, name, description, execution_profile, model_profile, prompt_release_id, autonomy, status, tools_json,
     updated_at, business_owner, department, risk_level, operating_mode)
    VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'draft', ?, ?, ?, ?, ?, 'paused')`)
    .bind(id, tenantId, pkg.process.name, pkg.process.description, pkg.process.executionProfile, pkg.process.modelProfile,
      pkg.process.autonomy, JSON.stringify(pkg.process.tools), now, pkg.process.businessOwner, pkg.process.department, pkg.process.riskLevel).run();
  try {
    await env.DB.prepare(`INSERT INTO evaluation_scenarios (id, tenant_id, blueprint_id, name, category, status, assertion_count)
      VALUES (?, ?, ?, 'Release safety baseline', 'release_gate', 'not_run', 4)`).bind(`eval-release-${id}`, tenantId, id).run();
    const release = await createDraftRelease(env, tenantId, id, actorId, { systemPrompt: pkg.behavior.systemPrompt,
      instructions: pkg.behavior.instructions, guardrails: pkg.behavior.guardrails, modelProfile: pkg.process.modelProfile,
      autonomy: pkg.process.autonomy, releaseNotes: `Imported package${pkg.provenance?.checksum ? ` · source ${pkg.provenance.checksum.slice(0, 12)}` : ""}` });
    return { id, status: "draft", release, source: pkg.provenance ?? null };
  } catch (error) {
    await env.DB.prepare("DELETE FROM evaluation_scenarios WHERE blueprint_id = ? AND tenant_id = ?").bind(id, tenantId).run();
    await env.DB.prepare("DELETE FROM agent_blueprints WHERE id = ? AND tenant_id = ?").bind(id, tenantId).run();
    throw error;
  }
}

function validatePackage(value: unknown): PortableProcessPackage {
  if (!value || typeof value !== "object") throw new Error("Process package must be a JSON object");
  const pkg = value as Partial<PortableProcessPackage>;
  if (pkg.schemaVersion !== 1 || !pkg.process || !pkg.behavior) throw new Error("Unsupported or incomplete process package");
  const process = pkg.process;
  const behavior = pkg.behavior;
  if (!process.name?.trim() || !process.description?.trim() || !behavior.systemPrompt?.trim()) throw new Error("Package name, description, and system prompt are required");
  if (!executionProfiles.includes(process.executionProfile as (typeof executionProfiles)[number])) throw new Error("Package execution profile is invalid");
  if (!["fast", "balanced", "reasoning"].includes(process.modelProfile)) throw new Error("Package model profile is invalid");
  if (!["observe", "suggest", "approve", "guarded", "autonomous"].includes(process.autonomy)) throw new Error("Package autonomy is invalid");
  if (!["low", "medium", "high"].includes(process.riskLevel)) throw new Error("Package risk level is invalid");
  if (![process.tools, behavior.instructions, behavior.guardrails].every((list) => Array.isArray(list) && list.every((item) => typeof item === "string"))) throw new Error("Package lists must contain only strings");
  if (JSON.stringify(value).length > 256_000) throw new Error("Process package exceeds 256 KB");
  return { ...pkg, schemaVersion: 1, process: { ...process, name: process.name.trim(), description: process.description.trim(), tools: process.tools.slice(0, 50),
    businessOwner: process.businessOwner || "Unassigned", department: process.department || "Operations", riskLevel: process.riskLevel },
    behavior: { ...behavior, systemPrompt: behavior.systemPrompt.trim(), instructions: behavior.instructions.slice(0, 100), guardrails: behavior.guardrails.slice(0, 100) }, secrets: "excluded" } as PortableProcessPackage;
}

function parseStringArray(value: string | null | undefined): string[] { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []; } catch { return []; } }
function slug(value: string): string { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "process"; }
