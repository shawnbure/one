import type { Role } from "./auth";
import type { Env } from "./types";

const MODULE_VERSION = 1;

type LearningModule = {
  id: string;
  version: number;
  title: string;
  summary: string;
  minutes: number;
  roles: Role[];
  steps: string[];
};

const modules: LearningModule[] = [
  {
    id: "private-ai-basics", version: MODULE_VERSION, title: "Private AI operations",
    summary: "Understand where data, agent state, approvals, and model calls live in Workrr.",
    minutes: 6, roles: ["admin", "builder", "owner", "operator", "reviewer", "viewer", "consumer"],
    steps: [
      "D1 stores tenant-scoped configuration, evidence, and operational reporting.",
      "Durable actors retain only sticky conversation or entity state; instant agents do not create durable memory.",
      "Workers AI performs model inference inside the Cloudflare platform, while approvals govern consequential actions.",
      "Activity and API logs explain which release, model, policy, and actor produced an outcome."
    ]
  },
  {
    id: "operator-response", version: MODULE_VERSION, title: "Operate and recover work",
    summary: "Triage waiting, failed, or contained work without using Wrangler.",
    minutes: 8, roles: ["admin", "owner", "operator"],
    steps: [
      "Start in Work inbox for decisions and Activity for failed or deferred executions.",
      "Read the timeline, release identity, contract checks, and tool evidence before retrying.",
      "Use process pause, tenant drain, or emergency stop when the failure can affect additional work.",
      "Record an incident and transition it with evidence before restoring normal operation."
    ]
  },
  {
    id: "human-review", version: MODULE_VERSION, title: "Make a governed decision",
    summary: "Review AI-proposed actions with clear evidence and an attributable decision.",
    minutes: 5, roles: ["admin", "owner", "operator", "reviewer"],
    steps: [
      "Confirm the process, release, source input, proposed action, and affected system.",
      "Request information or escalate when evidence is incomplete; do not approve from the summary alone.",
      "Approve only the exact bounded action shown in the evidence panel.",
      "Add a concise decision note so the audit record explains the judgment."
    ]
  },
  {
    id: "safe-release", version: MODULE_VERSION, title: "Build and release safely",
    summary: "Move a process from draft to production evidence without automatic autonomy promotion.",
    minutes: 10, roles: ["admin", "builder", "owner"],
    steps: [
      "Keep new processes paused while discovery, tools, data contracts, and ownership are completed.",
      "Create an immutable release and run its golden evaluation scenarios.",
      "Review failures, prohibited output, model usage, and tool policy before publishing.",
      "Start in observe or suggest mode and raise autonomy only through explicit owner review."
    ]
  },
  {
    id: "customer-administration", version: MODULE_VERSION, title: "Administer a private environment",
    summary: "Maintain identity, retention, credentials, support ownership, and deployment readiness.",
    minutes: 10, roles: ["admin"],
    steps: [
      "Reconcile Cloudflare Access membership with active Workrr tenant members.",
      "Review connection expiry, retention, budgets, notification owners, and maintenance contacts.",
      "Export the redacted support bundle before escalation; never place credentials in an export.",
      "Use additive migrations and the promotion verifier for environment changes."
    ]
  },
  {
    id: "consumer-safety", version: MODULE_VERSION, title: "Use an AI process safely",
    summary: "Know what to provide, what Workrr remembers, and when to ask a human.",
    minutes: 4, roles: ["consumer"],
    steps: [
      "Provide only information needed for the approved business process.",
      "A conversation process is sticky to its thread; an instant process does not retain conversational memory.",
      "Treat generated output as a recommendation unless the interface shows a completed approved action.",
      "Escalate when the answer lacks evidence, conflicts with policy, or contains unexpected sensitive data."
    ]
  }
];

const roleGuides: Record<Role, { title: string; firstAction: string; escalation: string }> = {
  admin: { title: "Platform administrator", firstAction: "Verify Customer setup, Team & roles, and Governance before enabling work.",
    escalation: "Use tenant drain or emergency stop, then open an incident with containment evidence." },
  builder: { title: "AI builder / FDE", firstAction: "Start with an Opportunity, convert it to a paused process, and complete its release gate.",
    escalation: "Pause the process and hand evidence to its owner when behavior or integration scope is uncertain." },
  owner: { title: "Process owner", firstAction: "Review process value, evaluation evidence, autonomy, and outstanding decisions.",
    escalation: "Lower autonomy or pause the process when business outcomes fall outside the approved boundary." },
  operator: { title: "Operator", firstAction: "Start in Work inbox and Activity; each waiting or failed item should show the next action.",
    escalation: "Create an incident when retries cannot safely resolve the condition." },
  reviewer: { title: "Approver", firstAction: "Review the exact proposal and evidence before recording a decision.",
    escalation: "Request information or escalate instead of approving incomplete evidence." },
  viewer: { title: "Auditor / viewer", firstAction: "Use Activity, Governance, Evaluations, and Usage to inspect evidence without changing state.",
    escalation: "Share the execution or audit identifier with an owner; viewer access remains read-only." },
  consumer: { title: "Employee / consumer", firstAction: "Use only the process entry point assigned to your work and provide the minimum necessary data.",
    escalation: "Stop and contact the process owner when the result is unsupported or sensitive." }
};

