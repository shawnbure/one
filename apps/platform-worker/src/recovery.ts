import type { Env } from "./types";

export type RecoveryStatus = "open" | "investigating" | "resolved" | "accepted_risk";
export type RecoveryAction = "assign" | "investigate" | "resolve" | "accept_risk" | "reopen";

interface RecoveryRow {
  id: string;
  execution_id: string;
  blueprint_id: string;
  process_name: string;
  execution_status: "failed" | "blocked" | "deferred";
  error: string | null;
  contract_error: string | null;
  input_contract_status: string | null;
  output_contract_status: string | null;
  assigned_to: string | null;
  assignee_name: string | null;
  status: RecoveryStatus;
  due_at: string;
  revision: number;
  resolution: string | null;
  resolution_execution_id: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function getRecoveryOperations(env: Env, tenantId: string) {
  const [tasks, owners] = await Promise.all([
    env.DB.prepare(`SELECT r.id, r.execution_id, e.blueprint_id, b.name process_name,
      e.status execution_status, e.error, e.contract_error, e.input_contract_status, e.output_contract_status,
      r.assigned_to, assignee.display_name assignee_name, r.status, r.due_at, r.revision,
      r.resolution, r.resolution_execution_id, resolver.display_name resolved_by_name,
      r.resolved_at, r.created_at, r.updated_at
      FROM execution_recovery_tasks r
      JOIN executions e ON e.id=r.execution_id AND e.tenant_id=r.tenant_id
      JOIN agent_blueprints b ON b.id=e.blueprint_id AND b.tenant_id=e.tenant_id
      LEFT JOIN tenant_members assignee ON assignee.id=r.assigned_to AND assignee.tenant_id=r.tenant_id
      LEFT JOIN tenant_members resolver ON resolver.id=r.resolved_by AND resolver.tenant_id=r.tenant_id
      WHERE r.tenant_id=?
      ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'investigating' THEN 1 ELSE 2 END,
        datetime(r.due_at), datetime(r.updated_at) DESC LIMIT 100`).bind(tenantId).all<RecoveryRow>(),
    env.DB.prepare(`SELECT id, display_name, role FROM tenant_members
      WHERE tenant_id=? AND status='active' AND role IN ('admin','builder','owner','operator')
      ORDER BY display_name`).bind(tenantId).all<{ id: string; display_name: string; role: string }>()
  ]);
  const now = Date.now();
  return {
    summary: summarize(tasks.results, now),
    tasks: tasks.results.map((task) => ({
      ...task,
      category: recoveryCategory(task),
      nextAction: recoveryNextAction(task),
      overdue: !["resolved", "accepted_risk"].includes(task.status) &&
        new Date(normalizeDate(task.due_at)).valueOf() < now
    })),
    eligibleOwners: owners.results
  };
}

export async function updateRecoveryTask(env: Env, tenantId: string, actorId: string, role: string,
  taskId: string, raw: {
    action?: string; expectedRevision?: number; assignedTo?: string;
    note?: string; resolutionExecutionId?: string;
  }) {
  const input = validateRecoveryChange(raw);
  if (input.action === "accept_risk" && !["admin", "owner"].includes(role)) {
    throw new Error("Only an administrator or owner can accept unresolved risk");
  }
  const current = await env.DB.prepare(`SELECT r.*, e.blueprint_id FROM execution_recovery_tasks r
    JOIN executions e ON e.id=r.execution_id AND e.tenant_id=r.tenant_id
    WHERE r.id=? AND r.tenant_id=?`).bind(taskId, tenantId).first<{
      id: string; execution_id: string; blueprint_id: string; assigned_to: string | null;
      status: RecoveryStatus; revision: number;
    }>();
  if (!current) throw new Error("Recovery task was not found");
  if (current.revision !== input.expectedRevision) throw new RecoveryConflict();

  let assignedTo = current.assigned_to;
  if (input.action === "assign") {
    assignedTo = input.assignedTo!;
    const owner = await env.DB.prepare(`SELECT id FROM tenant_members WHERE id=? AND tenant_id=?
      AND status='active' AND role IN ('admin','builder','owner','operator')`)
      .bind(assignedTo, tenantId).first();
    if (!owner) throw new Error("Recovery owner must be an active same-tenant operator");
  }

  let resolutionExecutionId: string | null = null;
  if (input.action === "resolve") {
    resolutionExecutionId = input.resolutionExecutionId!;
    const verified = await env.DB.prepare(`SELECT id FROM executions WHERE id=? AND tenant_id=?
      AND blueprint_id=? AND status='completed'`).bind(
      resolutionExecutionId, tenantId, current.blueprint_id
    ).first();
    if (!verified || resolutionExecutionId === current.execution_id) {
      throw new Error("Resolution requires a completed same-process verification run");
    }
  }

  const status: RecoveryStatus = input.action === "investigate" ? "investigating" :
    input.action === "resolve" ? "resolved" :
      input.action === "accept_risk" ? "accepted_risk" :
        input.action === "reopen" ? "open" : current.status;
  const terminal = ["resolved", "accepted_risk"].includes(status);
  const result = await env.DB.prepare(`UPDATE execution_recovery_tasks SET
    assigned_to=?, status=?, resolution=?, resolution_execution_id=?, resolved_by=?, resolved_at=?,
    revision=revision+1, updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND revision=?`).bind(
    assignedTo, status, terminal ? input.note : null, resolutionExecutionId,
    terminal ? actorId : null, terminal ? new Date().toISOString() : null,
    taskId, tenantId, input.expectedRevision
  ).run();
  if (result.meta.changes !== 1) throw new RecoveryConflict();
  return {
    id: taskId, executionId: current.execution_id, action: input.action, status,
    assignedTo, resolutionExecutionId, revision: input.expectedRevision + 1,
    note: input.note
  };
}

export function validateRecoveryChange(raw: {
  action?: string; expectedRevision?: number; assignedTo?: string;
  note?: string; resolutionExecutionId?: string;
}) {
  const allowed = ["assign", "investigate", "resolve", "accept_risk", "reopen"];
  if (!raw.action || !allowed.includes(raw.action)) throw new Error("A valid recovery action is required");
  if (!Number.isInteger(raw.expectedRevision) || Number(raw.expectedRevision) < 1) {
    throw new Error("A valid expected recovery revision is required");
  }
  const action = raw.action as RecoveryAction;
  if (action === "assign" && !raw.assignedTo?.trim()) throw new Error("A recovery owner is required");
  const note = raw.note?.trim() ?? "";
  if (action !== "assign" && (note.length < 5 || note.length > 1_000)) {
    throw new Error("Recovery evidence must be 5 to 1,000 characters");
  }
  if (action === "resolve" && !raw.resolutionExecutionId?.trim()) {
    throw new Error("A completed verification execution is required");
  }
  return {
    action, expectedRevision: Number(raw.expectedRevision), assignedTo: raw.assignedTo?.trim(),
    note, resolutionExecutionId: raw.resolutionExecutionId?.trim()
  };
}

export class RecoveryConflict extends Error {
  constructor() { super("Recovery task changed; reload before trying again"); }
}

function summarize(tasks: RecoveryRow[], now: number) {
  return {
    open: tasks.filter((task) => task.status === "open").length,
    investigating: tasks.filter((task) => task.status === "investigating").length,
    overdue: tasks.filter((task) => !["resolved", "accepted_risk"].includes(task.status) &&
      new Date(normalizeDate(task.due_at)).valueOf() < now).length,
    resolved: tasks.filter((task) => task.status === "resolved").length,
    acceptedRisk: tasks.filter((task) => task.status === "accepted_risk").length
  };
}

function recoveryCategory(task: RecoveryRow) {
  if (task.input_contract_status === "failed" || task.output_contract_status === "failed" || task.contract_error) {
    return "process_contract";
  }
  if (task.execution_status === "blocked" || task.error?.toLowerCase().includes("dlp")) return "safety_control";
  if (task.execution_status === "deferred") return "operating_control";
  return "execution_failure";
}

function recoveryNextAction(task: RecoveryRow) {
  const category = recoveryCategory(task);
  if (category === "process_contract") return "Correct the contract or payload, run the release evaluation, then verify with a completed replay.";
  if (category === "safety_control") return "Inspect the data-protection and admission evidence; change policy only with owner authorization.";
  if (category === "operating_control") return "Confirm the process operating mode, budget, and schedule boundary before replaying.";
  return "Inspect the execution timeline, correct the recorded cause, and verify the repair with a completed replay.";
}

function normalizeDate(value: string) {
  return value.endsWith("Z") || value.includes("+") ? value : `${value.replace(" ", "T")}Z`;
}
