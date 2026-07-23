import type { Env } from "./types";

type Row = Record<string, unknown>;

export interface OpportunityImplementationBrief {
  schema: "workrr-opportunity-brief/v1";
  generatedAt: string;
  generatedBy: string;
  organization: string;
  opportunity: {
    id: string; name: string; purpose: string; owner: string; department: string; status: string;
    currentSteps: string; systems: string[]; exceptions: string[]; qualificationNote: string | null;
  };
  baseline: {
    volumePerMonth: number; minutesPerItem: number; manualHoursPerMonth: number;
    hourlyCost: number; estimatedLaborPerMonth: number; errorRatePercent: number;
  };
  prioritization: {
    impact: number; feasibility: number; priority: number;
    method: string[]; interpretation: string;
  };
  controls: {
    risk: string; dataClassification: string; externalAction: boolean; humanJudgment: string;
    minimumPosture: string[];
  };
  cloudflarePattern: {
    template: string | null; executionProfile: string; actorType: string; consumerAffinity: string;
    orchestration: string; state: string; inference: string; asynchronousWork: string;
  };
  delivery: {
    discoveryQuestions: string[]; implementationChecklist: string[]; acceptanceGates: string[];
    nextDecision: string;
  };
  lineage: { blueprintId: string | null; blueprintName: string | null; convertedAt: string | null };
  limitations: string[];
}

export async function getOpportunityImplementationBrief(env: Env, tenantId: string, opportunityId: string,
  generatedBy: string): Promise<OpportunityImplementationBrief | null> {
  const [tenant, row] = await Promise.all([
    env.DB.prepare("SELECT name FROM tenants WHERE id=?").bind(tenantId).first<{ name: string }>(),
    env.DB.prepare(`SELECT o.*, t.name template_name, t.execution_profile, t.model_profile, t.autonomy,
      b.name blueprint_name
      FROM process_opportunities o
      LEFT JOIN process_templates t ON t.id=o.recommended_template_id
      LEFT JOIN agent_blueprints b ON b.id=o.blueprint_id AND b.tenant_id=o.tenant_id
      WHERE o.id=? AND o.tenant_id=?`).bind(opportunityId, tenantId).first<Row>()
  ]);
  if (!row) return null;
  const systems = safeList(row.systems_json);
  const exceptions = safeList(row.exceptions_json);
  const volume = Number(row.volume_per_month);
  const minutes = Number(row.minutes_per_item);
  const hourlyCost = Number(row.hourly_cost);
  const manualHours = volume * minutes / 60;
  const executionProfile = String(row.execution_profile ?? recommendExecution(row));
  const pattern = runtimePattern(executionProfile);
  const externalAction = Number(row.external_action) === 1;
  return {
    schema: "workrr-opportunity-brief/v1",
    generatedAt: new Date().toISOString(),
    generatedBy,
    organization: tenant?.name ?? tenantId,
    opportunity: {
      id: String(row.id), name: String(row.name), purpose: String(row.purpose),
      owner: String(row.business_owner), department: String(row.department), status: String(row.status),
      currentSteps: String(row.current_steps || "Not yet documented"), systems, exceptions,
      qualificationNote: row.qualification_note ? String(row.qualification_note) : null
    },
    baseline: {
      volumePerMonth: volume, minutesPerItem: minutes, manualHoursPerMonth: round(manualHours),
      hourlyCost, estimatedLaborPerMonth: round(manualHours * hourlyCost),
      errorRatePercent: round(Number(row.error_rate) * 100)
    },
    prioritization: {
      impact: Number(row.impact_score), feasibility: Number(row.feasibility_score),
      priority: Number(row.priority_score),
      method: [
        "Impact combines observed monthly volume, calculated manual hours, estimated loaded labor, and rework.",
        "Feasibility starts at 100 and applies visible complexity for systems, exceptions, judgment, risk, sensitive data, and external writes.",
        "Priority weights impact 60% and feasibility 40%; it ranks discovery work and never grants runtime authority."
      ],
      interpretation: Number(row.priority_score) >= 70 ? "High-priority candidate for detailed solution design."
        : Number(row.priority_score) >= 50 ? "Promising candidate; resolve the listed delivery questions before committing."
          : "Keep in discovery until impact or feasibility evidence improves."
    },
    controls: {
      risk: String(row.risk_level), dataClassification: String(row.data_classification),
      externalAction, humanJudgment: String(row.human_judgment),
      minimumPosture: [
        "Begin paused with a draft immutable release and tenant-scoped ownership.",
        "Validate input/output contracts, DLP policy, and representative evaluation cases before publication.",
        ...(externalAction ? [
          "Represent every external write as a typed tool with a fixed implementation and idempotency key.",
          "Require attributable human approval until evaluation evidence supports a reviewed autonomy increase."
        ] : ["Keep initial tools read-only or simulation-only unless a later design explicitly governs a write."]),
        ...(String(row.data_classification) === "restricted"
          ? ["Complete customer security and data-handling review before using restricted data."] : [])
      ]
    },
    cloudflarePattern: {
      template: row.template_name ? String(row.template_name) : null,
      executionProfile, actorType: pattern.actorType, consumerAffinity: pattern.consumerAffinity,
      orchestration: pattern.orchestration, state: pattern.state,
      inference: "Cloudflare Workers AI through a release-pinned model profile; AI Gateway handoff remains optional and explicit.",
      asynchronousWork: "Cloudflare Queues for buffered jobs, Workflows for recoverable multi-step execution, and Cron only for scheduled dispatch/recovery."
    },
    delivery: {
      discoveryQuestions: [
        ...(!systems.length ? ["Which systems contain the authoritative input and destination records?"] : []),
        ...(!exceptions.length ? ["Which exceptions require a person, alternate path, or stop condition?"] : []),
        "What representative inputs, expected outputs, and prohibited outcomes form the acceptance dataset?",
        "Which tenant roles may submit, review, approve, operate, and audit this process?",
        ...(externalAction ? ["What provider idempotency, rollback, and reconciliation evidence is available for each write?"] : []),
        "What retention, deletion, and customer support-access rules apply to the process evidence?"
      ],
      implementationChecklist: [
        "Confirm process owner, support owner, service objective, and escalation path.",
        "Map each input, transformation, decision, exception, output, and authoritative system.",
        "Choose instant, sticky conversation actor, or durable Workflow execution from observed runtime needs.",
        "Define schemas, prompt/release content, model profile, knowledge sources, tools, connection scopes, and DLP controls.",
        "Build golden, failure, adversarial, authorization, retry, and cost-budget tests.",
        "Publish only after readiness gates pass; start in observe/suggest/approval mode and measure against the manual baseline."
      ],
      acceptanceGates: [
        "Customer owner signs off on the current-state baseline and target outcome.",
        "Tenant authorization and cross-tenant negative tests pass.",
        "Evaluation release gate passes on customer-approved examples.",
        "External actions, if any, prove approval, idempotency, retry, and immutable evidence.",
        "Operational owner can pause, recover, inspect cost, and explain the result without developer access."
      ],
      nextDecision: row.status === "converted" ? "Complete the draft process in Process Studio and pass release readiness."
        : ["qualified", "approved"].includes(String(row.status))
          ? "Confirm the starting pattern and convert this candidate into a paused draft process."
          : "Record qualification evidence and decide whether to advance, decline, or continue discovery."
    },
    lineage: {
      blueprintId: row.blueprint_id ? String(row.blueprint_id) : null,
      blueprintName: row.blueprint_name ? String(row.blueprint_name) : null,
      convertedAt: row.converted_at ? String(row.converted_at) : null
    },
    limitations: [
      "Scores depend on customer-supplied assumptions and must be revalidated during implementation.",
      "This brief recommends a platform pattern; it does not authorize data access, model use, or external actions.",
      "No credential values, prompt content, customer records, or provider tokens are included."
    ]
  };
}

