import type { WorkrrQueueJob } from "@workrr/contracts";
import type { ProcessAgent } from "./agent";

export interface Env {
  DB: D1Database;
  AI: Ai;
  PROCESS_AGENT: DurableObjectNamespace<ProcessAgent>;
  PROCESS_QUEUE: Queue<WorkrrQueueJob>;
  PROCESS_WORKFLOW: Workflow;
  EVALUATION_WORKFLOW: Workflow;
  ENVIRONMENT: "development" | "production";
  APP_DOMAIN: "one-dev.workrr.ai" | "one.workrr.ai";
  ACCESS_TEAM_DOMAIN: "https://workrr-one.cloudflareaccess.com";
  ACCESS_AUD: "27ae84d632232f993e89fb6d9b0489ed6683758137d99fabee869f4a3840656b" | "37177f7d83f8b4f4905fccf2f0f04785a17ee9e46809ef2bd2cbb09e15c44ee0";
  WEBHOOK_INBOX_SECRET?: string;
  NOTIFICATION_WEBHOOK_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY?: string;
  RUBRIC_SIGNING_JWK?: string;
  RUBRIC_PUBLISHER_NAME?: string;
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
