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
  autonomy_level?: string | null;
  action_risk?: string | null;
  review_state: "decision_pending" | "information_requested" | "escalated";
  escalation_level: number;
  last_activity_at: string | null;
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
export interface ApprovalMessage {
  id: string;
  author_id: string;
  author_email: string;
  kind: "comment" | "information_request" | "information_response" | "escalation";
  body: string;
  created_at: string;
}
export interface ApprovalAssignee {
  id: string;
  email: string;
  display_name: string;
  role: "admin" | "owner" | "operator" | "reviewer";
}

export interface ToolActionDispatch {
  id: string;
  approval_id: string;
  execution_id: string;
  invocation_id: string;
  tool_name: string;
  handler_key: string | null;
  status: "pending" | "queued" | "processing" | "retrying" | "completed" | "failed" | "enqueue_failed" | "rejected";
  input_json: string;
  output_json: string | null;
  provider_resource_id: string | null;
  attempt_count: number;
  last_error: string | null;
  approved_by: string;
  created_at: string;
  enqueued_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}
export interface ToolActionOperation extends ToolActionDispatch {
  process_name: string;
  approval_title: string | null;
}
export interface ToolActionOperationsData {
  summary: Array<{ status: ToolActionDispatch["status"]; count: number }>;
  actions: ToolActionOperation[];
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
  process_release_id?: string | null;
  input_contract_status?: "not_configured" | "pending" | "passed" | "failed";
  output_contract_status?: "not_configured" | "pending" | "passed" | "failed";
  contract_error?: string | null;
  autonomy_level?: string | null;
  autonomy_disposition?: string | null;
  approval_id?: string | null;
  tool_policy_json?: string | null;
}
export interface QueueOperation {
  id: string;
  execution_id: string;
  blueprint_id: string;
  process_name: string | null;
  source: "api" | "webhook" | "schedule" | "replay";
  status: "queued" | "processing" | "retrying" | "completed" | "deferred" | "dead_lettered" | "enqueue_failed";
  attempt_count: number;
  replayed_from: string | null;
  last_error: string | null;
  enqueued_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
  replayable: number;
}
export interface QueueOperationsData {
  summary: Array<{ status: QueueOperation["status"]; count: number }>;
  jobs: QueueOperation[];
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
  input_schema_json: string | null;
  output_schema_json: string | null;
  tool_policy_json: string | null;
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
  activeTools: string[];
  topology: {
    nodes: Array<{ id: string; type: string; label: string }>;
    edges: Array<{ from: string; to: string }>;
  };
}
export interface ProcessSchedule {
  id: string;
  blueprint_id: string;
  process_name: string;
  execution_profile: string;
  name: string;
  cadence: "hourly" | "daily" | "weekly";
  time_utc: string | null;
  weekday_utc: number | null;
  identity_key: string | null;
  status: "active" | "paused";
  next_run_at: string;
  last_dispatched_at: string | null;
  last_execution_id: string | null;
  dispatch_count: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}
export interface ScheduleDispatch {
  id: string;
  schedule_id: string;
  blueprint_id: string;
  execution_id: string;
  scheduled_for: string;
  status: "queued" | "completed" | "failed" | "deferred";
  error: string | null;
  created_at: string;
  completed_at: string | null;
}
export interface ScheduleData {
  schedules: ProcessSchedule[];
  dispatches: ScheduleDispatch[];
}

