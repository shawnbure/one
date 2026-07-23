import type { WorkrrQueueJob } from "@workrr/contracts";
import type { ProcessAgent } from "./agent";

export interface Env {
  DB: D1Database;
  AI: Ai;
  PROCESS_AGENT: DurableObjectNamespace<ProcessAgent>;
  PROCESS_QUEUE: Queue<WorkrrQueueJob>;
  PROCESS_WORKFLOW: Workflow;
  ENVIRONMENT: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  WEBHOOK_INBOX_SECRET?: string;
  NOTIFICATION_WEBHOOK_SECRET?: string;
  LOCAL_DEV?: string;
}

export interface BlueprintRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  execution_profile: string;
  model_profile: string;
  prompt_release_id: string | null;
  autonomy: string;
  status: string;
  tools_json: string;
  updated_at: string;
  operating_mode?: string;
}

export interface PromptRow {
  id: string;
  blueprint_id: string;
  version: number;
  system_prompt: string;
  instructions_json: string;
  guardrails_json: string;
  checksum: string;
  published_at: string;
}
