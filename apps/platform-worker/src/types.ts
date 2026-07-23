export interface Env extends Cloudflare.Env {
  WEBHOOK_INBOX_SECRET?: string;
  NOTIFICATION_WEBHOOK_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
  OAUTH_TOKEN_ENCRYPTION_KEY?: string;
  RUBRIC_SIGNING_JWK?: string;
  RUBRIC_PREVIOUS_SIGNING_JWK?: string;
  RUBRIC_SIGNING_VALID_FROM?: string;
  RUBRIC_SIGNING_EXPIRES_AT?: string;
  LOCAL_DEV?: string;
}

export interface BlueprintRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  execution_profile: string;
  model_profile: string;
  model_id?: string | null;
  prompt_release_id: string | null;
  autonomy: string;
  safety_autonomy_cap?: string | null;
  safety_cap_reason?: string | null;
  status: string;
  tools_json: string;
  updated_at: string;
  operating_mode?: string;
  active_release_id?: string | null;
  input_schema_json?: string | null;
  output_schema_json?: string | null;
  tool_policy_json?: string | null;
  data_classification?: "public" | "internal" | "confidential" | "restricted";
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
