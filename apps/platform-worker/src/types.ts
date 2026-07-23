import type { QueueJob } from "@workrr/contracts";
import type { ProcessAgent } from "./agent";

export interface Env {
  DB: D1Database;
  AI: Ai;
  PROCESS_AGENT: DurableObjectNamespace<ProcessAgent>;
  PROCESS_QUEUE: Queue<QueueJob>;
  PROCESS_WORKFLOW: Workflow;
  ENVIRONMENT: string;
}

export interface BlueprintRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  execution_profile: string;
  model_profile: string;
  prompt_release_id: string;
  autonomy: string;
  status: string;
  tools_json: string;
  updated_at: string;
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
