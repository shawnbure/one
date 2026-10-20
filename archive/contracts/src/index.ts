export const executionProfiles = [
  "conversation",
  "consumer",
  "entity",
  "shared_shard",
  "temporary_durable",
  "instant",
  "workflow"
] as const;

export type ExecutionProfile = (typeof executionProfiles)[number];
export type AutonomyLevel = "observe" | "suggest" | "approve" | "guarded" | "autonomous";
export type ProcessStatus = "draft" | "testing" | "active" | "paused";
export interface ToolPolicy {
  id: string;
  name: string;
  version: number;
  adapterKind: "mock" | "http" | "microsoft" | "database" | "import_export" | "mcp";
  handlerKey?: string | null;
  accessMode: "read" | "write";
  riskLevel: "low" | "medium" | "high";
  connectionId: string | null;
  connectionReady: boolean;
  dataClassification: "public" | "internal" | "confidential" | "restricted";
  rateLimitPerMinute: number;
  inputSchemaJson: string;
  outputSchemaJson: string;
  description?: string;
  owner?: string;
  supportInstructions?: string;
}

export interface AgentBlueprint {
  id: string;
  name: string;
  description: string;
  executionProfile: ExecutionProfile;
  modelProfile: string;
  modelId?: string | null;
  promptReleaseId: string | null;
  autonomy: AutonomyLevel;
  configuredAutonomy?: AutonomyLevel;
  safetyAutonomyCap?: AutonomyLevel | null;
  safetyCapReason?: string | null;
  status: ProcessStatus;
  tools: string[];
  updatedAt: string;
  operatingMode?: "active" | "shadow" | "read_only" | "approval_only" | "paused" | "drain" | "emergency_stop";
  activeReleaseId?: string | null;
  inputSchemaJson?: string | null;
  outputSchemaJson?: string | null;
  toolPolicies?: ToolPolicy[];
  dataClassification?: ToolPolicy["dataClassification"];
  /** v1 preserves pre-tenant-prefix Durable Object names; v2 includes the tenant identity. */
  actorIdentityVersion?: 1 | 2;
}

export interface PromptBundle {
  releaseId: string;
  blueprintId: string;
  version: number;
  systemPrompt: string;
  instructions: string[];
  guardrails: string[];
  checksum: string;
  publishedAt: string;
}

export interface ExecutionRequest {
  blueprintId: string;
  consumerId?: string;
  threadId?: string;
  entityId?: string;
  shardKey?: string;
  input: string;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}

export interface ExecutionResult {
  executionId: string;
  instanceKey: string | null;
  profile: ExecutionProfile;
  status: "completed" | "queued" | "running" | "waiting_approval" | "deferred" | "blocked" | "failed" | "cancelled";
  idempotentReplay?: boolean;
  output?: string;
  model?: string;
  startedAt: string;
}

export interface QueueJob extends ExecutionRequest {
  kind?: "execution";
  executionId: string;
  attempt: number;
  tenantId?: string;
}

export interface NotificationDeliveryJob {
  kind: "notification_delivery";
  tenantId: string;
  eventId: string;
  channel?: "webhook" | "email";
  digestBatchId?: string;
}

export interface KnowledgeIndexJob {
  kind: "knowledge_index";
  tenantId: string;
  sourceId: string;
}

export interface ToolActionJob {
  kind: "tool_action";
  tenantId: string;
  dispatchId: string;
}

export interface ProcessDisposalJob {
  kind: "process_disposal";
  tenantId: string;
  retirementId: string;
}

export type WorkrrQueueJob = QueueJob | NotificationDeliveryJob | KnowledgeIndexJob | ToolActionJob | ProcessDisposalJob;

export function instanceKeyFor(profile: ExecutionProfile, request: ExecutionRequest): string | null {
  const base = request.blueprintId;
  switch (profile) {
    case "conversation":
      if (!request.threadId) throw new Error("threadId is required for conversation agents");
      return `${base}:thread:${request.threadId}`;
    case "consumer":
      if (!request.consumerId) throw new Error("consumerId is required for consumer agents");
      return `${base}:consumer:${request.consumerId}`;
    case "entity":
      if (!request.entityId) throw new Error("entityId is required for entity agents");
      return `${base}:entity:${request.entityId}`;
    case "shared_shard":
      if (!request.shardKey) throw new Error("shardKey is required for shared shard agents");
      return `${base}:shard:${request.shardKey}`;
    case "temporary_durable":
      return `${base}:temporary:${request.idempotencyKey ?? crypto.randomUUID()}`;
    case "instant":
    case "workflow":
      return null;
  }
}