type ProcessRow = {
  id: string; name: string; description: string; execution_profile: string; autonomy: string; status: string;
  business_owner: string; department: string; risk_level: string; purpose: string | null; current_steps: string | null;
};

export async function getHelpCenter(env: Env, tenantId: string, actorId: string, role: Role) {
  const [processResult, acknowledgementResult] = await Promise.all([
    env.DB.prepare(`SELECT b.id, b.name, b.description, b.execution_profile, b.autonomy, b.status,
      b.business_owner, b.department, b.risk_level, d.purpose, d.current_steps
      FROM agent_blueprints b LEFT JOIN process_discovery d
        ON d.blueprint_id = b.id AND d.tenant_id = b.tenant_id
      WHERE b.tenant_id = ? ORDER BY b.name`).bind(tenantId).all<ProcessRow>(),
    env.DB.prepare(`SELECT module_id, module_version, acknowledged_at FROM learning_acknowledgements
      WHERE tenant_id = ? AND actor_id = ? ORDER BY acknowledged_at DESC`)
      .bind(tenantId, actorId).all<{ module_id: string; module_version: number; acknowledged_at: string }>()
  ]);
  const acknowledgements = new Map(acknowledgementResult.results.map((row) =>
    [`${row.module_id}:${row.module_version}`, row.acknowledged_at]));
  const available = modules.filter((module) => module.roles.includes(role)).map(({ roles: _roles, ...module }) => ({
    ...module, acknowledgedAt: acknowledgements.get(`${module.id}:${module.version}`) ?? null
  }));
  return {
    roleGuide: roleGuides[role],
    progress: {
      completed: available.filter((module) => module.acknowledgedAt).length,
      total: available.length
    },
    modules: available,
    concepts: [
      { name: "Instant agent", detail: "One request, no sticky conversational identity. Best for classification, extraction, and burst processing." },
      { name: "Durable actor", detail: "A named Agent SDK actor with strongly consistent, thread- or entity-scoped state. Many instances of the same agent definition may serve different consumers." },
      { name: "Workflow", detail: "Durable multi-step orchestration for work that must wait, retry, or survive Worker invocations." },
      { name: "Queue", detail: "Burst absorption and retry delivery for asynchronous jobs; it is not conversational memory." },
      { name: "Approval", detail: "A human checkpoint around one exact proposed action, with decision and execution evidence kept separately." }
    ],
    processRunbooks: processResult.results.map((process) => ({
      ...process,
      purpose: process.purpose || process.description,
      steps: (process.current_steps || "Review input; verify evidence; complete the governed next action.")
        .split(";").map((step) => step.trim()).filter(Boolean),
      memory: memoryDescription(process.execution_profile),
      start: process.status === "paused" ? "This process is paused. An owner or builder must complete readiness before work begins."
        : `Open Activity to inspect runs for this ${process.execution_profile.replaceAll("_", " ")} process.`,
      exception: "Stop, preserve the execution ID, and escalate to the business owner when evidence, policy, or data handling is uncertain."
    }))
  };
}

export async function acknowledgeLearning(
  env: Env, tenantId: string, actorId: string, role: Role, moduleId: string, version: number
) {
  const module = modules.find((item) => item.id === moduleId && item.version === version && item.roles.includes(role));
  if (!module) throw new Error("This learning module is not available for your role or version");
  const id = crypto.randomUUID();
  const result = await env.DB.prepare(`INSERT OR IGNORE INTO learning_acknowledgements
    (id, tenant_id, actor_id, module_id, module_version) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, tenantId, actorId, moduleId, version).run();
  const row = await env.DB.prepare(`SELECT acknowledged_at FROM learning_acknowledgements
    WHERE tenant_id = ? AND actor_id = ? AND module_id = ? AND module_version = ?`)
    .bind(tenantId, actorId, moduleId, version).first<{ acknowledged_at: string }>();
  if (!row) throw new Error("Training acknowledgement could not be recorded");
  return { moduleId, version, acknowledgedAt: row.acknowledged_at, recorded: Number(result.meta.changes ?? 0) > 0 };
}

function memoryDescription(profile: string): string {
  if (["conversation", "consumer", "entity", "shared_shard", "temporary_durable"].includes(profile)) {
    return `Durable actor · state is sticky only to this process's ${profile.replaceAll("_", " ")} identity key.`;
  }
  if (profile === "workflow") return "Workflow state · durable orchestration checkpoints, not an always-running Worker.";
  return "Instant · no sticky agent conversation state is created.";
}
