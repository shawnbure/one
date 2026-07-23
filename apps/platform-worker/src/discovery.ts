import { createDraftRelease } from "./studio";
import type { Env } from "./types";

interface CreateProcessInput {
  templateId: string;
  name: string;
  purpose: string;
  businessOwner: string;
  department: string;
  riskLevel: "low" | "medium" | "high";
  baseline: { volumePerMonth: number; minutesPerItem: number; hourlyCost: number; errorRate: number };
}

interface TemplateRow {
  id: string; execution_profile: string; model_profile: string; autonomy: string; system_prompt: string;
  instructions_json: string; guardrails_json: string; tools_json: string;
}

export async function createProcessFromTemplate(env: Env, tenantId: string, actorId: string, input: CreateProcessInput) {
  if (!input.name?.trim() || !input.purpose?.trim() || !input.templateId) throw new Error("Template, process name, and purpose are required");
  const template = await env.DB.prepare("SELECT * FROM process_templates WHERE id = ?").bind(input.templateId).first<TemplateRow>();
  if (!template) throw new Error("Process template not found");
  const id = `${slug(input.name)}-${crypto.randomUUID().slice(0, 6)}`;
  const now = new Date().toISOString();
  const score = opportunityScore(input.baseline);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO agent_blueprints
      (id, tenant_id, name, description, execution_profile, model_profile, prompt_release_id, autonomy, status, tools_json,
       updated_at, business_owner, department, risk_level, operating_mode)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'draft', ?, ?, ?, ?, ?, 'paused')`)
      .bind(id, tenantId, input.name.trim(), input.purpose.trim(), template.execution_profile, template.model_profile, template.autonomy, template.tools_json, now, input.businessOwner || "Unassigned", input.department || "Operations", input.riskLevel || "medium"),
    env.DB.prepare(`INSERT INTO process_discovery
      (id, tenant_id, blueprint_id, purpose, volume_per_month, minutes_per_item, hourly_cost, error_rate, opportunity_score, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), tenantId, id, input.purpose.trim(), input.baseline.volumePerMonth, input.baseline.minutesPerItem, input.baseline.hourlyCost, input.baseline.errorRate, score, actorId)
  ]);
  const release = await createDraftRelease(env, tenantId, id, actorId, {
    systemPrompt: template.system_prompt,
    instructions: JSON.parse(template.instructions_json) as string[],
    guardrails: JSON.parse(template.guardrails_json) as string[],
    modelProfile: template.model_profile,
    autonomy: template.autonomy,
    releaseNotes: `Initial draft from ${input.templateId}`
  });
  return { id, name: input.name.trim(), status: "draft", opportunityScore: score, release };
}

export async function getValueDashboard(env: Env, tenantId: string) {
  const [totals, byProcess, discoveries] = await Promise.all([
    env.DB.prepare(`SELECT SUM(items_processed) items_processed, SUM(human_minutes_saved) human_minutes_saved,
      SUM(estimated_value) estimated_value, SUM(override_count) override_count, SUM(failure_count) failure_count
      FROM value_snapshots WHERE tenant_id = ? AND period_start >= date('now','-30 days')`).bind(tenantId).first(),
    env.DB.prepare(`SELECT v.*, b.name process_name FROM value_snapshots v JOIN agent_blueprints b ON b.id = v.blueprint_id
      WHERE v.tenant_id = ? ORDER BY v.estimated_value DESC`).bind(tenantId).all(),
    env.DB.prepare(`SELECT d.*, b.name process_name FROM process_discovery d JOIN agent_blueprints b ON b.id = d.blueprint_id
      WHERE d.tenant_id = ? ORDER BY d.opportunity_score DESC`).bind(tenantId).all()
  ]);
  return { totals, byProcess: byProcess.results, discoveries: discoveries.results };
}

function opportunityScore(baseline: CreateProcessInput["baseline"]): number {
  const volume = Math.min(30, Math.round(baseline.volumePerMonth / 50));
  const effort = Math.min(30, Math.round(baseline.minutesPerItem / 2));
  const cost = Math.min(20, Math.round(baseline.hourlyCost / 5));
  const quality = Math.min(20, Math.round(baseline.errorRate * 200));
  return Math.max(1, Math.min(100, volume + effort + cost + quality));
}

function slug(value: string): string { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "process"; }
