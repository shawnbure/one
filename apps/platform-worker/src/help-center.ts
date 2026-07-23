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
      "Durable actors retain sticky conversation or entity state. Long-term facts require a cited source turn, DLP, expiry, and human approval; instant agents do not create durable memory.",
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
      "A conversation process is sticky to its thread and may use separately approved actor-local facts; an instant process does not retain conversational memory.",
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

type HelpRequestRow = {
  id: string; category: string; priority: string; subject: string; detail: string;
  blueprint_id: string | null; execution_id: string | null; status: string; assigned_to: string | null;
  due_at: string; resolution: string | null; revision: number; created_at: string; updated_at: string;
  requester_name: string | null; assignee_name: string | null; process_name: string | null;
};

type TeamProgressRow = {
  id: string; display_name: string; email: string; role: Role; last_seen_at: string | null;
  acknowledged_modules: string | null; last_acknowledged_at: string | null;
};

export async function getHelpCenter(env: Env, tenantId: string, actorId: string, role: Role) {
  const staffView = ["admin", "builder", "owner", "operator"].includes(role);
  const teamView = ["admin", "owner"].includes(role);
  const [processResult, acknowledgementResult, requestResult, teamResult, ownerResult] = await Promise.all([
    env.DB.prepare(`SELECT b.id, b.name, b.description, b.execution_profile, b.autonomy, b.status,
      b.business_owner, b.department, b.risk_level, d.purpose, d.current_steps
      FROM agent_blueprints b LEFT JOIN process_discovery d
        ON d.blueprint_id = b.id AND d.tenant_id = b.tenant_id
      WHERE b.tenant_id = ? ORDER BY b.name`).bind(tenantId).all<ProcessRow>(),
    env.DB.prepare(`SELECT module_id, module_version, acknowledged_at FROM learning_acknowledgements
      WHERE tenant_id = ? AND actor_id = ? ORDER BY acknowledged_at DESC`)
      .bind(tenantId, actorId).all<{ module_id: string; module_version: number; acknowledged_at: string }>(),
    env.DB.prepare(`SELECT h.id, h.category, h.priority, h.subject, h.detail, h.blueprint_id, h.execution_id,
      h.status, h.assigned_to, h.due_at, h.resolution, h.revision, h.created_at, h.updated_at,
      requester.display_name requester_name, assignee.display_name assignee_name, b.name process_name
      FROM help_requests h
      LEFT JOIN tenant_members requester ON requester.id = h.created_by AND requester.tenant_id = h.tenant_id
      LEFT JOIN tenant_members assignee ON assignee.id = h.assigned_to AND assignee.tenant_id = h.tenant_id
      LEFT JOIN agent_blueprints b ON b.id = h.blueprint_id AND b.tenant_id = h.tenant_id
      WHERE h.tenant_id = ? ${staffView ? "" : "AND h.created_by = ?"}
      ORDER BY CASE h.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
        CASE h.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, h.created_at DESC LIMIT 50`)
      .bind(...(staffView ? [tenantId] : [tenantId, actorId])).all<HelpRequestRow>(),
    teamView ? env.DB.prepare(`SELECT m.id, m.display_name, m.email, m.role, m.last_seen_at,
      GROUP_CONCAT(DISTINCT CASE WHEN a.module_version = ? THEN a.module_id END) acknowledged_modules,
      MAX(CASE WHEN a.module_version = ? THEN a.acknowledged_at END) last_acknowledged_at
      FROM tenant_members m LEFT JOIN learning_acknowledgements a
        ON a.tenant_id = m.tenant_id AND a.actor_id = m.id
      WHERE m.tenant_id = ? AND m.status = 'active'
      GROUP BY m.id ORDER BY m.display_name LIMIT 100`)
      .bind(MODULE_VERSION, MODULE_VERSION, tenantId).all<TeamProgressRow>() : Promise.resolve({ results: [] as TeamProgressRow[] }),
    staffView ? env.DB.prepare(`SELECT id, display_name, role FROM tenant_members
      WHERE tenant_id = ? AND status = 'active' AND role IN ('admin','builder','owner','operator')
      ORDER BY display_name LIMIT 100`).bind(tenantId)
      .all<{ id: string; display_name: string; role: Role }>() :
      Promise.resolve({ results: [] as Array<{ id: string; display_name: string; role: Role }> })
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
    supportRequests: requestResult.results,
    supportAccess: { canManage: staffView, canViewTeamProgress: teamView },
    supportOwners: ownerResult.results,
    teamProgress: teamResult.results.map((member) => {
      const applicable = modules.filter((module) => module.roles.includes(member.role));
      const acknowledged = new Set((member.acknowledged_modules ?? "").split(",").filter(Boolean));
      const completed = applicable.filter((module) => acknowledged.has(module.id)).length;
      return { ...member, completed, total: applicable.length };
    }),
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

export async function createHelpRequest(
  env: Env, tenantId: string, actorId: string, input: Record<string, unknown>, now = new Date()
) {
  const category = enumValue(input.category, ["how_to", "unexpected_result", "access", "incident", "privacy"], "category");
  const requestedPriority = enumValue(input.priority, ["low", "normal", "high"], "priority");
  const priority = ["incident", "privacy"].includes(category) ? "high" : requestedPriority;
  const subject = boundedText(input.subject, "Subject", 5, 120);
  const detail = boundedText(input.detail, "Detail", 10, 2000);
  const blueprintId = optionalId(input.blueprintId);
  const executionId = optionalId(input.executionId);
  const [context, defaultOwner] = await Promise.all([
    blueprintId || executionId ? env.DB.prepare(`SELECT b.id blueprint_id, e.id execution_id
      FROM tenants t
      LEFT JOIN agent_blueprints b ON b.tenant_id = t.id AND b.id = ?
      LEFT JOIN executions e ON e.tenant_id = t.id AND e.id = ?
      WHERE t.id = ? LIMIT 1`).bind(blueprintId, executionId, tenantId)
      .first<{ blueprint_id: string | null; execution_id: string | null }>() : Promise.resolve(null),
    env.DB.prepare(`SELECT m.id FROM tenant_lifecycle_settings l JOIN tenant_members m
      ON m.id = l.support_owner_id AND m.tenant_id = l.tenant_id
      WHERE l.tenant_id = ? AND m.status = 'active' AND m.role IN ('admin','builder','owner','operator') LIMIT 1`)
      .bind(tenantId).first<{ id: string }>()
  ]);
  if (blueprintId || executionId) {
    if ((blueprintId && context?.blueprint_id !== blueprintId) ||
      (executionId && context?.execution_id !== executionId)) {
      throw new Error("Linked process or execution does not belong to this organization");
    }
  }
  const id = crypto.randomUUID();
  const dueHours = priority === "high" ? 4 : priority === "normal" ? 24 : 72;
  const dueAt = new Date(now.getTime() + dueHours * 60 * 60_000).toISOString();
  await env.DB.prepare(`INSERT INTO help_requests
    (id, tenant_id, created_by, category, priority, subject, detail, blueprint_id, execution_id, assigned_to, due_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, tenantId, actorId, category, priority, subject, detail, blueprintId, executionId,
      defaultOwner?.id ?? null, dueAt).run();
  return { id, status: "open", category, priority, assignedTo: defaultOwner?.id ?? null, dueAt, revision: 1 };
}

export async function updateHelpRequest(
  env: Env, tenantId: string, actorId: string, requestId: string, input: Record<string, unknown>
) {
  const expectedRevision = Number(input.expectedRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new Error("Current request revision is required");
  const status = enumValue(input.status, ["open", "in_progress", "resolved"], "status");
  const assignedTo = optionalId(input.assignedTo);
  const resolution = typeof input.resolution === "string" ? input.resolution.trim() : "";
  if (status === "resolved" && (resolution.length < 10 || resolution.length > 2000)) {
    throw new Error("Resolution evidence must be between 10 and 2000 characters");
  }
  if (status !== "resolved" && resolution) throw new Error("Resolution evidence is only accepted when resolving a request");
  if (assignedTo) {
    const assignee = await env.DB.prepare(`SELECT id FROM tenant_members WHERE id = ? AND tenant_id = ?
      AND status = 'active' AND role IN ('admin','builder','owner','operator') LIMIT 1`)
      .bind(assignedTo, tenantId).first<{ id: string }>();
    if (!assignee) throw new Error("Support owner must be an active administrator, builder, owner, or operator");
  }
  const existing = await env.DB.prepare(`SELECT status FROM help_requests WHERE id = ? AND tenant_id = ? LIMIT 1`)
    .bind(requestId, tenantId).first<{ status: string }>();
  if (!existing) throw new Error("Help request was not found");
  if (existing.status === "resolved") {
    throw new Error("Resolved help requests are immutable; create a follow-up request");
  }
  const result = await env.DB.prepare(`UPDATE help_requests SET status = ?, assigned_to = ?,
    resolution = ?, resolved_by = ?, resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP ELSE NULL END,
    revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND tenant_id = ? AND revision = ?`)
    .bind(status, assignedTo, status === "resolved" ? resolution : null,
      status === "resolved" ? actorId : null, status, requestId, tenantId, expectedRevision).run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new HelpRequestConflict();
  return { id: requestId, from: existing.status, status, assignedTo, revision: expectedRevision + 1 };
}

export class HelpRequestConflict extends Error {
  constructor() { super("This help request changed while you were reviewing it. Refresh and try again."); }
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

function boundedText(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== "string" || value.trim().length < min || value.trim().length > max) {
    throw new Error(`${label} must be between ${min} and ${max} characters`);
  }
  return value.trim();
}

function optionalId(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > 120) throw new Error("Linked identifier is invalid");
  return value.trim();
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new Error(`Invalid ${label}`);
  return value as T;
}
