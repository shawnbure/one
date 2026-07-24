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
  operationalHealth: {
    windowDays: number;
    terminalRuns: number;
    successRate: number | null;
    p95ResponseMs: number | null;
    latencySamples: number;
    activeDurableWork: number;
    activeQueueJobs: number;
    queueAttention: number;
    status: "healthy" | "attention" | "unobserved";
  };
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
  overdue?: number;
  age_minutes?: number;
  sla_escalated_at?: string | null;
  sla_escalation_count?: number;
  revision: number;
  proposal_edited_at?: string | null;
  proposal_edited_by?: string | null;
  assigned_via_delegation_from?: string | null;
  delegated_from_name?: string | null;
}

export interface SessionData {
  user: { id: string; email: string; name: string; role: string };
  tenantId: string;
  tenantName: string;
  accentColor: string;
  environment: string;
  appDomain: string;
}

export interface SolutionPack {
  id: string;
  version: string;
  name: string;
  summary: string;
  audience: string;
  process: {
    name: string; executionProfile: string; modelProfile: string; modelId: string | null;
    autonomy: string; riskLevel: string; dataClassification: string;
    toolCount: number; acceptanceCaseCount: number;
  };
  requiredConnections: Array<{ tool: string; access: string; minimumScope: string; owner: string }>;
  handoffChecks: string[];
  installBehavior: {
    status: "draft"; operatingMode: "paused"; credentialsImported: false;
    schedulesEnabled: false; publicationGranted: false;
  };
}