/**
 * Returns the server-derived Durable Object identity. Clients supply only the
 * profile-specific business reference; the authenticated tenant is added here.
 */
export function tenantInstanceKeyFor(
  tenantId: string,
  profile: ExecutionProfile,
  request: ExecutionRequest,
  identityVersion: 1 | 2 = 2,
): string | null {
  const logicalKey = instanceKeyFor(profile, request);
  if (!logicalKey || identityVersion === 1) return logicalKey;
  if (!tenantId.trim()) throw new Error("tenantId is required for tenant-scoped agent identity");
  return `v2:tenant:${encodeURIComponent(tenantId)}:${logicalKey}`;
}

export const modelProfiles = {
  fast: { label: "Fast", model: "@cf/meta/llama-3.1-8b-instruct-fp8", use: "Classification and extraction" },
  balanced: { label: "Balanced", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", use: "General process work" },
  reasoning: { label: "Reasoning", model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", use: "Complex analysis" }
} as const;

export const supportedWorkersAIModels = [
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
  "@cf/qwen/qwen3-30b-a3b-fp8"
] as const;

export type SupportedWorkersAIModel = typeof supportedWorkersAIModels[number];

export const supportedGatewayModels = ["openai/gpt-4.1-mini"] as const;
export type SupportedGatewayModel = typeof supportedGatewayModels[number];
export const supportedInferenceModels = [...supportedWorkersAIModels, ...supportedGatewayModels] as const;
export type SupportedInferenceModel = typeof supportedInferenceModels[number];

/** Governed product metadata only; runtime releases always persist the exact model ID and boundary. */
export const inferenceModelCatalog: Record<SupportedInferenceModel, {
  label: string;
  profile: keyof typeof modelProfiles;
  use: string;
  guidance: string;
  provider: string;
  boundary: "workers_ai" | "ai_gateway";
}> = {
  "@cf/meta/llama-3.1-8b-instruct-fp8": {
    label: "Llama 3.1 8B FP8",
    profile: "fast",
    use: "Classification and extraction",
    guidance: "Choose for short, repeatable tasks where response speed matters most.",
    provider: "Cloudflare Workers AI",
    boundary: "workers_ai"
  },
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast": {
    label: "Llama 3.3 70B FP8 Fast",
    profile: "balanced",
    use: "General process work",
    guidance: "Choose for the broadest range of operational assistants and process steps.",
    provider: "Cloudflare Workers AI",
    boundary: "workers_ai"
  },
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b": {
    label: "DeepSeek R1 Distill Qwen 32B",
    profile: "reasoning",
    use: "Complex analysis",
    guidance: "Choose when analysis quality matters more than the fastest response.",
    provider: "Cloudflare Workers AI",
    boundary: "workers_ai"
  },
  "@cf/qwen/qwen3-30b-a3b-fp8": {
    label: "Qwen3 30B A3B FP8",
    profile: "reasoning",
    use: "Efficient reasoning and agent tools",
    guidance: "Choose for multilingual reasoning and tool-capable process work when lower inference cost matters.",
    provider: "Cloudflare Workers AI",
    boundary: "workers_ai"
  },
  "openai/gpt-4.1-mini": {
    label: "GPT-4.1 mini",
    profile: "balanced",
    use: "Gateway-hosted general process work",
    guidance: "Choose only after the organization enables its Cloudflare AI Gateway handoff and approves third-party processing.",
    provider: "Cloudflare AI Gateway · OpenAI",
    boundary: "ai_gateway"
  }
};

/** Backwards-compatible Workers-only catalog for existing provisioning consumers. */
export const workersAIModelCatalog = Object.fromEntries(
  supportedWorkersAIModels.map((id) => [id, inferenceModelCatalog[id]])
) as Record<SupportedWorkersAIModel, (typeof inferenceModelCatalog)[SupportedWorkersAIModel]>;
