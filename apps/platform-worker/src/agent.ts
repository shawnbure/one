import { Agent } from "agents";
import type { AutonomyLevel, PromptBundle, ToolPolicy } from "@workrr/contracts";
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

type MemoryRow = {
  id: string; role: "user" | "assistant"; content: string; source_execution_id: string | null;
  status: "active" | "quarantined" | "deleted"; revision: number; last_reason: string | null;
  last_changed_by: string | null; created_at: string; updated_at: string;
};

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
    this.sql`CREATE TABLE IF NOT EXISTS governed_memory (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      source_execution_id TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'quarantined', 'deleted')),
      revision INTEGER NOT NULL DEFAULT 1,
      last_reason TEXT,
      last_changed_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`;
    this.sql`CREATE INDEX IF NOT EXISTS idx_governed_memory_context
      ON governed_memory(status, created_at)`;
    this.sql`INSERT OR IGNORE INTO governed_memory
      (id, role, content, source_execution_id, status, revision, created_at, updated_at)
      SELECT id, role, content, NULL, 'active', 1, created_at, created_at FROM conversation_turn`;
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

  pinnedReleaseId(): string | null {
    return this.state.releaseId;
  }

  installPromptBundle(bundle: PromptBundle, tenantId: string): void {
    this.sql`INSERT OR REPLACE INTO prompt_bundle
      (release_id, blueprint_id, version, bundle_json, checksum, installed_at)
      VALUES (${bundle.releaseId}, ${bundle.blueprintId}, ${bundle.version}, ${JSON.stringify(bundle)}, ${bundle.checksum}, ${new Date().toISOString()})`;
    this.setState({ ...this.state, tenantId, blueprintId: bundle.blueprintId, releaseId: bundle.releaseId });
  }

  migratePromptBundle(bundle: PromptBundle, tenantId: string, expectedFromReleaseId: string): void {
    if (this.state.releaseId && this.state.releaseId !== expectedFromReleaseId) {
      throw new Error("Actor release changed; reload before migrating");
    }
    this.installPromptBundle(bundle, tenantId);
  }

  async execute(input: string, safeInput: string, modelProfile: string, modelId: string | null, executionId: string,
    outputSchema: ProcessSchema | null = null, persistAssistant = true,
    autonomy: AutonomyLevel = "suggest", toolPolicies: ToolPolicy[] = []): Promise<{
    output: string; outputPreview: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number;
    turnCount: number; toolApprovalRequired: boolean;
  }> {
    const row = this.sql<{ bundle_json: string }>`SELECT bundle_json FROM prompt_bundle WHERE release_id = ${this.state.releaseId}`[0];
    if (!row) throw new Error("Prompt release has not been installed on this agent instance");

    const history = boundedConversationContext(
      this.sql<MemoryRow>`SELECT * FROM governed_memory WHERE status='active' ORDER BY created_at DESC LIMIT 40`
    );
    const now = new Date().toISOString();
    const userTurnId = crypto.randomUUID();
    this.sql`INSERT INTO governed_memory
      (id, role, content, source_execution_id, status, revision, created_at, updated_at)
      VALUES (${userTurnId}, 'user', ${safeInput}, ${executionId}, 'active', 1, ${now}, ${now})`;
    const result = await runModel(this.env, modelProfile, JSON.parse(row.bundle_json) as PromptBundle, input,
      this.sessionAffinity, { tenantId: this.state.tenantId!, executionId, autonomy, policies: toolPolicies },
      history, modelId);
    if (!this.state.tenantId) throw new Error("Agent tenant identity is not installed");
    const outputDlp = await applyDlp(this.env, this.state.tenantId, result.output, {
      direction: "output", stage: "durable_agent", executionId, blueprintId: this.state.blueprintId ?? undefined
    });
    if (outputDlp.blocked) throw new DlpBlockedError(outputDlp.blockedDetectors);
    const contracted = validateContractOutput(outputDlp.modelText, outputSchema);
    if (persistAssistant && !result.toolApprovalRequired) {
      const assistantNow = new Date().toISOString();
      this.sql`INSERT INTO governed_memory
        (id, role, content, source_execution_id, status, revision, created_at, updated_at)
        VALUES (${crypto.randomUUID()}, 'assistant', ${contracted.value}, ${executionId}, 'active', 1,
          ${assistantNow}, ${assistantNow})`;
    }
    const turnCount = this.state.turnCount + 1;
    this.setState({ ...this.state, turnCount, lastActiveAt: now });
    return { ...result, output: contracted.value, outputPreview: contracted.value, turnCount };
  }

  getConversation(limit = 30): Array<{ role: string; content: string; created_at: string }> {
    return this.sql<{ role: string; content: string; created_at: string }>`
      SELECT role, content, created_at FROM governed_memory
      WHERE status='active' ORDER BY created_at DESC LIMIT ${Math.min(limit, 100)}`.reverse();
  }

  listGovernedMemory(tenantId: string, blueprintId: string, limit = 50): GovernedMemoryTurn[] {
    this.assertIdentity(tenantId, blueprintId);
    return this.sql<MemoryRow>`SELECT * FROM governed_memory ORDER BY created_at DESC LIMIT ${Math.min(limit, 100)}`
      .map(memoryRow);
  }

  governMemory(tenantId: string, blueprintId: string, turnId: string, input: {
    action: "correct" | "quarantine" | "restore" | "delete";
    expectedRevision: number;
    content?: string;
    reason: string;
    actorId: string;
  }): GovernedMemoryTurn {
    this.assertIdentity(tenantId, blueprintId);
    const current = this.sql<MemoryRow>`SELECT * FROM governed_memory WHERE id=${turnId}`[0];
    if (!current) throw new Error("Memory turn was not found");
    if (current.revision !== input.expectedRevision) throw new Error("Memory turn changed; reload before trying again");
    const nextStatus = input.action === "quarantine" ? "quarantined" :
      input.action === "delete" ? "deleted" : "active";
    const nextContent = input.action === "correct" ? input.content! :
      input.action === "delete" ? "[deleted]" : current.content;
    const now = new Date().toISOString();
    this.sql`UPDATE governed_memory SET content=${nextContent}, status=${nextStatus},
      revision=revision+1, last_reason=${input.reason}, last_changed_by=${input.actorId}, updated_at=${now}
      WHERE id=${turnId} AND revision=${input.expectedRevision}`;
    return memoryRow(this.sql<MemoryRow>`SELECT * FROM governed_memory WHERE id=${turnId}`[0]!);
  }

  eraseData(tenantId: string, blueprintId: string): { turns: number; promptBundles: number } {
    if (this.state.tenantId !== tenantId || this.state.blueprintId !== blueprintId) {
      throw new Error("Agent retirement identity mismatch");
    }
    const turns = this.sql<{ count: number }>`SELECT COUNT(*) count FROM conversation_turn`[0]?.count ?? 0;
    const governedTurns = this.sql<{ count: number }>`SELECT COUNT(*) count FROM governed_memory`[0]?.count ?? 0;
    const promptBundles = this.sql<{ count: number }>`SELECT COUNT(*) count FROM prompt_bundle`[0]?.count ?? 0;
    this.sql`DELETE FROM conversation_turn`;
    this.sql`DELETE FROM governed_memory`;
    this.sql`DELETE FROM prompt_bundle`;
    this.setState(this.initialState);
    return { turns: Math.max(turns, governedTurns), promptBundles };
  }

  expireConversationBefore(tenantId: string, blueprintId: string, cutoff: string): { deleted: number } {
    if (!this.state.tenantId && !this.state.blueprintId) return { deleted: 0 };
    if (this.state.tenantId !== tenantId || this.state.blueprintId !== blueprintId) {
      throw new Error("Agent retention identity mismatch");
    }
    const legacyDeleted = this.sql<{ count: number }>`SELECT COUNT(*) count FROM conversation_turn
      WHERE created_at < ${cutoff}`[0]?.count ?? 0;
    const deleted = this.sql<{ count: number }>`SELECT COUNT(*) count FROM governed_memory
      WHERE created_at < ${cutoff}`[0]?.count ?? 0;
    this.sql`DELETE FROM conversation_turn WHERE created_at < ${cutoff}`;
    this.sql`DELETE FROM governed_memory WHERE created_at < ${cutoff}`;
    return { deleted: Math.max(deleted, legacyDeleted) };
  }

  private assertIdentity(tenantId: string, blueprintId: string) {
    if (this.state.tenantId !== tenantId || this.state.blueprintId !== blueprintId) {
      throw new Error("Agent memory identity mismatch");
    }
  }
}

export function boundedConversationContext(rows: MemoryRow[], maxTurns = 20, maxCharacters = 24_000) {
  const selected: Array<{ role: "user" | "assistant"; content: string }> = [];
  let characters = 0;
  for (const row of rows.slice(0, Math.max(1, maxTurns))) {
    const content = row.content.slice(0, 8_000);
    if (characters + content.length > maxCharacters) break;
    selected.push({ role: row.role, content });
    characters += content.length;
  }
  return selected.reverse();
}

function memoryRow(row: MemoryRow): GovernedMemoryTurn {
  return {
    id: row.id, role: row.role, content: row.content, sourceExecutionId: row.source_execution_id,
    status: row.status, revision: row.revision, lastReason: row.last_reason,
    lastChangedBy: row.last_changed_by, createdAt: row.created_at, updatedAt: row.updated_at
  };
}
