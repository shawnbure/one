import { createProcessFromTemplate } from "./discovery";
import type { Env } from "./types";

export interface OpportunityInput {
  name: string;
  purpose: string;
  businessOwner: string;
  department: string;
  currentSteps?: string;
  systems?: string[];
  exceptions?: string[];
  volumePerMonth: number;
  minutesPerItem: number;
  hourlyCost: number;
  errorRate: number;
  riskLevel: "low" | "medium" | "high";
  dataClassification: "public" | "internal" | "confidential" | "restricted";
  externalAction: boolean;
  humanJudgment: "low" | "some" | "high";
  recommendedTemplateId?: string | null;
}

export async function listOpportunities(env: Env, tenantId: string) {
  const { results } = await env.DB.prepare(`SELECT o.*, t.name recommended_template_name, b.name blueprint_name
    FROM process_opportunities o
    LEFT JOIN process_templates t ON t.id=o.recommended_template_id
    LEFT JOIN agent_blueprints b ON b.id=o.blueprint_id AND b.tenant_id=o.tenant_id
    WHERE o.tenant_id=? ORDER BY
      CASE o.status WHEN 'approved' THEN 0 WHEN 'qualified' THEN 1 WHEN 'captured' THEN 2
        WHEN 'converted' THEN 3 ELSE 4 END,
      o.priority_score DESC, o.created_at DESC`).bind(tenantId).all();
  return results;
}

export async function createOpportunity(env: Env, tenantId: string, actorId: string, input: OpportunityInput) {
  const normalized = await normalize(env, input);
  const scores = scoreOpportunity(normalized);
  const id = `opp-${crypto.randomUUID()}`;
  const snapshot = opportunitySnapshot(normalized, scores, "captured");
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO process_opportunities
      (id, tenant_id, name, purpose, business_owner, department, current_steps, systems_json, exceptions_json,
       volume_per_month, minutes_per_item, hourly_cost, error_rate, risk_level, data_classification,
       external_action, human_judgment, impact_score, feasibility_score, priority_score,
       recommended_template_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, tenantId, normalized.name, normalized.purpose, normalized.businessOwner, normalized.department,
        normalized.currentSteps, JSON.stringify(normalized.systems), JSON.stringify(normalized.exceptions),
        normalized.volumePerMonth, normalized.minutesPerItem, normalized.hourlyCost, normalized.errorRate,
        normalized.riskLevel, normalized.dataClassification, normalized.externalAction ? 1 : 0,
        normalized.humanJudgment, scores.impactScore, scores.feasibilityScore, scores.priorityScore,
        normalized.recommendedTemplateId, actorId),
    env.DB.prepare(`INSERT INTO opportunity_revisions
      (id, tenant_id, opportunity_id, revision, snapshot_json, change_reason, changed_by)
      VALUES (?, ?, ?, 1, ?, 'Initial captured evidence', ?)`)
      .bind(crypto.randomUUID(), tenantId, id, JSON.stringify(snapshot), actorId),
    audit(env, tenantId, actorId, "opportunity.captured", id, scores)
  ]);
  return { id, status: "captured", ...scores };
}

export async function updateOpportunity(env: Env, tenantId: string, actorId: string, opportunityId: string,
  expectedRevision: number, changeReason: string, input: OpportunityInput) {
  const current = await env.DB.prepare("SELECT revision, status FROM process_opportunities WHERE id=? AND tenant_id=?")
    .bind(opportunityId, tenantId).first<{ revision: number; status: string }>();
  if (!current) throw new Error("Opportunity was not found");
  if (current.status === "converted") throw new Error("Converted opportunity evidence is immutable");
  if (!Number.isInteger(expectedRevision) || expectedRevision !== Number(current.revision)) {
    throw new OpportunityRevisionConflict("Opportunity changed since it was opened. Reload before saving.");
  }
  const reason = String(changeReason ?? "").trim();
  if (!reason || reason.length > 500) throw new Error("A change reason of 500 characters or fewer is required");
  const normalized = await normalize(env, input);
  const scores = scoreOpportunity(normalized);
  const nextRevision = expectedRevision + 1;
  const snapshot = opportunitySnapshot(normalized, scores, "captured");
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE process_opportunities SET name=?, purpose=?, business_owner=?, department=?,
      current_steps=?, systems_json=?, exceptions_json=?, volume_per_month=?, minutes_per_item=?, hourly_cost=?,
      error_rate=?, risk_level=?, data_classification=?, external_action=?, human_judgment=?,
      impact_score=?, feasibility_score=?, priority_score=?, recommended_template_id=?,
      status='captured', qualification_note=NULL, qualified_by=NULL, qualified_at=NULL,
      revision=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=? AND revision=? AND status!='converted'`)
      .bind(normalized.name, normalized.purpose, normalized.businessOwner, normalized.department,
        normalized.currentSteps, JSON.stringify(normalized.systems), JSON.stringify(normalized.exceptions),
        normalized.volumePerMonth, normalized.minutesPerItem, normalized.hourlyCost, normalized.errorRate,
        normalized.riskLevel, normalized.dataClassification, normalized.externalAction ? 1 : 0,
        normalized.humanJudgment, scores.impactScore, scores.feasibilityScore, scores.priorityScore,
        normalized.recommendedTemplateId, nextRevision, opportunityId, tenantId, expectedRevision),
    env.DB.prepare(`INSERT INTO opportunity_revisions
      (id, tenant_id, opportunity_id, revision, snapshot_json, change_reason, changed_by)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), tenantId, opportunityId, nextRevision, JSON.stringify(snapshot), reason, actorId),
    audit(env, tenantId, actorId, "opportunity.evidence_revised", opportunityId,
      { fromRevision: expectedRevision, toRevision: nextRevision, changeReason: reason, qualificationReset: true })
  ]);
  if (Number((results[0] as { meta?: { changes?: number } }).meta?.changes) !== 1) {
    throw new OpportunityRevisionConflict("Opportunity changed while it was being saved. Reload and try again.");
  }
  return { id: opportunityId, revision: nextRevision, status: "captured", ...scores };
}

