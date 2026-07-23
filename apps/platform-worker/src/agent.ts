import { Agent } from "agents";
import type { PromptBundle } from "@workrr/contracts";
import { runModel } from "./model";
import type { Env } from "./types";

interface AgentState {
  blueprintId: string | null;
  releaseId: string | null;
  turnCount: number;
  lastActiveAt: string | null;
}

export class ProcessAgent extends Agent<Env, AgentState> {
  initialState: AgentState = { blueprintId: null, releaseId: null, turnCount: 0, lastActiveAt: null };

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

  installPromptBundle(bundle: PromptBundle): void {
    this.sql`INSERT OR REPLACE INTO prompt_bundle
      (release_id, blueprint_id, version, bundle_json, checksum, installed_at)
      VALUES (${bundle.releaseId}, ${bundle.blueprintId}, ${bundle.version}, ${JSON.stringify(bundle)}, ${bundle.checksum}, ${new Date().toISOString()})`;
    this.setState({ ...this.state, blueprintId: bundle.blueprintId, releaseId: bundle.releaseId });
  }

  async execute(input: string, modelProfile: string): Promise<{ output: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; turnCount: number }> {
    const row = this.sql<{ bundle_json: string }>`SELECT bundle_json FROM prompt_bundle WHERE release_id = ${this.state.releaseId}`[0];
    if (!row) throw new Error("Prompt release has not been installed on this agent instance");

    const now = new Date().toISOString();
    this.sql`INSERT INTO conversation_turn (id, role, content, created_at) VALUES (${crypto.randomUUID()}, 'user', ${input}, ${now})`;
    const result = await runModel(this.env, modelProfile, JSON.parse(row.bundle_json) as PromptBundle, input, this.sessionAffinity);
    this.sql`INSERT INTO conversation_turn (id, role, content, created_at) VALUES (${crypto.randomUUID()}, 'assistant', ${result.output}, ${new Date().toISOString()})`;
    const turnCount = this.state.turnCount + 1;
    this.setState({ ...this.state, turnCount, lastActiveAt: now });
    return { ...result, turnCount };
  }

  getConversation(limit = 30): Array<{ role: string; content: string; created_at: string }> {
    return this.sql<{ role: string; content: string; created_at: string }>`SELECT role, content, created_at FROM conversation_turn ORDER BY created_at DESC LIMIT ${Math.min(limit, 100)}`.reverse();
  }
}
