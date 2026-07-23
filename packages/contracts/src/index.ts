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

export interface AgentBlueprint {
  id: string;
  name: string;
  description: string;
  executionProfile: ExecutionProfile;
  modelProfile: string;
  promptReleaseId: string | null;
  autonomy: AutonomyLevel;
  status: ProcessStatus;
  tools: string[];
  updatedAt: string;
  operatingMode?: "active" | "read_only" | "approval_only" | "paused" | "drain" | "emergency_stop";
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
  status: "completed" | "queued" | "running" | "waiting_approval" | "deferred" | "failed";
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
}

export type WorkrrQueueJob = QueueJob | NotificationDeliveryJob;

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

export const modelProfiles = {
  fast: { label: "Fast", model: "@cf/meta/llama-3.1-8b-instruct-fp8", use: "Classification and extraction" },
  balanced: { label: "Balanced", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", use: "General process work" },
  reasoning: { label: "Reasoning", model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", use: "Complex analysis" }
} as const;
