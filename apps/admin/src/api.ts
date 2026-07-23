import type {
  AgentBlueprint,
  ExecutionRequest,
  ExecutionResult,
} from "@workrr/contracts";

export interface OverviewData {
  activeProcesses: number;
  pendingApprovals: number;
  runs7d: number;
  completed7d: number;
  failed7d: number;
  processRuns: Record<string, number>;
  usage7d: { input_tokens: number; output_tokens: number; total_tokens: number };
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
  tenantName: string;
  accentColor: string;
}

export interface ApprovalDetail extends Approval {
  blueprint_id: string;
  input_preview: string;
  output_preview: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
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
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  started_at: string;
  completed_at: string | null;
  error: string | null;
  autonomy?: string;
  prompt_release_id?: string;
  retry_of?: string | null;
}

export interface ProcessRelease {
  id: string;
  version: number;
  prompt_release_id: string;
  model_profile: string;
  autonomy: string;
  status: "draft" | "published" | "retired";
  release_notes: string;
  created_by: string;
  created_at: string;
  published_at: string | null;
  published_by: string | null;
  checksum: string;
  evaluation_status: "not_run" | "passing" | "failing";
  evaluated_at: string | null;
}

export interface StudioData {
  blueprint: Record<string, string>;
  prompt: {
    system_prompt: string;
    instructions_json: string;
    guardrails_json: string;
    version: number;
    checksum: string;
  };
  releases: ProcessRelease[];
  runStats: Array<{ status: string; count: number }>;
  topology: {
    nodes: Array<{ id: string; type: string; label: string }>;
    edges: Array<{ from: string; to: string }>;
  };
}

export interface GovernanceData {
  processes: Array<Record<string, string>>;
  connections: Array<Record<string, string | number>>;
  knowledge: Array<Record<string, string>>;
  evaluations: Array<Record<string, string | number>>;
  retention: Array<Record<string, string | number>>;
  members: Array<Record<string, string>>;
  audit: Array<Record<string, string>>;
  incidents: Array<Record<string, string>>;
  webhooks: WebhookEndpoint[];
  models: Array<{
    profile: string;
    provider: string;
    processes: number;
    boundary: string;
  }>;
  readiness: Array<{
    id: string;
    label: string;
    ready: boolean;
    detail: string;
  }>;
  dataFlow: string[];
}

export interface ApiLog {
  id: string;
  trace_id: string;
  direction: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  target: string | null;
  actor_id: string | null;
  created_at: string;
}
export interface WebhookEndpoint {
  id: string;
  name: string;
  blueprint_id: string;
  status: string;
  accepted_events_json: string;
  created_at: string;
  last_received_at: string | null;
  secret_configured: number;
}
export interface ProcessTemplate {
  id: string;
  name: string;
  description: string;
  execution_profile: string;
  model_profile: string;
  autonomy: string;
  tools_json: string;
  category: string;
}
export interface Member {
  id: string;
  email: string;
  display_name: string;
  role: string;
  status: string;
  created_at: string;
  last_seen_at: string | null;
}
export interface ValueData {
  totals: { items_processed: number; human_minutes_saved: number; estimated_value: number; override_count: number; failure_count: number };
  byProcess: Array<Record<string, string | number>>;
  discoveries: Array<Record<string, string | number>>;
}
export interface OnboardingData {
  settings: null | { organization_name: string; support_email: string; accent_color: string; default_model_profile: string; data_region: string; initialized_at: string | null };
  checklist: Array<{ id: string; label: string; ready: boolean }>;
  bootstrap: null | { status: "started" | "completed" | "failed"; member_id: string | null; process_id: string | null;
    started_at: string; completed_at: string | null; last_error: string | null };
}
export interface NotificationData {
  policies: Array<{ id: string; event_type: string; channel: string; destination: string | null; enabled: number; severity: string;
    updated_at: string; credential_name: string | null; credential_configured: number }>;
  events: Array<{ id: string; event_type: string; severity: string; title: string; detail: string; delivery_status: string;
    attempt_count: number; last_error: string | null; response_status: number | null; created_at: string }>;
  credentials: Array<{ id: string; name: string; provider: string; secret_binding: string; purpose: string; status: string;
    last_validated_at: string | null; configured: number }>;
}
export interface UsageData {
  summary: { executions: number; input_tokens: number; output_tokens: number; total_tokens: number; estimated_cost_usd: number };
  budget: { monthly_limit_usd: number; warning_percent: number; hard_limit: number } | null;
  models: Array<{ model_id: string; label: string; input_usd_per_million: number; output_usd_per_million: number; context_tokens: number; pricing_effective_at: string; pricing_source: string }>;
  byModel: Array<{ model: string; executions: number; total_tokens: number; estimated_cost_usd: number }>;
  byProcess: Array<{ blueprint_id: string; process_name: string; executions: number; total_tokens: number; estimated_cost_usd: number }>;
  recent: Array<{ id: string; blueprint_id: string; model: string; input_tokens: number; output_tokens: number; total_tokens: number; estimated_cost_usd: number; started_at: string }>;
  estimateNotice: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
  };
  if (!response.ok)
    throw new ApiError(
      payload.error ?? `Request failed (${response.status})`,
      response.status,
    );
  return payload as T;
}

