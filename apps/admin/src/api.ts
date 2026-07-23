import type { AgentBlueprint, ExecutionRequest, ExecutionResult } from "@workrr/contracts";

export interface OverviewData {
  activeProcesses: number;
  pendingApprovals: number;
  runs7d: number;
  completed7d: number;
  failed7d: number;
  processRuns: Record<string, number>;
}

export interface Approval {
  id: string;
  execution_id: string;
  action_name: string;
  action_input_json: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requested_at: string;
  title: string | null;
  description: string | null;
  impact: string;
  assigned_to: string | null;
  due_at: string | null;
  decision_note: string | null;
}

export interface SessionData {
  user: { id: string; email: string; name: string; role: string };
  tenantId: string;
}

export interface ApprovalDetail extends Approval {
  blueprint_id: string;
  input_preview: string;
  output_preview: string | null;
  model: string | null;
}

export interface AuditEvent {
  actor_id: string;
  event_type: string;
  detail_json: string;
  created_at: string;
}

export interface Execution {
  id: string;
  blueprint_id: string;
  blueprint_name?: string;
  instance_key: string | null;
  execution_profile: string;
  status: string;
  input_preview: string;
  output_preview: string | null;
  model: string | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  autonomy?: string;
  prompt_release_id?: string;
  retry_of?: string | null;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers }
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new ApiError(payload.error ?? `Request failed (${response.status})`, response.status);
  return payload as T;
}

export const api = {
  session: () => request<SessionData>("/api/session"),
  processes: () => request<{ data: AgentBlueprint[] }>("/api/processes"),
  overview: () => request<OverviewData>("/api/overview"),
  approvals: () => request<{ data: Approval[] }>("/api/approvals"),
  approval: (id: string) => request<{ data: ApprovalDetail; audit: AuditEvent[] }>(`/api/approvals/${encodeURIComponent(id)}`),
  execute: (body: ExecutionRequest) => request<ExecutionResult>("/api/execute", { method: "POST", body: JSON.stringify(body) }),
  decideApproval: (id: string, decision: "approved" | "rejected", note?: string) =>
    request<{ updated: boolean }>(`/api/approvals/${encodeURIComponent(id)}/${decision}`, { method: "POST", body: JSON.stringify({ note }) }),
  assignApproval: (id: string, assignedTo: string) =>
    request<{ updated: boolean }>(`/api/approvals/${encodeURIComponent(id)}/assign`, { method: "POST", body: JSON.stringify({ assignedTo }) }),
  executions: () => request<{ data: Execution[] }>("/api/executions"),
  execution: (id: string) => request<{ data: Execution; approvals: Approval[]; audit: AuditEvent[] }>(`/api/executions/${encodeURIComponent(id)}`),
  retryExecution: (id: string) => request<{ executionId: string; status: string }>(`/api/executions/${encodeURIComponent(id)}/retry`, { method: "POST" })
};