export interface GovernanceData {
  processes: Array<Record<string, string>>;
  connections: Array<Record<string, string | number | null>>;
  knowledge: Array<Record<string, string>>;
  evaluations: Array<Record<string, string | number>>;
  retention: Array<Record<string, string | number>>;
  members: Array<Record<string, string>>;
  audit: Array<Record<string, string>>;
  incidents: Array<{ id: string; title: string; severity: string; status: string; process_name: string | null;
    blueprint_id: string | null; owner_id: string | null; category: string; impact: string; containment_mode: string | null;
    opened_at: string; updated_at: string; resolved_at: string | null }>;
  tenantControl: { mode: "active" | "drain" | "emergency_stop"; incident_id: string | null; reason: string | null;
    updated_by: string; updated_at: string | null };
  dlpRules: Array<{ detector: string; label: string; action: "audit" | "redact" | "block";
    direction: "input" | "output" | "both"; enabled: number; updated_by: string; updated_at: string }>;
  dlpEvents: Array<{ direction: string; stage: string; detector: string; action: string; match_count: number;
    execution_id: string | null; blueprint_id: string | null; created_at: string }>;
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
export interface KnowledgeCitation {
  sourceId: string;
  sourceName: string;
  chunkId: string;
  score: number;
  excerpt: string;
  provenance: string;
}
export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  version: number;
  adapter_kind: "mock" | "http" | "microsoft" | "database" | "import_export";
  handler_key: string | null;
  connection_id: string | null;
  connection_name: string | null;
  connection_status: string | null;
  connection_secret_configured: number | null;
  handler_ready: number;
  access_mode: "read" | "write";
  risk_level: "low" | "medium" | "high";
  input_schema_json: string;
  output_schema_json: string;
  data_classification: "public" | "internal" | "confidential" | "restricted";
  owner: string;
  rate_limit_per_minute: number;
  support_instructions: string;
  enabled: number;
  process_names: string;
  process_ids: string;
}
export interface ToolAdapterDefinition {
  key: string;
  label: string;
  adapterKind: string;
  accessMode: "read" | "write";
  riskLevel: "low" | "medium" | "high";
  scope: string;
  inputSchema: Record<string, unknown>;
}
export interface ExecutionKnowledgeCitation {
  source_id: string;
  source_name: string;
  chunk_id: string;
  ordinal: number;
  score: number;
  provenance: string;
  excerpt: string;
  created_at: string;
}
export interface ToolInvocation {
  id: string;
  tool_name: string;
  tool_version: number;
  status: "simulated" | "proposed" | "completed" | "failed" | "denied";
  execution_mode: "simulation" | "proposal_only" | "bound";
  access_mode: "read" | "write";
  risk_level: "low" | "medium" | "high";
  adapter_kind: string;
  input_json: string;
  output_json: string | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
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
export interface ProcessOpportunity {
  id: string;
  name: string;
  purpose: string;
  business_owner: string;
  department: string;
  current_steps: string;
  systems_json: string;
  exceptions_json: string;
  volume_per_month: number;
  minutes_per_item: number;
  hourly_cost: number;
  error_rate: number;
  risk_level: "low" | "medium" | "high";
  data_classification: "public" | "internal" | "confidential" | "restricted";
  external_action: number;
  human_judgment: "low" | "some" | "high";
  impact_score: number;
  feasibility_score: number;
  priority_score: number;
  status: "captured" | "qualified" | "approved" | "declined" | "converted";
  recommended_template_id: string | null;
  recommended_template_name: string | null;
  qualification_note: string | null;
  blueprint_id: string | null;
  blueprint_name: string | null;
  revision: number;
  conversion_check_total: number;
  conversion_check_complete: number;
  release_check_total: number;
  release_check_complete: number;
  created_at: string;
}
export interface OpportunityRevision {
  revision: number;
  snapshot_json: string;
  change_reason: string | null;
  changed_by: string;
  created_at: string;
}
export interface OpportunityReadinessCheck {
  id: string;
  check_key: string;
  label: string;
  stage: "conversion" | "release";
  status: "open" | "confirmed" | "not_applicable";
  evidence: string | null;
  owner_id: string | null;
  owner_email: string | null;
  owner_name: string | null;
  due_at: string | null;
  updated_at: string | null;
}
export interface OpportunityReadinessData {
  checks: OpportunityReadinessCheck[];
  conversion: { complete: number; total: number; ready: boolean };
  release: { complete: number; total: number; ready: boolean };
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
export interface ServicePrincipal {
  id: string;
  access_common_name: string;
  display_name: string;
  role: "operator" | "viewer";
  status: "active" | "suspended";
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
    updated_at: string; credential_name: string | null; credential_configured: number;
    owner_id: string | null; owner_email: string | null; owner_name: string | null;
    acknowledgement_required: number; escalation_minutes: number }>;
  events: Array<{ id: string; event_type: string; severity: string; title: string; detail: string; delivery_status: string;
    attempt_count: number; last_error: string | null; response_status: number | null; created_at: string;
    channel: string | null; acknowledgement_required: number | null; escalation_minutes: number | null;
    owner_name: string | null; acknowledged_at: string | null; acknowledged_by_name: string | null;
    acknowledgement_note: string | null; escalated_at: string | null }>;
  credentials: Array<{ id: string; name: string; provider: string; secret_binding: string; purpose: string; status: string;
    last_validated_at: string | null; configured: number }>;
  microsoftEmail: null | { account_email: string | null; account_name: string | null; status: string; configured: number };
}
export interface UsageData {
  summary: { executions: number; evaluation_cases: number; input_tokens: number; output_tokens: number; total_tokens: number; estimated_cost_usd: number };
  budget: { monthly_limit_usd: number; warning_percent: number; hard_limit: number } | null;
  models: Array<{ model_id: string; label: string; input_usd_per_million: number; output_usd_per_million: number; context_tokens: number; pricing_effective_at: string; pricing_source: string }>;
  byModel: Array<{ model: string; executions: number; total_tokens: number; estimated_cost_usd: number }>;
  byProcess: Array<{ blueprint_id: string; process_name: string; executions: number; total_tokens: number; estimated_cost_usd: number }>;
  recent: Array<{ id: string; blueprint_id: string; model: string; input_tokens: number; output_tokens: number; total_tokens: number; estimated_cost_usd: number; started_at: string }>;
  estimateNotice: string;
}
export interface EvaluationDetail {
  scenario: { id: string; name: string; process_name: string; status: string; gate_threshold: number; active_release_id: string | null };
  cases: Array<{ id: string; name: string; input_text: string; assertions_json: string; weight: number; enabled: number; source: string; redaction_json: string; created_at: string }>;
  runs: Array<{ id: string; release_id: string; release_version: number | null; model_profile: string | null; status: string; score: number;
    passed_assertions: number; assertion_count: number; case_count: number; total_tokens: number; estimated_cost_usd: number;
    evidence_json: string; created_at: string }>;
  caseResults: Array<{ id: string; run_id: string; case_id: string; status: string; passed_assertions: number; assertion_count: number;
    output_preview: string | null; model: string | null; total_tokens: number; estimated_cost_usd: number; latency_ms: number;
    evidence_json: string; error: string | null }>;
  suites: Array<{ id: string; release_id: string; evaluation_run_id: string | null; mode: "regression" | "shadow";
    status: string; score: number | null; error: string | null; started_at: string | null; completed_at: string | null; created_at: string }>;
  humanReviews: Array<{ id: string; case_result_id: string; reviewer_id: string; score: number;
    verdict: "acceptable" | "needs_work" | "unsafe"; notes: string | null; updated_at: string }>;
  modelTrials: Array<{ id: string; release_id: string; baseline_profile: string; candidate_profile: string; status: string;
    baseline_score: number | null; candidate_score: number | null; baseline_cost_usd: number | null; candidate_cost_usd: number | null;
    baseline_tokens: number | null; candidate_tokens: number | null; recommendation: string | null; error: string | null;
    completed_at: string | null; created_at: string }>;
  rubricTemplates: RubricTemplate[];
  rubricPackageReviews: Array<{
    id: string;
    package_digest: string;
    schema_version: string;
    publisher_name: string;
    publisher_key_id: string | null;
    signature_status: "verified" | "unsigned";
    template_count: number;
    status: "pending" | "approved" | "rejected";
    submitted_by: string;
    submitted_at: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
  }>;
  rubricPublisherTrust: Array<{
    id: string;
    publisher_name: string;
    publisher_key_id: string;
    policy: "manual" | "auto_approve" | "block";
    status: "active" | "suspended";
    created_by: string;
    created_at: string;
    updated_at: string;
  }>;
  modelProfiles: Array<{ id: string; label: string; model: string; use: string }>;
}
export interface RubricCriterion {
  criterion: string;
  dimension: "groundedness" | "completeness" | "safety" | "clarity" | "format";
  weight: number;
}
export interface RubricTemplate {
  id: string;
  name: string;
  description: string;
  criteria_json: string;
  enabled: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}
export interface RubricPackage {
  schema: "workrr-rubrics/v1" | "workrr-rubrics/v2";
  exportedAt?: string;
  issuedAt?: string;
  publisher?: { name: string; keyId: string; publicKey: JsonWebKey };
  signature?: string;
  templates: Array<{
    name: string;
    description: string;
    criteria: RubricCriterion[];
    enabled: boolean;
  }>;
}
export interface EvaluationDataset {
  schema: "workrr-evaluation/v1";
  exportedAt?: string;
  scenario: {
    name?: string;
    category?: string;
    gateThreshold: number;
    cases: Array<{
      name: string;
      input: string;
      assertions: Array<Record<string, unknown>>;
      weight: number;
      enabled: boolean;
    }>;
  };
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
    request<{ data: ApprovalDetail; audit: AuditEvent[]; actions: ToolActionDispatch[]; messages: ApprovalMessage[] }>(
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
    request<{ updated: boolean; dispatched: number; enqueueFailed: number }>(
      `/api/approvals/${encodeURIComponent(id)}/${decision}`,
      { method: "POST", body: JSON.stringify({ note }) },
    ),
  retryToolAction: (id: string) =>
    request<{ updated: boolean; status: string }>(
      `/api/tool-actions/${encodeURIComponent(id)}/retry`,
      { method: "POST" },
    ),
  cancelToolAction: (id: string, note?: string) =>
    request<{ updated: boolean; status: string }>(
      `/api/tool-actions/${encodeURIComponent(id)}/cancel`,
      { method: "POST", body: JSON.stringify({ note }) },
    ),
  assignApproval: (id: string, assignedTo: string) =>
    request<{ updated: boolean; assignedTo: string; displayName: string }>(
      `/api/approvals/${encodeURIComponent(id)}/assign`,
      { method: "POST", body: JSON.stringify({ assignedTo }) },
    ),
  approvalAssignees: () =>
    request<{ data: ApprovalAssignee[] }>("/api/approval-assignees"),
  addApprovalMessage: (id: string, kind: ApprovalMessage["kind"], body: string) =>
    request<{ data: { message: ApprovalMessage; reviewState: Approval["review_state"]; escalationLevel: number } }>(
      `/api/approvals/${encodeURIComponent(id)}/messages`,
      { method: "POST", body: JSON.stringify({ kind, body }) },
    ),
  executions: () => request<{ data: Execution[] }>("/api/executions"),
  queueOperations: () => request<{ data: QueueOperationsData }>("/api/queue-operations"),
  toolActions: () => request<{ data: ToolActionOperationsData }>("/api/tool-actions"),
  replayQueueJob: (id: string) =>
    request<{ data: { queueJobId: string; executionId: string; status: string } }>(
      `/api/queue-jobs/${encodeURIComponent(id)}/replay`, { method: "POST" },
    ),
  execution: (id: string) =>
    request<{ data: Execution; approvals: Approval[]; audit: AuditEvent[]; citations: ExecutionKnowledgeCitation[];
      toolInvocations: ToolInvocation[]; toolActions: ToolActionDispatch[] }>(
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
  schedules: (processId?: string) =>
    request<{ data: ScheduleData }>(
      `/api/process-schedules${processId ? `?process=${encodeURIComponent(processId)}` : ""}`,
    ),
  createSchedule: (processId: string, body: {
    name: string; cadence: string; timeUtc?: string; weekdayUtc?: number; input: string; identityKey?: string;
  }) => request<{ id: string; status: string; nextRunAt: string }>(
    `/api/processes/${encodeURIComponent(processId)}/schedules`,
    { method: "POST", body: JSON.stringify(body) },
  ),
  updateSchedule: (id: string, body: { status?: string }) =>
    request<{ id: string; status?: string }>(`/api/process-schedules/${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
  runSchedule: (id: string) =>
    request<{ scheduleId: string; executionId: string; status: string }>(
      `/api/process-schedules/${encodeURIComponent(id)}/run`, { method: "POST" },
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
      inputSchema?: Record<string, unknown> | null;
      outputSchema?: Record<string, unknown> | null;
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
  createKnowledgeSource: async (form: FormData) => {
    const response = await fetch("/api/knowledge-sources", { method: "POST", body: form });
    const payload = await response.json().catch(() => ({})) as { data?: { id: string; status: string }; error?: string };
    if (!response.ok) throw new ApiError(payload.error ?? `Request failed (${response.status})`, response.status);
    return payload as { data: { id: string; status: string } };
  },
  queryKnowledge: (query: string, blueprintId?: string) =>
    request<{ data: KnowledgeCitation[] }>("/api/knowledge/query", {
      method: "POST", body: JSON.stringify({ query, blueprintId }),
    }),
  reindexKnowledgeSource: (id: string) =>
    request<{ data: { id: string; status: string } }>(
      `/api/knowledge-sources/${encodeURIComponent(id)}/reindex`, { method: "POST", body: "{}" }),
  reviewKnowledgeSource: (id: string, expiresAt?: string | null) =>
    request<{ data: { id: string; status: string; expiresAt: string | null; updated: boolean } }>(
      `/api/knowledge-sources/${encodeURIComponent(id)}/review`,
      { method: "POST", body: JSON.stringify({ expiresAt: expiresAt || null }) }),
  deleteKnowledgeSource: (id: string) =>
    request<{ data: { id: string; deleted: boolean } }>(
      `/api/knowledge-sources/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
  opportunities: () => request<{ data: ProcessOpportunity[] }>("/api/opportunities"),
  createOpportunity: (body: Record<string, unknown>) =>
    request<{ data: { id: string; status: string; impactScore: number; feasibilityScore: number; priorityScore: number } }>(
      "/api/opportunities", { method: "POST", body: JSON.stringify(body) }),
  updateOpportunity: (id: string, body: Record<string, unknown>) =>
    request<{ data: { id: string; revision: number; status: string; impactScore: number;
      feasibilityScore: number; priorityScore: number } }>(
      `/api/opportunities/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  opportunityRevisions: (id: string) =>
    request<{ data: OpportunityRevision[] }>(`/api/opportunities/${encodeURIComponent(id)}/revisions`),
  opportunityReadiness: (id: string) =>
    request<{ data: OpportunityReadinessData }>(`/api/opportunities/${encodeURIComponent(id)}/readiness`),
  updateOpportunityReadiness: (id: string, checkKey: string, body: {
    status: "open" | "confirmed" | "not_applicable"; evidence: string; ownerId: string; dueAt: string | null;
  }) => request<{ data: { opportunityId: string; checkKey: string; status: string; ownerId: string | null;
    dueAt: string | null } }>(
    `/api/opportunities/${encodeURIComponent(id)}/readiness/${encodeURIComponent(checkKey)}`,
    { method: "PATCH", body: JSON.stringify(body) }),
  qualifyOpportunity: (id: string, status: "qualified" | "approved" | "declined", qualificationNote: string) =>
    request<{ data: { id: string; status: string; qualificationNote: string | null } }>(
      `/api/opportunities/${encodeURIComponent(id)}/qualification`,
      { method: "PATCH", body: JSON.stringify({ status, qualificationNote }) }),
  convertOpportunity: (id: string, templateId: string) =>
    request<{ data: { id: string; status: string; opportunityScore: number; reused: boolean } }>(
      `/api/opportunities/${encodeURIComponent(id)}/convert`,
      { method: "POST", body: JSON.stringify({ templateId }) }),
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
  servicePrincipals: () => request<{ data: ServicePrincipal[] }>("/api/service-principals"),
  createServicePrincipal: (body: { commonName: string; displayName: string; role: "operator" | "viewer" }) =>
    request<{ id: string; status: string }>("/api/service-principals", {
      method: "POST", body: JSON.stringify(body),
    }),
  updateServicePrincipal: (id: string, body: { role?: "operator" | "viewer"; status?: "active" | "suspended" }) =>
    request<{ updated: boolean }>(`/api/service-principals/${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
  value: () => request<{ data: ValueData }>("/api/value"),
  runEvaluation: (id: string, releaseId?: string) => request<{ data: { id: string; status: string; score: number;
    passedAssertions: number; assertionCount: number; caseCount: number; totalTokens: number; estimatedCostUsd: number } }>(
      `/api/evaluations/${id}/run`, { method: "POST", body: JSON.stringify({ releaseId }) }),
  evaluation: (id: string) => request<{ data: EvaluationDetail }>(`/api/evaluations/${encodeURIComponent(id)}`),
  createEvaluationCase: (id: string, body: { name: string; input: string; expectedPhrases: string[];
    prohibitedPhrases: string[]; format: "text" | "json"; maxChars: number;
    dimension: "groundedness" | "completeness" | "safety" | "clarity" | "format";
    assertionWeight: number; caseWeight: number; rubricCriterion: string; rubricTemplateId: string }) =>
    request<{ data: { id: string; assertionCount: number } }>(`/api/evaluations/${encodeURIComponent(id)}/cases`,
      { method: "POST", body: JSON.stringify(body) }),
  createRubricTemplate: (body: { name: string; description: string; criteria: RubricCriterion[] }) =>
    request<{ data: { id: string; name: string; description: string; criteria: RubricCriterion[]; enabled: number } }>(
      "/api/evaluation-rubrics", { method: "POST", body: JSON.stringify(body) }),
  updateRubricTemplate: (id: string, body: { enabled?: boolean }) =>
    request<{ data: { id: string; name: string; description: string; criteria: RubricCriterion[]; enabled: number } }>(
      `/api/evaluation-rubrics/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  exportRubricPackage: () =>
    request<{ data: RubricPackage }>("/api/evaluation-rubrics/package"),
  importRubricPackage: (body: RubricPackage) =>
    request<{ data: { imported: number; skipped: number; totalTemplates?: number; activationRequired: number;
      pendingReview?: string; status?: string; duplicate?: boolean } }>(
      "/api/evaluation-rubrics/package", { method: "POST", body: JSON.stringify(body) }),
  reviewRubricPackage: (id: string, decision: "approved" | "rejected", note = "") =>
    request<{ data: { id: string; status: string; imported: number; skipped: number; activationRequired: number } }>(
      `/api/evaluation-rubric-reviews/${encodeURIComponent(id)}/${decision}`,
      { method: "POST", body: JSON.stringify({ note }) }),
  trustRubricPublisher: (reviewId: string, policy: "manual" | "auto_approve" | "block") =>
    request<{ data: { id: string; publisherName: string; keyId: string; policy: string; status: string } }>(
      `/api/evaluation-rubric-publishers/from-review/${encodeURIComponent(reviewId)}`,
      { method: "POST", body: JSON.stringify({ policy }) }),
  updateRubricPublisher: (id: string, body: { policy?: "manual" | "auto_approve" | "block";
    status?: "active" | "suspended" }) =>
    request<{ data: { id: string; updated: boolean } }>(
      `/api/evaluation-rubric-publishers/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(body) }),
  exportEvaluationDataset: (id: string) =>
    request<{ data: EvaluationDataset }>(`/api/evaluations/${encodeURIComponent(id)}/dataset`),
  importEvaluationDataset: (id: string, body: EvaluationDataset) =>
    request<{ data: { imported: number; skipped: number; assertionCount: number;
      gateThreshold: number | null; totalCases: number } }>(
      `/api/evaluations/${encodeURIComponent(id)}/dataset`, { method: "POST", body: JSON.stringify(body) }),
  queueEvaluationSuite: (id: string, body: { releaseId?: string; mode?: "regression" | "shadow" } = {}) =>
    request<{ data: { id: string; status: string; releaseId: string; mode: string } }>(
      `/api/evaluations/${encodeURIComponent(id)}/suites`, { method: "POST", body: JSON.stringify(body) }),
  queueModelTrial: (id: string, body: { candidateProfile: string; releaseId?: string }) =>
    request<{ data: { id: string; status: string; baselineProfile: string; candidateProfile: string } }>(
      `/api/evaluations/${encodeURIComponent(id)}/model-trials`, { method: "POST", body: JSON.stringify(body) }),
  createIncident: (body: { title: string; severity: string; category: string; impact: string; blueprintId?: string }) =>
    request<{ data: { id: string; status: string } }>("/api/incidents", { method: "POST", body: JSON.stringify(body) }),
  transitionIncident: (id: string, body: { status: string; note: string; rootCause?: string; resolution?: string }) =>
    request<{ data: { id: string; from: string; status: string } }>(
      `/api/incidents/${encodeURIComponent(id)}/transition`, { method: "POST", body: JSON.stringify(body) }),
  setTenantMode: (body: { mode: "active" | "drain" | "emergency_stop"; reason: string; incidentId?: string }) =>
    request<{ data: { mode: string; incidentId: string | null } }>("/api/tenant/mode",
      { method: "PATCH", body: JSON.stringify(body) }),
  updateDlpRule: (detector: string, body: { action: "audit" | "redact" | "block";
    direction: "input" | "output" | "both"; enabled: boolean }) =>
    request<{ data: { detector: string; action: string; direction: string; enabled: boolean } }>(
      `/api/dlp/rules/${encodeURIComponent(detector)}`, { method: "PATCH", body: JSON.stringify(body) }),
  promoteEvaluationSample: (id: string, body: { executionId: string; name?: string; expectedPhrases: string[];
    prohibitedPhrases: string[]; format: "text" | "json"; maxChars: number }) =>
    request<{ data: { id: string; assertionCount: number } }>(
      `/api/evaluations/${encodeURIComponent(id)}/samples`, { method: "POST", body: JSON.stringify(body) }),
  reviewEvaluationResult: (id: string, body: { score: number; verdict: "acceptable" | "needs_work" | "unsafe"; notes?: string }) =>
    request<{ data: { id: string; caseResultId: string; score: number; verdict: string } }>(
      `/api/evaluation-results/${encodeURIComponent(id)}/review`, { method: "PUT", body: JSON.stringify(body) }),
  testConnection: (id: string) => request<{ data: { id: string; status: string; detail: string; checkedAt: string } }>(`/api/connections/${id}/test`, { method: "POST" }),
  updateConnectionLifecycle: (id: string, body: {
    credentialExpiresAt: string | null; rotationOwner: string | null; lastRotatedAt: string | null;
  }) => request<{ data: { id: string; name: string; credentialExpiresAt: string | null;
    rotationOwner: string | null; lastRotatedAt: string | null } }>(
    `/api/connections/${encodeURIComponent(id)}/lifecycle`, { method: "PATCH", body: JSON.stringify(body) }),
  tools: () => request<{ data: ToolDefinition[] }>("/api/tools"),
  toolAdapters: () => request<{ data: ToolAdapterDefinition[] }>("/api/tool-adapters"),
  createTool: (body: Record<string, unknown>) =>
    request<{ data: { id: string; name: string; processCount: number } }>("/api/tools",
      { method: "POST", body: JSON.stringify(body) }),
  setToolBindings: (id: string, processIds: string[]) =>
    request<{ data: { id: string; processCount: number } }>(`/api/tools/${encodeURIComponent(id)}/bindings`,
      { method: "PUT", body: JSON.stringify({ processIds }) }),
  setToolEnabled: (id: string, enabled: boolean) =>
    request<{ data: { id: string; enabled: boolean } }>(`/api/tools/${encodeURIComponent(id)}/status`,
      { method: "PATCH", body: JSON.stringify({ enabled }) }),
  startMicrosoftOAuth: (capabilities: string[]) =>
    request<{ data: { authorizationUrl: string; capabilities: string[]; scopes: string[]; expiresAt: string } }>(
      "/api/oauth/microsoft/start", { method: "POST", body: JSON.stringify({ capabilities }) }),
  disconnectMicrosoft: () =>
    request<{ data: { disconnected: boolean; connectionId?: string } }>(
      "/api/oauth/microsoft/disconnect", { method: "POST", body: "{}" }),
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
  updateNotificationPolicy: (id: string, body: { enabled?: boolean; destination?: string | null;
    ownerId?: string | null; acknowledgementRequired?: boolean; escalationMinutes?: number }) =>
    request<{ updated: boolean }>(`/api/notifications/policies/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  testNotificationPolicy: (id: string) =>
    request<{ eventId: string; status: string }>(`/api/notifications/policies/${id}/test`, { method: "POST", body: "{}" }),
  acknowledgeNotification: (id: string, note: string) =>
    request<{ data: { id: string; acknowledged: boolean; duplicate: boolean } }>(
      `/api/notifications/events/${encodeURIComponent(id)}/acknowledge`,
      { method: "POST", body: JSON.stringify({ note }) }),
  importProcessPackage: (body: unknown) => request<{ data: { id: string; status: string } }>("/api/process-packages/import", { method: "POST", body: JSON.stringify(body) }),
  usage: () => request<{ data: UsageData }>("/api/usage"),
  updateBudget: (body: { monthlyLimitUsd: number; warningPercent: number; hardLimit: boolean }) =>
    request<{ updated: boolean }>("/api/usage/budget", { method: "PATCH", body: JSON.stringify(body) }),
};