export const api = {
  session: () => request<SessionData>("/api/session"),
  processes: () => request<{ data: AgentBlueprint[] }>("/api/processes"),
  overview: () => request<OverviewData>("/api/overview"),
  approvals: () => request<{ data: Approval[] }>("/api/approvals"),
  approval: (id: string) =>
    request<{ data: ApprovalDetail; audit: AuditEvent[] }>(
      `/api/approvals/${encodeURIComponent(id)}`,
    ),
  execute: (body: ExecutionRequest) =>
    request<ExecutionResult>("/api/execute", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  decideApproval: (
    id: string,
    decision: "approved" | "rejected",
    note?: string,
  ) =>
    request<{ updated: boolean }>(
      `/api/approvals/${encodeURIComponent(id)}/${decision}`,
      { method: "POST", body: JSON.stringify({ note }) },
    ),
  assignApproval: (id: string, assignedTo: string) =>
    request<{ updated: boolean }>(
      `/api/approvals/${encodeURIComponent(id)}/assign`,
      { method: "POST", body: JSON.stringify({ assignedTo }) },
    ),
  executions: () => request<{ data: Execution[] }>("/api/executions"),
  execution: (id: string) =>
    request<{ data: Execution; approvals: Approval[]; audit: AuditEvent[] }>(
      `/api/executions/${encodeURIComponent(id)}`,
    ),
  retryExecution: (id: string) =>
    request<{ executionId: string; status: string }>(
      `/api/executions/${encodeURIComponent(id)}/retry`,
      { method: "POST" },
    ),
  studio: (id: string) =>
    request<{ data: StudioData }>(
      `/api/processes/${encodeURIComponent(id)}/studio`,
    ),
  createRelease: (
    id: string,
    body: {
      systemPrompt: string;
      instructions: string[];
      guardrails: string[];
      modelProfile: string;
      autonomy: string;
      releaseNotes: string;
    },
  ) =>
    request<{ releaseId: string; version: number; status: string }>(
      `/api/processes/${encodeURIComponent(id)}/releases`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  publishRelease: (processId: string, releaseId: string) =>
    request<{ releaseId: string; version: number; status: string }>(
      `/api/processes/${encodeURIComponent(processId)}/releases/${encodeURIComponent(releaseId)}/publish`,
      { method: "POST" },
    ),
  governance: () => request<{ data: GovernanceData }>("/api/governance"),
  setProcessMode: (processId: string, mode: string, reason: string) =>
    request<{ updated: boolean; mode: string }>(
      `/api/processes/${encodeURIComponent(processId)}/mode`,
      { method: "PATCH", body: JSON.stringify({ mode, reason }) },
    ),
  logs: () => request<{ data: ApiLog[] }>("/api/logs"),
  webhooks: () => request<{ data: WebhookEndpoint[] }>("/api/webhooks"),
  setWebhookStatus: (id: string, status: "active" | "disabled") =>
    request<{ updated: boolean; status: string }>(
      `/api/webhooks/${encodeURIComponent(id)}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    ),
  processTemplates: () =>
    request<{ data: ProcessTemplate[] }>("/api/process-templates"),
  createProcess: (body: {
    templateId: string;
    name: string;
    purpose: string;
    businessOwner: string;
    department: string;
    riskLevel: string;
    baseline: {
      volumePerMonth: number;
      minutesPerItem: number;
      hourlyCost: number;
      errorRate: number;
    };
  }) =>
    request<{ id: string; status: string; opportunityScore: number }>(
      "/api/processes",
      { method: "POST", body: JSON.stringify(body) },
    ),
  members: () => request<{ data: Member[] }>("/api/members"),
  createMember: (body: { email: string; name: string; role: string }) =>
    request<{ id: string; status: string }>("/api/members", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateMember: (id: string, body: { role?: string; status?: string }) =>
    request<{ updated: boolean }>(`/api/members/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  value: () => request<{ data: ValueData }>("/api/value"),
  runEvaluation: (id: string) => request<{ data: { id: string; status: string; passedAssertions: number; assertionCount: number } }>(`/api/evaluations/${id}/run`, { method: "POST" }),
  testConnection: (id: string) => request<{ data: { id: string; status: string; detail: string; checkedAt: string } }>(`/api/connections/${id}/test`, { method: "POST" }),
  onboarding: () => request<{ data: OnboardingData }>("/api/onboarding"),
  updateOnboarding: (body: { organizationName: string; supportEmail: string; accentColor: string; defaultModelProfile: string; dataRegion: string }) =>
    request<{ data: OnboardingData }>("/api/onboarding", { method: "PUT", body: JSON.stringify(body) }),
  bootstrapCustomer: (body: {
    idempotencyKey: string;
    organizationName: string;
    supportEmail: string;
    accentColor: string;
    defaultModelProfile: string;
    dataRegion: string;
    member?: { email: string; name: string; role: string };
    firstProcess: {
      templateId: string; name: string; purpose: string; businessOwner: string; department: string; riskLevel: string;
      baseline: { volumePerMonth: number; minutesPerItem: number; hourlyCost: number; errorRate: number };
    };
  }) => request<{ data: OnboardingData & { launch: { status: string; processId: string; memberId: string; alreadyCompleted: boolean } } }>(
    "/api/onboarding/bootstrap", { method: "POST", body: JSON.stringify(body) }),
  notifications: () => request<{ data: NotificationData }>("/api/notifications"),
  updateNotificationPolicy: (id: string, body: { enabled?: boolean; destination?: string | null }) =>
    request<{ updated: boolean }>(`/api/notifications/policies/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  testNotificationPolicy: (id: string) =>
    request<{ eventId: string; status: string }>(`/api/notifications/policies/${id}/test`, { method: "POST", body: "{}" }),
  importProcessPackage: (body: unknown) => request<{ data: { id: string; status: string } }>("/api/process-packages/import", { method: "POST", body: JSON.stringify(body) }),
  usage: () => request<{ data: UsageData }>("/api/usage"),
  updateBudget: (body: { monthlyLimitUsd: number; warningPercent: number; hardLimit: boolean }) =>
    request<{ updated: boolean }>("/api/usage/budget", { method: "PATCH", body: JSON.stringify(body) }),
};