export interface LaunchpadThread {
  id: string;
  blueprint_id: string;
  process_name: string;
  title: string;
  status: "active" | "archived";
  last_execution_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LaunchpadMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface HelpCenterData {
  roleGuide: { title: string; firstAction: string; escalation: string };
  progress: { completed: number; total: number };
  modules: Array<{
    id: string; version: number; title: string; summary: string; minutes: number;
    steps: string[]; acknowledgedAt: string | null;
  }>;
  concepts: Array<{ name: string; detail: string }>;
  supportAccess: { canManage: boolean; canViewTeamProgress: boolean };
  supportOwners: Array<{ id: string; display_name: string; role: string }>;
  supportRequests: Array<{
    id: string; category: "how_to" | "unexpected_result" | "access" | "incident" | "privacy";
    priority: "low" | "normal" | "high"; subject: string; detail: string;
    blueprint_id: string | null; execution_id: string | null; status: "open" | "in_progress" | "resolved";
    assigned_to: string | null; due_at: string; resolution: string | null; revision: number;
    created_at: string; updated_at: string; requester_name: string | null; assignee_name: string | null;
    process_name: string | null;
  }>;
  teamProgress: Array<{
    id: string; display_name: string; email: string; role: string; last_seen_at: string | null;
    last_acknowledged_at: string | null; completed: number; total: number;
  }>;
  processRunbooks: Array<{
    id: string; name: string; execution_profile: string; autonomy: string; status: string;
    business_owner: string; department: string; risk_level: string; purpose: string;
    steps: string[]; memory: string; start: string; exception: string;
  }>;
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
export interface ApprovalDelegation {
  tenant_id: string;
  member_id: string;
  delegate_id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  enabled: number;
  revision: number;
  member_name: string;
  member_email: string;
  delegate_name: string;
  delegate_email: string;
  active_now: number;
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
  inference_provider?: "workers_ai" | "ai_gateway" | null;
  gateway_id?: string | null;
  gateway_step?: number | null;
  gateway_cache_status?: string | null;
  gateway_log_id?: string | null;
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
export interface ExecutionExplanation {
  schemaVersion: number;
  title: string;
  summary: string;
  reasons: Array<{ label: string; detail: string; state: "positive" | "neutral" | "attention" }>;
  externalImpact: string;
  nextAction: string;
  evidenceCompleteness: "complete" | "partial";
  generatedBy: "deterministic_evidence_rules";
}
export interface ShadowReview {
  id: string;
  execution_id: string;
  blueprint_id: string;
  process_name?: string;
  status: "pending" | "reviewed";
  verdict: "match" | "partial" | "miss" | "unsafe" | null;
  actual_outcome: string | null;
  note: string | null;
  reviewed_by: string | null;
  reviewer_name?: string | null;
  reviewed_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}
export interface GovernedMemoryTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  sourceExecutionId: string | null;
  status: "active" | "quarantined" | "deleted";
  revision: number;
  lastReason: string | null;
  lastChangedBy: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DurableActorFact {
  id: string;
  category: "preference" | "customer_context" | "process_context" | "constraint";
  content: string;
  sourceTurnId: string;
  sourceExecutionId: string | null;
  status: "proposed" | "active" | "retired";
  revision: number;
  proposedBy: string;
  approvedBy: string | null;
  reason: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface ExecutionMemory {
  executionProfile: string;
  storage: "agent_sqlite";
  contextPolicy: { maximumTurns: number; maximumCharacters: number; maximumCharactersPerTurn: number };
  durableFactPromotion: "human_approval_required";
  factPolicy: { maximumActiveFacts: number; maximumFactCharacters: number; maximumContextCharacters: number };
  currentReleaseId: string | null;
  currentVersion: number | null;
  activeReleaseId: string | null;
  activeVersion: number | null;
  migrationAvailable: boolean;
  turns: GovernedMemoryTurn[];
  facts: DurableActorFact[];
}

export interface ActorLocalTask {
  id: string;
  kind: "queue" | "schedule";
  label: string;
  sourceExecutionId: string;
  status: "queued" | "scheduled" | "running" | "completed" | "cancelled" | "failed";
  sdkReferenceId: string | null;
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ActorLocalWork {
  available: true;
  executionProfile: string;
  tasks: ActorLocalTask[];
  schedules: Array<{ id: string; type: string; callback: string; time: number }>;
}
export interface RecoveryTask {
  id: string;
  execution_id: string;
  blueprint_id: string;
  process_name: string;
  execution_status: "failed" | "blocked" | "deferred";
  assigned_to: string | null;
  assignee_name: string | null;
  status: "open" | "investigating" | "resolved" | "accepted_risk";
  due_at: string;
  revision: number;
  resolution: string | null;
  resolution_execution_id: string | null;
  resolved_by_name: string | null;
  resolved_at: string | null;
  category: "process_contract" | "safety_control" | "operating_control" | "execution_failure";
  nextAction: string;
  overdue: boolean;
  created_at: string;
  updated_at: string;
}
export interface RecoveryOperations {
  summary: { open: number; investigating: number; overdue: number; resolved: number; acceptedRisk: number };
  tasks: RecoveryTask[];
  eligibleOwners: Array<{ id: string; display_name: string; role: string }>;
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
  model_id: string | null;
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
  topology_json: string | null;
  data_classification: "public" | "internal" | "confidential" | "restricted";
  review_decision: "approved" | "rejected" | null;
  review_evidence: string | null;
  review_decided_by: string | null;
  review_decided_at: string | null;
  review_decided_by_name: string | null;
}
export interface ProcessReleaseDiff {
  from: { id: string; version: number; status: string; checksum: string } | null;
  to: { id: string; version: number; status: string; checksum: string };
  summary: { changedSections: number; additions: number; removals: number; modifications: number };
  sections: Array<{
    key: string; label: string;
    changes: Array<{ kind: "added" | "removed" | "changed"; label: string;
      before: string | null; after: string | null }>;
  }>;
}
export interface AutonomySafetyData {
  state: {
    enabled: boolean;
    minTerminalRuns: number;
    successThreshold: number;
    windowHours: number;
    cap: "observe" | "suggest" | "approve" | "guarded" | "autonomous" | null;
    reason: string | null;
    trigger: "unsafe_shadow" | "unsafe_evaluation" | "reliability" | null;
    evidenceId: string | null;
    triggeredAt: string | null;
    clearedAt: string | null;
    revision: number;
  };
  evidence: {
    terminalRuns: number;
    completedRuns: number;
    successRate: number | null;
    evaluatedSince: string;
  };
}

export interface StudioData {
  blueprint: Record<string, string>;
  solutionPackProvenance: {
    pack_id: string; pack_version: string; installed_by: string; installed_at: string;
  } | null;
  solutionPackHandoffChecks: Array<{
    id: string; check_order: number; description: string;
    gate_type: "publication" | "handoff";
    status: "open" | "complete" | "not_applicable"; evidence: string | null;
    revision: number; completed_by: string | null; completed_at: string | null;
    completed_by_name: string | null;
  }>;
  prompt: {
    system_prompt: string;
    instructions_json: string;
    guardrails_json: string;
    version: number;
    checksum: string;
  };
  releases: ProcessRelease[];
  approvedModelIds: string[];
  modelContextTokens: Record<string, number>;
  promptBudget: {
    sections: Record<"system" | "instructions" | "guardrails" | "total", {
      characters: number; bytes: number; estimatedTokens: number;
    }>;
    contextTokens: number;
    reservedRuntimeTokens: number;
    staticPromptBudgetTokens: number;
    estimatedStaticTokens: number;
    remainingStaticTokens: number;
    utilizationPercent: number;
    status: "healthy" | "attention" | "exceeded";
    estimator: "characters-divided-by-four";
    measured: {
      sampleCount: number; averageInputTokens: number | null; averageTotalTokens: number | null;
      averageModelLatencyMs: number | null; windowDays: number;
    };
  } | null;
  activations: Array<{
    id: string; from_release_id: string | null; to_release_id: string;
    activation_type: "initial" | "publish" | "rollback"; reason: string;
    activated_by: string; activated_by_name: string | null; activated_at: string;
    from_version: number | null; to_version: number;
  }>;
  runStats: Array<{ status: string; count: number }>;
  launchReadiness: {
    ready: boolean;
    baselineConfigured: boolean;
    targetConfigured: boolean;
    targetCurrent: boolean;
    targetReviewDueAt: string | null;
    packPublicationChecks: number;
    packPublicationChecksResolved: number;
    blockers: string[];
  };
  autonomySafety: AutonomySafetyData;
  actorAdoption: {
    supported: boolean;
    knownActors: number;
    currentActors: number;
    pinnedPreviousActors: number;
    unattributedActors: number;
    cohorts: Array<{
      release_id: string | null; version: number | null; status: string | null;
      actor_count: number; latest_evidence_at: string | null;
      state: "current" | "pinned_previous" | "unattributed";
    }>;
    actors: Array<{
      execution_id: string; instance_key: string; effective_release_id: string | null;
      version: number | null; status: string | null; last_active_at: string;
      migrated_at: string | null; state: "current" | "pinned_previous" | "unattributed";
    }>;
  };
  activeTools: string[];
  topology: {
    version: number;
    layout: "linear";
    businessSteps: Array<{ id: string; type: "step" | "decision" | "checkpoint"; label: string }>;
    nodes: Array<{ id: string; type: string; label: string }>;
    edges: Array<{ from: string; to: string }>;
  };
}
export interface ActorReleaseRollout {
  id: string;
  target_release_id: string;
  target_version: number;
  percentage: number;
  selected_actor_count: number;
  status: "queued" | "running" | "completed" | "partial" | "failed";
  completed_count: number;
  skipped_count: number;
  failed_count: number;
  reason: string;
  requested_by: string;
  requested_by_name: string | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}
export interface ProcessRetirement {
  id: string;
  status: "requested" | "approved" | "disposing" | "disposed" | "cancelled" | "failed";
  reason: string;
  requested_by: string;
  requested_by_name: string | null;
  requested_at: string;
  legal_hold: number;
  legal_hold_reason: string | null;
  delete_execution_payloads: number;
  delete_approval_content: number;
  delete_prompt_content: number;
  approved_by_name: string | null;
  approved_at: string | null;
  scheduled_for: string | null;
  disposed_at: string | null;
  evidence_json: string | null;
  last_error: string | null;
  processed_actors: number;
  disposed_turns: number;
  disposed_prompt_bundles: number;
}
export interface ProcessRetirementData {
  process: { id: string; name: string; status: string; operating_mode: string };
  retirements: ProcessRetirement[];
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
  customDlpEntries: Array<{ id: string; label: string; action: "audit" | "redact" | "block";
    direction: "input" | "output" | "both"; enabled: number; revision: number;
    updated_by: string; updated_at: string }>;
  dataEgressPolicies: Array<{
    classification: "public" | "internal" | "confidential" | "restricted";
    external_model_allowed: number; external_tool_allowed: number; revision: number;
    updated_by: string; updated_at: string;
  }>;
  dlpEvents: Array<{ direction: string; stage: string; detector: string; action: string; match_count: number;
    execution_id: string | null; blueprint_id: string | null; created_at: string; display_label: string | null }>;
  webhooks: WebhookEndpoint[];
  emailRoutes: EmailRoute[];
  models: Array<{
    profile: string;
    modelId: string;
    provider: string;
    processes: number;
    boundary: string;
    ready: boolean;
    lastVerifiedAt: string | null;
    evidence: string | null;
  }>;
  modelPolicy: Array<{ model_id: string; label: string; provider: string; status: string;
    enabled: number; active_processes: number }>;
  aiGateway: {
    gatewayId: string; enabled: boolean; collectLogs: boolean; evidenceReference: string | null;
    updatedBy: string; updatedAt: string;
  };
  governanceReviews: Array<{
    review_key: string; name: string; description: string; cadence_days: number;
    next_due_at: string; last_completed_at: string | null; last_completed_by: string | null;
    evidence_reference: string | null; completion_notes: string | null;
    status: "current" | "due" | "overdue";
  }>;
  readiness: Array<{
    id: string;
    label: string;
    ready: boolean;
    detail: string;
    action: string;
    actionLabel: string;
  }>;
  dataFlow: string[];
  deploymentVerification: {
    evidenceWindowDays: number;
    status: "verified" | "verification_due" | "principal_required";
    activeOperatorPrincipals: number;
    lastVerifiedAt: string | null;
    lastVerifiedBy: string | null;
    checks: Array<{ id: string; label: string; ready: boolean; detail: string }>;
  };
}
export interface RetentionControl {
  tenant_id: string;
  conversation_days: number;
  execution_days: number;
  approval_days: number;
  notification_days: number;
  help_request_days: number;
  api_log_days: number;
  legal_hold: number;
  legal_hold_reason: string | null;
  updated_by: string;
  updated_at: string | null;
  last_enforced_at: string | null;
}
export interface RetentionOperationsData {
  control: RetentionControl;
  runs: Array<{ id: string; status: "queued" | "running" | "completed" | "failed";
    workflow_id: string | null; processed_actors: number; expired_turns: number;
    evidence_json: string; error: string | null; started_at: string; completed_at: string | null }>;
}
export interface RetentionPreview {
  legalHold: boolean;
  cutoffs: Record<string, string>;
  eligible: { executions: number; approvals: number; approvalMessages: number; notifications: number;
    helpRequests: number; apiLogs: number; durableActors: number };
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
export interface McpConnector {
  id: string; name: string; server_url: string; transport: "streamable-http" | "sse" | "auto";
  status: "disabled" | "connecting" | "authenticating" | "ready" | "attention";
  tool_count: number; last_discovered_at: string | null; last_checked_at: string | null;
  last_success_at: string | null; last_error: string | null;
  revision: number; created_at: string; updated_at: string;
}
export interface McpConnectorTool {
  id: string; connector_id: string; server_tool_name: string; ai_tool_name: string;
  title: string; description: string; input_schema_json: string;
  access_mode: "read" | "write"; risk_level: "low" | "medium" | "high";
  data_classification: "public" | "internal" | "confidential" | "restricted";
  owner: string; rate_limit_per_minute: number; enabled: number; revision: number;
  available: number;
  process_ids: string; process_names: string;
}
export interface McpCatalogData {
  connectors: McpConnector[];
  tools: McpConnectorTool[];
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
export interface ApiLogPage {
  data: ApiLog[];
  page: { limit: number; hasMore: boolean; nextCursor: string | null };
  summary: { total: number; averageLatencyMs: number; errors: number };
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
export interface WebhookReceipt {
  id: string;
  event_type: string | null;
  execution_id: string | null;
  execution_status: string | null;
  received_at: string;
  completed_at: string | null;
}

export interface EmailRoute {
  id: string;
  name: string;
  address: string;
  blueprint_id: string;
  process_name: string;
  execution_profile: string;
  allowed_sender_domains_json: string;
  status: "active" | "disabled";
  created_at: string;
  updated_at: string;
  last_received_at: string | null;
  cloudflare_rule_id: string | null;
  routing_verified_at: string | null;
  routing_evidence_reference: string | null;
  routing_revision: number;
}

export interface EmailReceipt {
  id: string;
  execution_id: string | null;
  status: "accepted" | "duplicate" | "blocked" | "rejected" | "enqueue_failed";
  attachment_count: number;
  received_at: string;
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
  starter_json: string;
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
export interface AccessOperationsData {
  sessions: Array<{
    id: string; actor_id: string; identity_type: "human" | "service";
    actor_name: string; actor_email: string; client_label: string;
    country_code: string | null; colo_code: string | null; issued_at: string | null;
    expires_at: string | null; first_seen_at: string; last_seen_at: string; request_count: number;
  }>;
  plan: null | {
    tenant_id: string; member_id: string; member_name: string; member_email: string;
    procedure_summary: string; evidence_reference: string; review_due_at: string;
    enabled: number; revision: number; updated_at: string;
  };
  events: Array<{
    id: string; member_id: string; member_name: string; access_session_id: string;
    status: "open" | "reviewed"; classification: "drill" | "incident" | "false_positive" | null;
    review_note: string | null; reviewer_name: string | null; reviewed_at: string | null;
    observed_at: string; revision: number; client_label: string;
    country_code: string | null; colo_code: string | null;
  }>;
  eligibleAdmins: Array<{ id: string; display_name: string; email: string }>;
}
export interface ValueData {
  totals: { items_processed: number; human_minutes_saved: number; estimated_value: number;
    estimated_operating_cost: number; override_count: number; failure_count: number };
  byProcess: Array<{ blueprint_id: string; process_name: string; items_processed: number;
    human_minutes_saved: number; estimated_value: number; override_count: number; failure_count: number }>;
  discoveries: Array<Record<string, string | number>>;
  portfolio: Array<{
    blueprint_id: string; process_name: string; status: string; operating_mode: string;
    business_owner: string; department: string; safety_autonomy_cap: string | null;
    baseline_volume: number; baseline_minutes: number; hourly_cost: number; opportunity_score: number;
    items_processed: number; human_minutes_saved: number; estimated_value: number; override_count: number;
    snapshot_failures: number; runs: number; completed_runs: number; adverse_runs: number;
    estimated_operating_cost: number; netValue: number; valueCostRatio: number | null;
    avg_cycle_ms: number | null; open_incidents: number; failureRate: number; overrideRate: number;
    target_items: number | null; target_human_minutes_saved: number | null; target_value: number | null;
    maximum_override_percent: number | null; maximum_failure_percent: number | null;
    target_review_due_at: string | null; target_rationale: string | null;
    target_evidence_reference: string | null; target_revision: number | null; target_updated_at: string | null;
    target: null | { itemPercent: number; effortPercent: number; valuePercent: number; minimumPercent: number;
      exceptionReady: boolean; overdue: boolean; status: "review_due" | "achieved" | "tracking" | "attention" };
    recommendation: { action: "expand" | "correct" | "retire" | "observe" | "hold";
      confidence: "high" | "medium" | "low"; reason: string; nextStep: string };
  }>;
  measurements: Array<{
    id: string; blueprint_id: string; process_name: string; period_start: string; period_end: string;
    items_processed: number; actual_human_minutes: number; average_cycle_minutes: number | null;
    human_minutes_saved: number; estimated_value: number; override_count: number; failure_count: number;
    evidence_reference: string; note: string | null; status: "active" | "void";
    void_reason: string | null; voided_at: string | null; recorded_at: string; revision: number;
    recorded_by_name: string; voided_by_name: string | null;
  }>;
  decisionPolicy: { evidenceWindowDays: number; minimumEvidenceItems: number;
    correctAtFailurePercent: number; correctAtOverridePercent: number;
    expandAtMaximumFailurePercent: number; expandAtMaximumOverridePercent: number;
    expandRequiresPositiveNetValue: boolean };
}
export interface OnboardingData {
  settings: null | { organization_name: string; support_email: string; accent_color: string; default_model_profile: string; data_region: string; initialized_at: string | null };
  checklist: Array<{ id: string; label: string; ready: boolean }>;
  bootstrap: null | { status: "started" | "completed" | "failed"; member_id: string | null; process_id: string | null;
    started_at: string; completed_at: string | null; last_error: string | null };
  implementationJourney: Array<{
    id: "baseline" | "first_run" | "readonly_connection" | "shadow";
    label: string;
    targetMinutes: number;
    achievedAt: string | null;
    elapsedMinutes: number | null;
    status: "achieved" | "pending";
  }>;
}
export interface ConfigurationRestorePreview {
  checksum: string;
  source: { environment: string; tenantId: string };
  counts: { organization: number; lifecycle: number; retention: number;
    dlpRules: number; notificationPolicies: number };
  warnings: string[];
  package: Record<string, unknown>;
}
export interface ManagedLifecycleData {
  settings: null | {
    support_owner_id: string | null; recovery_owner_id: string | null; escalation_email: string;
    maintenance_day_utc: number; maintenance_hour_utc: number; recovery_review_due_at: string | null;
    last_recovery_review_at: string | null; support_notes: string | null; updated_at: string;
    support_owner_name: string | null; recovery_owner_name: string | null;
  };
  members: Array<{ id: string; display_name: string; email: string; role: string }>;
  preflight: { status: "ready" | "action_required"; ready: number; total: number;
    checks: Array<{ id: string; label: string; ready: boolean; category: string; detail: string }> };
  handoff: { status: "ready" | "action_required"; automatedReady: boolean; confirmed: number; total: number;
    checks: Array<{ id: string; label: string; detail: string; status: "open" | "confirmed";
      evidence: string | null; confirmedBy: string | null; confirmedByName: string | null;
      confirmedAt: string | null; revision: number; updatedAt: string | null }> };
  environment: { name: string; domain: string; accessTeamDomain: string };
  counts: Record<string, number>;
  operatingControl: null | { mode: string; reason: string | null; updated_at: string };
  maintenanceRuns: Array<{
    id: string; startedAt: string; completedAt: string | null;
    status: "running" | "healthy" | "degraded"; taskCount: number; failedCount: number;
    tasks: Array<{ name: string; status: "healthy" | "failed"; durationMs: number; error?: string }>;
  }>;
}
export interface PlatformVersionData {
  applicationRelease: string;
  environment: string;
  domain: string;
  worker: { versionId: string; tag: string | null; createdAt: string | null };
  schema: {
    status: "current" | "migration_required" | "application_upgrade_required" | "unavailable";
    compatible: boolean;
    appliedMigrationId: number | null;
    appliedMigrationName: string | null;
    appliedAt: string | null;
    requiredMigrationId: number;
    requiredMigrationName: string;
  };
}
export interface ProviderAcceptanceData {
  provider: "microsoft";
  connected: boolean;
  connection: null | { id: string; status: string; account: string | null; scopes: string[] };
  latest: null | {
    id: string; status: "passed" | "failed"; requested: string[];
    results: Array<{ capability: string; label: string; scope: string;
      status: "passed" | "failed" | "not_granted"; httpStatus: number | null;
      latencyMs: number | null; detail: string }>;
    startedBy: string; startedAt: string; completedAt: string;
  };
}
export interface NotificationData {
  policies: Array<{ id: string; event_type: string; channel: string; destination: string | null; enabled: number; severity: string;
    updated_at: string; credential_name: string | null; credential_configured: number;
    owner_id: string | null; owner_email: string | null; owner_name: string | null;
    acknowledgement_required: number; escalation_minutes: number; quiet_hours_enabled: number;
    quiet_start_hour_utc: number; quiet_end_hour_utc: number; critical_bypass: number;
    digest_mode: "immediate" | "hourly" | "daily"; digest_hour_utc: number }>;
  events: Array<{ id: string; event_type: string; severity: string; title: string; detail: string; delivery_status: string;
    attempt_count: number; last_error: string | null; response_status: number | null; created_at: string;
    channel: string | null; acknowledgement_required: number | null; escalation_minutes: number | null;
    owner_name: string | null; acknowledged_at: string | null; acknowledged_by_name: string | null;
    acknowledgement_note: string | null; escalated_at: string | null; delivery_scheduled_for: string | null;
    delivery_queued_at: string | null; digest_batch_id: string | null; digest_item_count: number | null }>;
  credentials: Array<{ id: string; name: string; provider: string; secret_binding: string; purpose: string; status: string;
    last_validated_at: string | null; configured: number }>;
  microsoftEmail: null | { account_email: string | null; account_name: string | null; status: string; configured: number };
}
export interface UsageData {
  summary: { executions: number; evaluation_cases: number; input_tokens: number; output_tokens: number; total_tokens: number; estimated_cost_usd: number };
  budget: { monthly_limit_usd: number; warning_percent: number; hard_limit: number } | null;
  models: Array<{ model_id: string; label: string; input_usd_per_million: number; output_usd_per_million: number; context_tokens: number; pricing_effective_at: string; pricing_source: string }>;
  byModel: Array<{ model: string; executions: number; total_tokens: number; estimated_cost_usd: number }>;
  byProcess: Array<{ blueprint_id: string; process_name: string; executions: number; total_tokens: number;
    estimated_cost_usd: number; monthly_limit_usd: number | null; warning_percent: number | null; hard_limit: number | null }>;
  recent: Array<{ id: string; blueprint_id: string; model: string; input_tokens: number; output_tokens: number; total_tokens: number; estimated_cost_usd: number; started_at: string }>;
  reconciliations: Array<{ id: string; period_start: string; period_end: string; source: string;
    source_reference: string; workers_ai_neurons: number | null; workers_ai_cost_usd: number;
    platform_cost_usd: number | null; workers_requests: number | null; d1_rows_read: number | null;
    d1_rows_written: number | null; queue_operations: number | null; workflow_wall_time_ms: number | null;
    workrr_estimated_ai_cost_usd: number; variance_usd: number; variance_percent: number | null;
    status: "active" | "voided"; imported_by: string; imported_at: string; voided_by: string | null;
    voided_at: string | null; void_reason: string | null }>;
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
    rotation_id: string | null;
  }>;
  rubricPublisherTrust: Array<{
    id: string;
    publisher_name: string;
    publisher_key_id: string;
    policy: "manual" | "auto_approve" | "block";
    status: "active" | "suspended";
    valid_from: string | null;
    expires_at: string | null;
    expired_at: string | null;
    superseded_by_trust_id: string | null;
    created_by: string;
    created_at: string;
    updated_at: string;
  }>;
  rubricKeyRotations: Array<{
    id: string;
    publisher_name: string;
    predecessor_trust_id: string;
    predecessor_key_id: string;
    successor_key_id: string;
    valid_from: string;
    expires_at: string;
    status: "pending" | "approved" | "rejected";
    requested_by: string;
    requested_at: string;
    reviewed_by: string | null;
    reviewed_at: string | null;
    review_note: string | null;
    overlap_days: number | null;
    successor_trust_id: string | null;
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
  schema: "workrr-rubrics/v1" | "workrr-rubrics/v2" | "workrr-rubrics/v3";
  exportedAt?: string;
  issuedAt?: string;
  publisher?: { name: string; keyId: string; publicKey: JsonWebKey; validFrom?: string; expiresAt?: string;
    rotation?: { previousKeyId: string; proof: string } };
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
  helpCenter: () => request<{ data: HelpCenterData }>("/api/help-center"),
  acknowledgeLearning: (moduleId: string, version: number) =>
    request<{ data: { moduleId: string; version: number; acknowledgedAt: string; recorded: boolean } }>(
      `/api/help-center/modules/${encodeURIComponent(moduleId)}/acknowledge`,
      { method: "POST", body: JSON.stringify({ version }) }),
  createHelpRequest: (body: {
    category: string; priority: string; subject: string; detail: string;
    blueprintId?: string; executionId?: string;
  }) => request<{ data: { id: string; status: string; category: string; priority: string;
    assignedTo: string | null; dueAt: string; revision: number } }>("/api/help-center/requests",
      { method: "POST", body: JSON.stringify(body) }),
  updateHelpRequest: (id: string, body: {
    status: "open" | "in_progress" | "resolved"; assignedTo?: string; resolution?: string;
    expectedRevision: number;
  }) => request<{ data: { id: string; from: string; status: string; assignedTo: string | null; revision: number } }>(
    `/api/help-center/requests/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(body) }),
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
  launchpadThreads: (blueprintId?: string) =>
    request<{ data: LaunchpadThread[] }>(
      `/api/launchpad/threads${blueprintId ? `?blueprintId=${encodeURIComponent(blueprintId)}` : ""}`,
    ),
  createLaunchpadThread: (blueprintId: string, title: string) =>
    request<{ data: { id: string; blueprintId: string; processName: string; title: string; status: "active" } }>(
      `/api/launchpad/processes/${encodeURIComponent(blueprintId)}/threads`,
      { method: "POST", body: JSON.stringify({ title }) },
    ),
  launchpadConversation: (threadId: string) =>
    request<{ data: { thread: LaunchpadThread; messages: LaunchpadMessage[] } }>(
      `/api/launchpad/threads/${encodeURIComponent(threadId)}`,
    ),
  sendLaunchpadMessage: (threadId: string, input: string) =>
    request<{ data: ExecutionResult }>(
      `/api/launchpad/threads/${encodeURIComponent(threadId)}/messages`,
      { method: "POST", body: JSON.stringify({ input }) },
    ),
  runLaunchpadProcess: (blueprintId: string, input: string) =>
    request<{ data: ExecutionResult }>(
      `/api/launchpad/processes/${encodeURIComponent(blueprintId)}/run`,
      { method: "POST", body: JSON.stringify({ input }) },
    ),
  archiveLaunchpadThread: (threadId: string, archived: boolean) =>
    request<{ data: { id: string; status: "active" | "archived" } }>(
      `/api/launchpad/threads/${encodeURIComponent(threadId)}`,
      { method: "PATCH", body: JSON.stringify({ archived }) },
    ),
  decideApproval: (
    id: string,
    decision: "approved" | "rejected",
    expectedRevision: number,
    note?: string,
  ) =>
    request<{ updated: boolean; dispatched: number; enqueueFailed: number }>(
      `/api/approvals/${encodeURIComponent(id)}/${decision}`,
      { method: "POST", body: JSON.stringify({ note, expectedRevision }) },
    ),
  reviseApprovalProposal: (id: string, body: {
    expectedRevision: number; proposedOutput?: string;
    toolEdits?: Array<{ invocationId: string; input: unknown }>; reason: string;
  }) => request<{ data: { id: string; revision: number; proposedOutput: string | null;
    toolEdits: number; editedAt: string } }>(
      `/api/approvals/${encodeURIComponent(id)}/proposal`,
      { method: "PATCH", body: JSON.stringify(body) }),
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
    request<{ updated: boolean; assignedTo: string; displayName: string; delegated: boolean; requestedMemberId: string }>(
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
  shadowReviews: () => request<{ data: ShadowReview[] }>("/api/shadow-reviews"),
  reviewShadowExecution: (executionId: string, body: {
    expectedRevision: number; verdict: "match" | "partial" | "miss" | "unsafe";
    actualOutcome: string; note?: string;
  }) => request<{ data: ShadowReview }>(`/api/shadow-reviews/${encodeURIComponent(executionId)}`,
    { method: "PATCH", body: JSON.stringify(body) }),
  recovery: () => request<{ data: RecoveryOperations }>("/api/recovery"),
  updateRecovery: (id: string, body: {
    action: "assign" | "investigate" | "resolve" | "accept_risk" | "reopen";
    expectedRevision: number; assignedTo?: string; note?: string; resolutionExecutionId?: string;
  }) => request<{ data: { id: string; executionId: string; status: string; revision: number } }>(
    `/api/recovery/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  queueOperations: () => request<{ data: QueueOperationsData }>("/api/queue-operations"),
  toolActions: () => request<{ data: ToolActionOperationsData }>("/api/tool-actions"),
  replayQueueJob: (id: string) =>
    request<{ data: { queueJobId: string; executionId: string; status: string } }>(
      `/api/queue-jobs/${encodeURIComponent(id)}/replay`, { method: "POST" },
    ),
  execution: (id: string) =>
    request<{ data: Execution; approvals: Approval[]; audit: AuditEvent[]; citations: ExecutionKnowledgeCitation[];
      toolInvocations: ToolInvocation[]; toolActions: ToolActionDispatch[]; explanation: ExecutionExplanation;
      shadowReview: ShadowReview | null }>(
      `/api/executions/${encodeURIComponent(id)}`,
    ),
  retryExecution: (id: string) =>
    request<{ executionId: string; status: string }>(
      `/api/executions/${encodeURIComponent(id)}/retry`,
      { method: "POST" },
    ),
  executionMemory: (id: string) =>
    request<{ data: ExecutionMemory }>(`/api/executions/${encodeURIComponent(id)}/memory`),
  actorLocalWork: (id: string) =>
    request<{ data: ActorLocalWork }>(`/api/executions/${encodeURIComponent(id)}/actor-work`),
  queueActorLocalWork: (id: string, label: string) =>
    request<{ data: { taskId: string; status: string } }>(
      `/api/executions/${encodeURIComponent(id)}/actor-work/queue`,
      { method: "POST", body: JSON.stringify({ label }) }),
  scheduleActorLocalWork: (id: string, label: string, dueAt: string) =>
    request<{ data: { taskId: string; scheduleId: string; status: string; dueAt: string } }>(
      `/api/executions/${encodeURIComponent(id)}/actor-work/schedules`,
      { method: "POST", body: JSON.stringify({ label, dueAt }) }),
  cancelActorLocalSchedule: (id: string, scheduleId: string) =>
    request<{ data: { cancelled: boolean } }>(
      `/api/executions/${encodeURIComponent(id)}/actor-work/schedules/${encodeURIComponent(scheduleId)}`,
      { method: "DELETE" }),
  governExecutionMemory: (executionId: string, turnId: string, body: {
    action: "correct" | "quarantine" | "restore" | "delete";
    expectedRevision: number;
    content?: string;
    reason: string;
  }) => request<{ data: GovernedMemoryTurn }>(
    `/api/executions/${encodeURIComponent(executionId)}/memory/${encodeURIComponent(turnId)}`,
    { method: "PATCH", body: JSON.stringify(body) }),
  proposeExecutionFact: (executionId: string, body: {
    category: DurableActorFact["category"]; content: string; sourceTurnId: string;
    reason: string; expiresAt: string;
  }) => request<{ data: DurableActorFact }>(
    `/api/executions/${encodeURIComponent(executionId)}/memory/facts`,
    { method: "POST", body: JSON.stringify(body) }),
  governExecutionFact: (executionId: string, factId: string, body: {
    action: "approve" | "correct" | "retire"; expectedRevision: number;
    content?: string; reason: string; expiresAt?: string;
  }) => request<{ data: DurableActorFact }>(
    `/api/executions/${encodeURIComponent(executionId)}/memory/facts/${encodeURIComponent(factId)}`,
    { method: "PATCH", body: JSON.stringify(body) }),
  migrateExecutionActorRelease: (executionId: string, body: {
    targetReleaseId: string; confirmFromReleaseId: string; reason: string;
  }) => request<{ data: { changed: boolean; fromReleaseId: string; toReleaseId: string;
    targetVersion: number | null; migratedAt: string | null } }>(
    `/api/executions/${encodeURIComponent(executionId)}/actor-release`,
    { method: "POST", body: JSON.stringify(body) }),
  studio: (id: string) =>
    request<{ data: StudioData }>(
      `/api/processes/${encodeURIComponent(id)}/studio`,
    ),
  processReleaseDiff: (processId: string, releaseId: string) =>
    request<{ data: ProcessReleaseDiff }>(
      `/api/processes/${encodeURIComponent(processId)}/releases/${encodeURIComponent(releaseId)}/diff`,
    ),
  updateAutonomySafety: (id: string, body: {
    enabled: boolean; minTerminalRuns: number; successThreshold: number;
    windowHours: number; expectedRevision: number;
  }) => request<{ data: AutonomySafetyData }>(
    `/api/processes/${encodeURIComponent(id)}/autonomy-safety`,
    { method: "PATCH", body: JSON.stringify(body) }),
  clearAutonomySafety: (id: string, body: { reason: string; expectedRevision: number }) =>
    request<{ data: AutonomySafetyData }>(
      `/api/processes/${encodeURIComponent(id)}/autonomy-safety/clear`,
      { method: "POST", body: JSON.stringify(body) }),
  actorReleaseRollouts: (id: string) =>
    request<{ data: ActorReleaseRollout[] }>(
      `/api/processes/${encodeURIComponent(id)}/actor-release-rollouts`,
    ),
  createActorReleaseRollout: (id: string, body: {
    percentage: number; targetReleaseId: string; reason: string;
  }) => request<{ data: { id: string; status: "queued"; targetReleaseId: string;
    targetVersion: number | null; percentage: number; eligibleActors: number; selectedActorCount: number } }>(
    `/api/processes/${encodeURIComponent(id)}/actor-release-rollouts`,
    { method: "POST", body: JSON.stringify(body) }),
  rollbackRelease: (processId: string, releaseId: string, body: {
    reason: string; confirmVersion: number;
  }) => request<{ releaseId: string; previousReleaseId: string; version: number;
    status: "published"; rolledBackAt: string; reason: string }>(
      `/api/processes/${encodeURIComponent(processId)}/releases/${encodeURIComponent(releaseId)}/rollback`,
      { method: "POST", body: JSON.stringify(body) }),
  processRetirement: (id: string) =>
    request<{ data: ProcessRetirementData }>(`/api/processes/${encodeURIComponent(id)}/retirement`),
  requestProcessRetirement: (id: string, body: { reason: string; confirmName: string;
    deleteExecutionPayloads: boolean; deleteApprovalContent: boolean; deletePromptContent: boolean }) =>
    request<{ data: { id: string; status: string; processPaused: boolean } }>(
      `/api/processes/${encodeURIComponent(id)}/retirement`, { method: "POST", body: JSON.stringify(body) }),
  transitionProcessRetirement: (processId: string, retirementId: string, body: {
    action: "approve" | "hold" | "cancel"; scheduledFor?: string; legalHold?: boolean;
    legalHoldReason?: string; confirmation?: string;
  }) => request<{ data: { id: string; status: string; legalHold?: boolean; scheduledFor?: string } }>(
    `/api/processes/${encodeURIComponent(processId)}/retirement/${encodeURIComponent(retirementId)}`,
    { method: "PATCH", body: JSON.stringify(body) }),
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
      modelId?: string;
      autonomy: string;
      releaseNotes: string;
      inputSchema?: Record<string, unknown> | null;
      outputSchema?: Record<string, unknown> | null;
      topology?: {
        businessSteps: Array<{ id: string; type: "step" | "decision" | "checkpoint"; label: string }>;
      };
      dataClassification: "public" | "internal" | "confidential" | "restricted";
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
  decideProcessRelease: (processId: string, releaseId: string, body: {
    decision: "approved" | "rejected"; evidence: string;
  }) => request<{ data: { releaseId: string; version: number; releaseChecksum: string;
    decision: "approved" | "rejected"; evidence: string; decidedBy: string } }>(
      `/api/processes/${encodeURIComponent(processId)}/releases/${encodeURIComponent(releaseId)}/review`,
      { method: "POST", body: JSON.stringify(body) },
    ),
  governance: () => request<{ data: GovernanceData }>("/api/governance"),
  updateModelPolicy: (modelId: string, enabled: boolean) =>
    request<{ data: { modelId: string; enabled: boolean } }>(
      `/api/governance/models/${encodeURIComponent(modelId)}`,
      { method: "PATCH", body: JSON.stringify({ enabled }) }),
  updateAiGateway: (body: {
    gatewayId: string; enabled: boolean; collectLogs: boolean; evidenceReference: string;
  }) => request<{ data: GovernanceData["aiGateway"] }>("/api/governance/ai-gateway", {
    method: "PATCH", body: JSON.stringify(body)
  }),
  completeGovernanceReview: (reviewKey: string, body: { evidenceReference: string; notes: string }) =>
    request<{ data: { reviewKey: string; evidenceReference: string; nextDueInDays: number } }>(
      `/api/governance/reviews/${encodeURIComponent(reviewKey)}/complete`,
      { method: "POST", body: JSON.stringify(body) }),
  retention: () => request<{ data: RetentionOperationsData }>("/api/governance/retention"),
  retentionPreview: () => request<{ data: RetentionPreview }>("/api/governance/retention/preview"),
  updateRetention: (body: {
    conversationDays: number; executionDays: number; approvalDays: number; notificationDays: number;
    helpRequestDays: number;
    apiLogDays: number; legalHold: boolean; legalHoldReason?: string; releaseConfirmation?: string;
  }) => request<{ data: RetentionOperationsData }>("/api/governance/retention",
    { method: "PUT", body: JSON.stringify(body) }),
  enforceRetention: (confirmation: string) =>
    request<{ data: { skipped: boolean; reason?: string; runId?: string; status?: "queued" } }>(
      "/api/governance/retention/enforce", { method: "POST", body: JSON.stringify({ confirmation }) }),
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
  logs: (filters?: { direction?: string; outcome?: string; search?: string; cursor?: string }) => {
    const params = new URLSearchParams();
    if (filters?.direction) params.set("direction", filters.direction);
    if (filters?.outcome) params.set("outcome", filters.outcome);
    if (filters?.search) params.set("search", filters.search);
    if (filters?.cursor) params.set("cursor", filters.cursor);
    const query = params.size ? `?${params}` : "";
    return request<ApiLogPage>(`/api/logs${query}`);
  },
  webhooks: () => request<{ data: WebhookEndpoint[] }>("/api/webhooks"),
  createWebhook: (body: { name: string; blueprintId: string; acceptedEvents: string[] }) =>
    request<{ data: { id: string; status: string; secretConfigured: boolean } }>(
      "/api/webhooks", { method: "POST", body: JSON.stringify(body) }),
  updateWebhook: (id: string, body: { name: string; blueprintId: string; acceptedEvents: string[] }) =>
    request<{ data: { id: string; status: string } }>(
      `/api/webhooks/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  webhookReceipts: (id: string) =>
    request<{ data: { endpoint: { id: string; name: string }; receipts: WebhookReceipt[] } }>(
      `/api/webhooks/${encodeURIComponent(id)}/receipts`),
  setWebhookStatus: (id: string, status: "active" | "disabled") =>
    request<{ updated: boolean; status: string }>(
      `/api/webhooks/${encodeURIComponent(id)}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) },
    ),
  createEmailRoute: (body: { name: string; address: string; blueprintId: string; allowedSenderDomains: string[] }) =>
    request<{ data: { id: string; status: string } }>(
      "/api/email-routes", { method: "POST", body: JSON.stringify(body) }),
  updateEmailRoute: (id: string,
    body: { name: string; address: string; blueprintId: string; allowedSenderDomains: string[] }) =>
    request<{ data: { id: string; status: string } }>(
      `/api/email-routes/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) }),
  setEmailRouteStatus: (id: string, status: "active" | "disabled") =>
    request<{ data: { id: string; status: string } }>(
      `/api/email-routes/${encodeURIComponent(id)}/status`,
      { method: "PATCH", body: JSON.stringify({ status }) }),
  verifyEmailRouting: (id: string, body: {
    cloudflareRuleId: string; evidenceReference: string;
    addressConfirmation: string; expectedRevision: number;
  }) => request<{ data: { id: string; cloudflareRuleId: string; routingVerified: boolean } }>(
    `/api/email-routes/${encodeURIComponent(id)}/routing-verification`,
    { method: "POST", body: JSON.stringify(body) }),
  emailReceipts: (id: string) =>
    request<{ data: EmailReceipt[] }>(`/api/email-routes/${encodeURIComponent(id)}/receipts`),
  processTemplates: () =>
    request<{ data: ProcessTemplate[] }>("/api/process-templates"),
  solutionPacks: () => request<{ data: SolutionPack[] }>("/api/solution-packs"),
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
  approvalDelegations: () =>
    request<{ data: ApprovalDelegation[] }>("/api/approval-delegations"),
  setApprovalDelegation: (memberId: string, body: {
    delegateId: string; startsAt: string; endsAt: string; reason: string;
    enabled: boolean; expectedRevision?: number;
  }) => request<{ data: { memberId: string; delegateId: string; startsAt: string;
    endsAt: string; enabled: boolean; revision: number } }>(
      `/api/approval-delegations/${encodeURIComponent(memberId)}`,
      { method: "PUT", body: JSON.stringify(body) }),
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
  accessOperations: () => request<{ data: AccessOperationsData }>("/api/access/operations"),
  updateEmergencyAccessPlan: (body: {
    memberId: string; procedureSummary: string; evidenceReference: string;
    reviewDueAt: string; enabled: boolean; expectedRevision: number;
  }) => request<{ data: AccessOperationsData }>("/api/access/emergency-plan", {
    method: "PUT", body: JSON.stringify(body),
  }),
  reviewEmergencyAccessEvent: (eventId: string, body: {
    classification: "drill" | "incident" | "false_positive"; note: string; expectedRevision: number;
  }) => request<{ data: AccessOperationsData }>(
    `/api/access/emergency-events/${encodeURIComponent(eventId)}/review`,
    { method: "POST", body: JSON.stringify(body) }),
  createServicePrincipal: (body: { commonName: string; displayName: string; role: "operator" | "viewer" }) =>
    request<{ id: string; status: string }>("/api/service-principals", {
      method: "POST", body: JSON.stringify(body),
    }),
  updateServicePrincipal: (id: string, body: { role?: "operator" | "viewer"; status?: "active" | "suspended" }) =>
    request<{ updated: boolean }>(`/api/service-principals/${encodeURIComponent(id)}`, {
      method: "PATCH", body: JSON.stringify(body),
    }),
  value: () => request<{ data: ValueData }>("/api/value"),
  recordValueMeasurement: (body: {
    blueprintId: string; periodStart: string; periodEnd: string; itemsProcessed: number;
    actualHumanMinutes: number; averageCycleMinutes: number | null; overrideCount: number;
    failureCount: number; evidenceReference: string; note: string;
  }) => request<{ data: { id: string; processName: string; humanMinutesSaved: number;
    estimatedValue: number; status: "active" } }>("/api/value/measurements", {
      method: "POST", body: JSON.stringify(body),
    }),
  voidValueMeasurement: (id: string, reason: string, expectedRevision: number) =>
    request<{ data: { id: string; status: "void" } }>(
      `/api/value/measurements/${encodeURIComponent(id)}/void`, {
        method: "POST", body: JSON.stringify({ reason, expectedRevision }),
      }),
  updateValueTarget: (processId: string, body: {
    targetItems: number; targetHumanMinutesSaved: number; targetValue: number;
    maximumOverridePercent: number; maximumFailurePercent: number; reviewDueAt: string;
    rationale: string; evidenceReference: string; expectedRevision: number;
  }) => request<{ data: { blueprintId: string; targetItems: number; targetHumanMinutesSaved: number;
    targetValue: number; maximumOverridePercent: number; maximumFailurePercent: number;
    reviewDueAt: string; revision: number } }>(`/api/value/targets/${encodeURIComponent(processId)}`, {
      method: "PUT", body: JSON.stringify(body),
    }),
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
  reviewRubricKeyRotation: (id: string, decision: "approved" | "rejected",
    body: { overlapDays?: number; note: string }) =>
    request<{ data: { id: string; status: string; successorTrustId?: string;
      predecessorRetiresAt?: string; overlapDays?: number } }>(
      `/api/evaluation-rubric-key-rotations/${encodeURIComponent(id)}/${decision}`,
      { method: "POST", body: JSON.stringify(body) }),
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
  createCustomDlpEntry: (body: { label: string; term: string; action: "audit" | "redact" | "block";
    direction: "input" | "output" | "both" }) =>
    request<{ data: { id: string; label: string; revision: number } }>("/api/dlp/custom-entries",
      { method: "POST", body: JSON.stringify(body) }),
  updateCustomDlpEntry: (id: string, body: { action: "audit" | "redact" | "block";
    direction: "input" | "output" | "both"; enabled: boolean; expectedRevision: number }) =>
    request<{ data: { id: string; revision: number } }>(
      `/api/dlp/custom-entries/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  previewDlp: (body: { sample: string; direction: "input" | "output" }) =>
    request<{ data: { safeText: string; blocked: boolean; count: number;
      matches: Array<{ detector: string; label: string; action: string; count: number }> } }>(
      "/api/dlp/preview", { method: "POST", body: JSON.stringify(body) }),
  updateDataEgressPolicy: (classification: string, body: {
    externalModelAllowed: boolean; externalToolAllowed: boolean; expectedRevision: number;
  }) => request<{ data: { classification: string; externalModelAllowed: boolean;
    externalToolAllowed: boolean; revision: number } }>(
    `/api/governance/data-egress/${encodeURIComponent(classification)}`,
    { method: "PATCH", body: JSON.stringify(body) }),
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
  mcpConnectors: () => request<{ data: McpCatalogData }>("/api/mcp-connectors"),
  createMcpConnector: (body: { name: string; serverUrl: string; transport: string }) =>
    request<{ data: McpConnector }>("/api/mcp-connectors",
      { method: "POST", body: JSON.stringify(body) }),
  connectMcpConnector: (id: string) =>
    request<{ data: { id: string; status: string; authUrl: string | null } }>(
      `/api/mcp-connectors/${encodeURIComponent(id)}/connect`, { method: "POST" }),
  disconnectMcpConnector: (id: string) =>
    request<{ data: { id: string; disconnected: boolean } }>(
      `/api/mcp-connectors/${encodeURIComponent(id)}/disconnect`, { method: "POST" }),
  discoverMcpConnector: (id: string) =>
    request<{ data: { id: string; status: string; toolCount: number } }>(
      `/api/mcp-connectors/${encodeURIComponent(id)}/discover`, { method: "POST" }),
  governMcpTool: (id: string, body: Record<string, unknown>) =>
    request<{ data: { id: string; enabled: boolean; processCount: number; revision: number } }>(
      `/api/mcp-tools/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
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
  microsoftAcceptance: () =>
    request<{ data: ProviderAcceptanceData }>("/api/provider-acceptance/microsoft"),
  runMicrosoftAcceptance: (capabilities: Array<"mail" | "calendar">) =>
    request<{ data: ProviderAcceptanceData["latest"] & { connectionId: string } }>(
      "/api/provider-acceptance/microsoft", {
        method: "POST", body: JSON.stringify({ capabilities })
      }),
  onboarding: () => request<{ data: OnboardingData }>("/api/onboarding"),
  platformVersion: () => request<{ data: PlatformVersionData }>("/api/system/version"),
  previewConfigurationRestore: (configurationPackage: unknown) =>
    request<{ data: ConfigurationRestorePreview }>("/api/configuration/restore/preview", {
      method: "POST", body: JSON.stringify({ package: configurationPackage })
    }),
  applyConfigurationRestore: (body: {
    package: unknown; checksum: string; reason: string; confirmation: string;
  }) => request<{ data: { id: string; checksum: string;
    counts: ConfigurationRestorePreview["counts"]; appliedAt: string } }>(
      "/api/configuration/restore", { method: "POST", body: JSON.stringify(body) }),
  lifecycle: () => request<{ data: ManagedLifecycleData }>("/api/lifecycle"),
  updateLifecycle: (body: { supportOwnerId: string; recoveryOwnerId: string; escalationEmail: string;
    maintenanceDayUtc: number; maintenanceHourUtc: number; recoveryReviewDueAt: string | null;
    supportNotes: string }) =>
    request<{ data: ManagedLifecycleData }>("/api/lifecycle", { method: "PUT", body: JSON.stringify(body) }),
  updateHandoffCheck: (checkId: string, body: {
    status: "open" | "confirmed"; evidence: string; revision: number;
  }) => request<{ data: ManagedLifecycleData }>(`/api/lifecycle/handoff/${encodeURIComponent(checkId)}`, {
    method: "PATCH", body: JSON.stringify(body)
  }),
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
    ownerId?: string | null; acknowledgementRequired?: boolean; escalationMinutes?: number;
    quietHoursEnabled?: boolean; quietStartHourUtc?: number; quietEndHourUtc?: number; criticalBypass?: boolean;
    digestMode?: "immediate" | "hourly" | "daily"; digestHourUtc?: number }) =>
    request<{ updated: boolean }>(`/api/notifications/policies/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  testNotificationPolicy: (id: string) =>
    request<{ eventId: string; status: string }>(`/api/notifications/policies/${id}/test`, { method: "POST", body: "{}" }),
  acknowledgeNotification: (id: string, note: string) =>
    request<{ data: { id: string; acknowledged: boolean; duplicate: boolean } }>(
      `/api/notifications/events/${encodeURIComponent(id)}/acknowledge`,
      { method: "POST", body: JSON.stringify({ note }) }),
  importProcessPackage: (body: unknown) => request<{ data: { id: string; status: string } }>("/api/process-packages/import", { method: "POST", body: JSON.stringify(body) }),
  installSolutionPack: (id: string, version: string) =>
    request<{ data: { id: string; status: string; packId: string; packVersion: string } }>(
      `/api/solution-packs/${encodeURIComponent(id)}/install`,
      { method: "POST", body: JSON.stringify({ version }) }),
  updateSolutionPackHandoff: (processId: string, checkId: string, body: {
    status: "open" | "complete" | "not_applicable"; evidence: string; expectedRevision: number;
  }) => request<{ data: { id: string; status: string; revision: number } }>(
    `/api/processes/${encodeURIComponent(processId)}/solution-pack-handoff/${encodeURIComponent(checkId)}`,
    { method: "PATCH", body: JSON.stringify(body) }),
  usage: () => request<{ data: UsageData }>("/api/usage"),
  importBillingEvidence: (body: {
    periodStart: string; periodEnd: string; source: string; sourceReference: string;
    workersAiNeurons?: number | null; workersAiCostUsd: number; platformCostUsd?: number | null;
    workersRequests?: number | null; d1RowsRead?: number | null; d1RowsWritten?: number | null;
    queueOperations?: number | null; workflowWallTimeMs?: number | null;
  }) => request<{ data: { id: string; status: string; imported: boolean; estimated?: number;
    billed?: number; variance?: number; variancePercent?: number | null } }>(
    "/api/usage/reconciliations", { method: "POST", body: JSON.stringify(body) }),
  voidBillingEvidence: (id: string, reason: string) =>
    request<{ data: { id: string; status: string } }>(
      `/api/usage/reconciliations/${encodeURIComponent(id)}/void`,
      { method: "POST", body: JSON.stringify({ reason }) }),
  updateBudget: (body: { monthlyLimitUsd: number; warningPercent: number; hardLimit: boolean }) =>
    request<{ updated: boolean }>("/api/usage/budget", { method: "PATCH", body: JSON.stringify(body) }),
  updateProcessBudget: (blueprintId: string, body: {
    enabled: boolean; monthlyLimitUsd: number; warningPercent: number; hardLimit: boolean;
  }) => request<{ data: { blueprintId: string; enabled: boolean } }>(
    `/api/usage/process-budgets/${encodeURIComponent(blueprintId)}`,
    { method: "PUT", body: JSON.stringify(body) }),
};