export async function listOpportunityRevisions(env: Env, tenantId: string, opportunityId: string) {
  const exists = await env.DB.prepare("SELECT id FROM process_opportunities WHERE id=? AND tenant_id=?")
    .bind(opportunityId, tenantId).first();
  if (!exists) throw new Error("Opportunity was not found");
  const { results } = await env.DB.prepare(`SELECT revision, snapshot_json, change_reason, changed_by, created_at
    FROM opportunity_revisions WHERE opportunity_id=? AND tenant_id=? ORDER BY revision DESC`)
    .bind(opportunityId, tenantId).all();
  return results;
}

export async function qualifyOpportunity(env: Env, tenantId: string, actorId: string, opportunityId: string,
  input: { status: "qualified" | "approved" | "declined"; qualificationNote?: string }) {
  if (!["qualified", "approved", "declined"].includes(input.status)) throw new Error("A valid qualification status is required");
  const note = String(input.qualificationNote ?? "").trim();
  if (note.length > 1500) throw new Error("Qualification note must be 1,500 characters or fewer");
  const current = await env.DB.prepare("SELECT status FROM process_opportunities WHERE id=? AND tenant_id=?")
    .bind(opportunityId, tenantId).first<{ status: string }>();
  if (!current) throw new Error("Opportunity was not found");
  if (current.status === "converted") throw new Error("A converted opportunity cannot be requalified");
  await env.DB.batch([
    env.DB.prepare(`UPDATE process_opportunities SET status=?, qualification_note=?, qualified_by=?,
      qualified_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
      .bind(input.status, note || null, actorId, opportunityId, tenantId),
    audit(env, tenantId, actorId, `opportunity.${input.status}`, opportunityId, { note: note || null })
  ]);
  return { id: opportunityId, status: input.status, qualificationNote: note || null };
}

export async function convertOpportunity(env: Env, tenantId: string, actorId: string, opportunityId: string,
  templateId?: string) {
  const row = await env.DB.prepare("SELECT * FROM process_opportunities WHERE id=? AND tenant_id=?")
    .bind(opportunityId, tenantId).first<Record<string, string | number | null>>();
  if (!row) throw new Error("Opportunity was not found");
  if (!["qualified", "approved", "converted"].includes(String(row.status))) {
    throw new Error("Qualify the opportunity before creating a process");
  }
  if (row.blueprint_id) return { id: String(row.blueprint_id), status: "draft", reused: true };
  const selectedTemplate = templateId || String(row.recommended_template_id ?? "");
  if (!selectedTemplate) throw new Error("Select a starting template");
  const processId = `opportunity-${await shortDigest(opportunityId)}`;
  const result = await createProcessFromTemplate(env, tenantId, actorId, {
    templateId: selectedTemplate,
    name: String(row.name),
    purpose: String(row.purpose),
    businessOwner: String(row.business_owner),
    department: String(row.department),
    riskLevel: String(row.risk_level) as "low" | "medium" | "high",
    baseline: {
      volumePerMonth: Number(row.volume_per_month),
      minutesPerItem: Number(row.minutes_per_item),
      hourlyCost: Number(row.hourly_cost),
      errorRate: Number(row.error_rate)
    }
  }, processId);
  await env.DB.batch([
    env.DB.prepare(`UPDATE process_opportunities SET status='converted', blueprint_id=?,
      converted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id=? AND tenant_id=?`)
      .bind(result.id, opportunityId, tenantId),
    audit(env, tenantId, actorId, "opportunity.converted", opportunityId,
      { blueprintId: result.id, templateId: selectedTemplate })
  ]);
  return { ...result, reused: false };
}

export function scoreOpportunity(input: Pick<OpportunityInput, "volumePerMonth" | "minutesPerItem" | "hourlyCost" |
  "errorRate" | "riskLevel" | "dataClassification" | "externalAction" | "humanJudgment" | "systems" | "exceptions">) {
  const monthlyHours = input.volumePerMonth * input.minutesPerItem / 60;
  const monthlyLaborCost = monthlyHours * input.hourlyCost;
  const impactScore = Math.max(1, Math.min(100,
    Math.min(20, Math.round(input.volumePerMonth / 25)) +
    Math.min(35, Math.round(monthlyHours / 5)) +
    Math.min(25, Math.round(monthlyLaborCost / 250)) +
    Math.min(20, Math.round(input.errorRate * 200))));
  const riskPenalty = { low: 0, medium: 8, high: 18 }[input.riskLevel];
  const dataPenalty = { public: 0, internal: 2, confidential: 8, restricted: 15 }[input.dataClassification];
  const judgmentPenalty = { low: 0, some: 8, high: 20 }[input.humanJudgment];
  const integrationPenalty = Math.min(18, Math.max(0, (input.systems?.length ?? 0) - 1) * 5);
  const exceptionPenalty = Math.min(12, (input.exceptions?.length ?? 0) * 2);
  const feasibilityScore = Math.max(10, 100 - riskPenalty - dataPenalty - judgmentPenalty -
    integrationPenalty - exceptionPenalty - (input.externalAction ? 8 : 0));
  return { impactScore, feasibilityScore, priorityScore: Math.round(impactScore * .6 + feasibilityScore * .4) };
}

async function normalize(env: Env, input: OpportunityInput): Promise<OpportunityInput & {
  currentSteps: string; systems: string[]; exceptions: string[]; recommendedTemplateId: string | null;
}> {
  const text = (value: unknown, label: string, max: number) => {
    const result = String(value ?? "").trim();
    if (!result) throw new Error(`${label} is required`);
    if (result.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
    return result;
  };
  const numbers = [input.volumePerMonth, input.minutesPerItem, input.hourlyCost, input.errorRate];
  if (!numbers.every(Number.isFinite) || numbers.some((value) => value < 0) || input.errorRate > 1) {
    throw new Error("Baseline values must be non-negative and error rate must be between 0 and 1");
  }
  if (!["low", "medium", "high"].includes(input.riskLevel) ||
      !["public", "internal", "confidential", "restricted"].includes(input.dataClassification) ||
      !["low", "some", "high"].includes(input.humanJudgment)) throw new Error("Opportunity control values are invalid");
  const list = (value: unknown) => Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, 20).map((item) => item.slice(0, 160)) : [];
  let recommendedTemplateId = input.recommendedTemplateId || null;
  if (recommendedTemplateId) {
    const template = await env.DB.prepare("SELECT id FROM process_templates WHERE id=?").bind(recommendedTemplateId).first();
    if (!template) throw new Error("Recommended template was not found");
  }
  return { name: text(input.name, "Opportunity name", 140), purpose: text(input.purpose, "Purpose", 1200),
    businessOwner: text(input.businessOwner, "Business owner", 160), department: text(input.department, "Department", 120),
    currentSteps: String(input.currentSteps ?? "").trim().slice(0, 3000), systems: list(input.systems),
    exceptions: list(input.exceptions), volumePerMonth: Number(input.volumePerMonth),
    minutesPerItem: Number(input.minutesPerItem), hourlyCost: Number(input.hourlyCost),
    errorRate: Number(input.errorRate), riskLevel: input.riskLevel,
    dataClassification: input.dataClassification, externalAction: Boolean(input.externalAction),
    humanJudgment: input.humanJudgment, recommendedTemplateId };
}

function audit(env: Env, tenantId: string, actorId: string, eventType: string, opportunityId: string, detail: unknown) {
  return env.DB.prepare(`INSERT INTO audit_events
    (id, tenant_id, actor_id, event_type, target_type, target_id, detail_json)
    VALUES (?, ?, ?, ?, 'opportunity', ?, ?)`)
    .bind(crypto.randomUUID(), tenantId, actorId, eventType, opportunityId, JSON.stringify(detail));
}

function opportunitySnapshot(input: OpportunityInput & { currentSteps: string; systems: string[]; exceptions: string[];
  recommendedTemplateId: string | null }, scores: ReturnType<typeof scoreOpportunity>, status: string) {
  return { ...input, ...scores, status };
}

export class OpportunityRevisionConflict extends Error {}

async function shortDigest(value: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...digest.slice(0, 8)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
