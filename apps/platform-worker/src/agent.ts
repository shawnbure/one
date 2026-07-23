import { Agent } from "agents";
import type { PromptBundle } from "@workrr/contracts";
import { runModel } from "./model";
import type { Env } from "./types";
import { applyDlp, DlpBlockedError } from "./dlp";
import { validateContractOutput, type ProcessSchema } from "./contracts";

interface AgentState {
  tenantId: string | null;
  blueprintId: string | null;
  releaseId: string | null;
  turnCount: number;
  lastActiveAt: string | null;
}

export class ProcessAgent extends Agent<Env, AgentState> {
  initialState: AgentState = { tenantId: null, blueprintId: null, releaseId: null, turnCount: 0, lastActiveAt: null };

  async onStart(): Promise<void> {
    this.sql`CREATE TABLE IF NOT EXISTS prompt_bundle (
      release_id TEXT PRIMARY KEY,
      blueprint_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      bundle_json TEXT NOT NULL,
      checksum TEXT NOT NULL,
      installed_at TEXT NOT NULL
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS conversation_turn (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    )`;
  }

  hasPromptRelease(releaseId: string): boolean {
    return this.sql<{ count: number }>`SELECT COUNT(*) AS count FROM prompt_bundle WHERE release_id = ${releaseId}`[0]?.count === 1;
  }

  bindTenant(tenantId: string, blueprintId: string): void {
    if (this.state.tenantId && this.state.tenantId !== tenantId) throw new Error("Agent tenant identity mismatch");
    if (this.state.blueprintId && this.state.blueprintId !== blueprintId) throw new Error("Agent process identity mismatch");
    if (!this.state.tenantId || !this.state.blueprintId) {
      this.setState({ ...this.state, tenantId, blueprintId });
    }
  }

  installPromptBundle(bundle: PromptBundle, tenantId: string): void {
    this.sql`INSERT OR REPLACE INTO prompt_bundle
      (release_id, blueprint_id, version, bundle_json, checksum, installed_at)
      VALUES (${bundle.releaseId}, ${bundle.blueprintId}, ${bundle.version}, ${JSON.stringify(bundle)}, ${bundle.checksum}, ${new Date().toISOString()})`;
    this.setState({ ...this.state, tenantId, blueprintId: bundle.blueprintId, releaseId: bundle.releaseId });
  }

  async execute(input: string, safeInput: string, modelProfile: string, executionId: string,
    outputSchema: ProcessSchema | null = null, persistAssistant = true): Promise<{
    output: string; outputPreview: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; turnCount: number;
  }> {
    const row = this.sql<{ bundle_json: string }>`SELECT bundle_json FROM prompt_bundle WHERE release_id = ${this.state.releaseId}`[0];
    if (!row) throw new Error("Prompt release has not been installed on this agent instance");

    const now = new Date().toISOString();
    this.sql`INSERT INTO conversation_turn (id, role, content, created_at) VALUES (${crypto.randomUUID()}, 'user', ${safeInput}, ${now})`;
    const result = await runModel(this.env, modelProfile, JSON.parse(row.bundle_json) as PromptBundle, input, this.sessionAffinity);
    if (!this.state.tenantId) throw new Error("Agent tenant identity is not installed");
    const outputDlp = await applyDlp(this.env, this.state.tenantId, result.output, {
      direction: "output", stage: "durable_agent", executionId, blueprintId: this.state.blueprintId ?? undefined
    });
    if (outputDlp.blocked) throw new DlpBlockedError(outputDlp.blockedDetectors);
    const contracted = validateContractOutput(outputDlp.modelText, outputSchema);
    if (persistAssistant) {
      this.sql`INSERT INTO conversation_turn (id, role, content, created_at) VALUES (${crypto.randomUUID()}, 'assistant', ${contracted.value}, ${new Date().toISOString()})`;
    }
    const turnCount = this.state.turnCount + 1;
    this.setState({ ...this.state, turnCount, lastActiveAt: now });
    return { ...result, output: contracted.value, outputPreview: contracted.value, turnCount };
  }

  getConversation(limit = 30): Array<{ role: string; content: string; created_at: string }> {
    return this.sql<{ role: string; content: string; created_at: string }>`SELECT role, content, created_at FROM conversation_turn ORDER BY created_at DESC LIMIT ${Math.min(limit, 100)}`.reverse();
  }
}