export function renderOpportunityBriefHtml(brief: OpportunityImplementationBrief) {
  const list = (values: string[]) => `<ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
  const facts = (values: Array<[string, unknown]>) => `<dl>${values.map(([key, value]) =>
    `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(display(value))}</dd></div>`).join("")}</dl>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Implementation Brief — ${escapeHtml(brief.opportunity.name)}</title><style>
body{margin:0;background:#f3f6f4;color:#17231e;font:14px/1.55 system-ui,-apple-system,sans-serif}main{max-width:1000px;margin:auto;padding:42px 24px}
header,section{margin-bottom:16px;padding:24px;background:#fff;border:1px solid #dce5e0;border-radius:11px}header{background:#102019;color:#fff}
.eyebrow{color:#86c4aa;font-size:11px;font-weight:800;letter-spacing:.14em}h1{margin:8px 0 4px;font-size:29px}h2{margin:0 0 12px;font-size:18px}
p{margin:5px 0}.scores{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.scores div{padding:15px;background:#edf6f1;border-radius:8px}
.scores strong{display:block;font-size:25px}.scores small{color:#52655c}dl{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin:0}
dl div{padding:10px;background:#f7f9f8;border-radius:7px}dt{color:#617169;font-size:10px;font-weight:800;text-transform:uppercase}dd{margin:3px 0 0}
ul{padding-left:20px}.callout{padding:12px;border-left:3px solid #77a78f;background:#f1f7f4}footer{color:#66756e;font-size:11px}
@media(max-width:650px){main{padding:15px 9px}.scores,dl{grid-template-columns:1fr}header,section{padding:17px}}@media print{body{background:#fff}main{max-width:none;padding:0}header,section{break-inside:avoid;border-color:#ccd6d1}}
</style></head><body><main><header><div class="eyebrow">WORKRR ONE · FORWARD-DEPLOYED ENGINEERING</div><h1>${escapeHtml(brief.opportunity.name)}</h1>
<p>${escapeHtml(brief.organization)} · ${escapeHtml(brief.opportunity.department)} · ${escapeHtml(brief.opportunity.status)}</p>
<p>Generated ${escapeHtml(brief.generatedAt)} by ${escapeHtml(brief.generatedBy)}</p></header>
<section><h2>Business opportunity</h2><p>${escapeHtml(brief.opportunity.purpose)}</p>${facts([
    ["Business owner", brief.opportunity.owner], ["Current steps", brief.opportunity.currentSteps],
    ["Systems", brief.opportunity.systems], ["Exceptions", brief.opportunity.exceptions],
    ["Qualification evidence", brief.opportunity.qualificationNote]
  ])}</section>
<section><h2>Manual baseline</h2>${facts([
    ["Items / month", brief.baseline.volumePerMonth], ["Minutes / item", brief.baseline.minutesPerItem],
    ["Manual hours / month", brief.baseline.manualHoursPerMonth], ["Loaded labor / month", money(brief.baseline.estimatedLaborPerMonth)],
    ["Current error / rework", `${brief.baseline.errorRatePercent}%`], ["Loaded hourly cost", money(brief.baseline.hourlyCost)]
  ])}</section>
<section><h2>Prioritization</h2><div class="scores"><div><strong>${brief.prioritization.impact}</strong><small>Impact</small></div>
<div><strong>${brief.prioritization.feasibility}</strong><small>Feasibility</small></div><div><strong>${brief.prioritization.priority}</strong><small>Priority</small></div></div>
<p class="callout">${escapeHtml(brief.prioritization.interpretation)}</p>${list(brief.prioritization.method)}</section>
<section><h2>Control posture</h2>${facts([["Risk", brief.controls.risk], ["Data classification", brief.controls.dataClassification],
    ["External action", brief.controls.externalAction ? "Yes" : "No"], ["Human judgment", brief.controls.humanJudgment]])}${list(brief.controls.minimumPosture)}</section>
<section><h2>Cloudflare execution pattern</h2>${facts([
    ["Starting template", brief.cloudflarePattern.template], ["Execution profile", brief.cloudflarePattern.executionProfile],
    ["Actor type", brief.cloudflarePattern.actorType], ["Consumer affinity", brief.cloudflarePattern.consumerAffinity],
    ["Orchestration", brief.cloudflarePattern.orchestration], ["State", brief.cloudflarePattern.state],
    ["Inference", brief.cloudflarePattern.inference], ["Async and scheduled work", brief.cloudflarePattern.asynchronousWork]
  ])}</section>
<section><h2>Open discovery questions</h2>${list(brief.delivery.discoveryQuestions)}</section>
<section><h2>Implementation checklist</h2>${list(brief.delivery.implementationChecklist)}</section>
<section><h2>Acceptance gates</h2>${list(brief.delivery.acceptanceGates)}<p class="callout"><strong>Next decision:</strong> ${escapeHtml(brief.delivery.nextDecision)}</p></section>
<section><h2>Lineage and limitations</h2>${facts([["Opportunity ID", brief.opportunity.id], ["Process", brief.lineage.blueprintName],
    ["Process ID", brief.lineage.blueprintId], ["Converted", brief.lineage.convertedAt]])}${list(brief.limitations)}</section>
<footer>Schema ${escapeHtml(brief.schema)} · No credential values, prompt content, customer records, or provider tokens are included.</footer>
</main></body></html>`;
}

function runtimePattern(profile: string) {
  if (profile === "conversation") return {
    actorType: "Durable Agent actor, one instance per tenant + process + consumer thread",
    consumerAffinity: "Sticky. Repeated requests for the same thread resolve to the same deterministic Durable Object.",
    orchestration: "Worker admission and policy around an Agents SDK Durable Object; Queue/Workflow only for off-thread work.",
    state: "Thread messages and release-pinned working state in actor-local SQLite; searchable evidence summaries in D1."
  };
  if (profile === "workflow") return {
    actorType: "Durable Cloudflare Workflow instance with ephemeral Worker/AI steps",
    consumerAffinity: "Execution-sticky by workflow instance; separate consumers and submissions do not share working memory.",
    orchestration: "Cloudflare Workflow for retries, waits, approvals, and resumable multi-step state; Queue for buffered admission.",
    state: "Workflow step state and D1 execution evidence; no always-running Worker compute."
  };
  return {
    actorType: "Ephemeral instant Worker execution",
    consumerAffinity: "Non-sticky by default. Each request is isolated unless it explicitly references governed persisted context.",
    orchestration: "Worker request or Queue consumer; promote to Workflow only when retries, waits, or multi-step durability are needed.",
    state: "Bounded request state only, with D1 evidence after execution; no conversational memory."
  };
}

function recommendExecution(row: Row) {
  return Number(row.external_action) || Number(row.volume_per_month) < 200 ? "workflow" : "instant";
}
function safeList(value: unknown): string[] {
  try { return Array.isArray(value) ? value.map(String) : JSON.parse(String(value ?? "[]")) as string[]; } catch { return []; }
}
function display(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}
function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]!);
}
function round(value: number) { return Math.round(value * 100) / 100; }
function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}
