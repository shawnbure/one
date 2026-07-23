import { Agent } from "agents";
import type { AutonomyLevel, PromptBundle, ToolPolicy } from "@workrr/contracts";
import type { DataClassification } from "./data-governance";
import { runModel } from "./model";
import type { Env } from "./types";
import { applyDlp, DlpBlockedError } from "./dlp";
import { validateContractOutput, type ProcessSchema } from "./contracts";
import { emitNotification } from "./notifications";

interface AgentState {
  tenantId: string | null;
  blueprintId: string | null;
  /** Legacy field used by actors created before process/prompt release identity was separated. */
  releaseId?: string | null;
  promptReleaseId: string | null;
  processReleaseId: string | null;
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

interface ActorLocalTaskPayload {
  taskId: string;
  tenantId: string;
  blueprintId: string;
  sourceExecutionId: string;
  label: string;
  kind: "queue" | "schedule";
}

type MemoryRow = {
  id: string; role: "user" | "assistant"; content: string; source_execution_id: string | null;
  status: "active" | "quarantined" | "deleted"; revision: number; last_reason: string | null;
  last_changed_by: string | null; created_at: string; updated_at: string;
};
type FactRow = {
  id: string; category: DurableActorFact["category"]; content: string; source_turn_id: string;
  source_execution_id: string | null; status: DurableActorFact["status"]; revision: number;
  proposed_by: string; approved_by: string | null; reason: string; expires_at: string;
  created_at: string; updated_at: string;
};

export class ProcessAgent extends Agent<Env, AgentState> {
  initialState: AgentState = {
    tenantId: null, blueprintId: null, promptReleaseId: null, processReleaseId: null,
    turnCount: 0, lastActiveAt: null
  };

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
    this.sql`CREATE TABLE IF NOT EXISTS durable_fact (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL CHECK (category IN ('preference','customer_context','process_context','constraint')),
      content TEXT NOT NULL,
      source_turn_id TEXT NOT NULL,
      source_execution_id TEXT,
      status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','retired')),
      revision INTEGER NOT NULL DEFAULT 1,
      proposed_by TEXT NOT NULL,
      approved_by TEXT,
      reason TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`;
    this.sql`CREATE INDEX IF NOT EXISTS idx_durable_fact_context
      ON durable_fact(status, expires_at, updated_at)`;
    this.sql`CREATE TABLE IF NOT EXISTS actor_local_work (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('queue', 'schedule')),
      label TEXT NOT NULL,
      source_execution_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('queued','scheduled','running','completed','cancelled','failed')),
      sdk_reference_id TEXT,
      due_at TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    )`;
    this.sql`CREATE INDEX IF NOT EXISTS idx_actor_local_work_status
      ON actor_local_work(status, created_at)`;
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
    return this.state.processReleaseId ?? null;
  }

  pinnedPromptReleaseId(): string | null {
    return this.state.promptReleaseId ?? this.state.releaseId ??
      this.sql<{ release_id: string }>`SELECT release_id FROM prompt_bundle ORDER BY installed_at DESC LIMIT 1`[0]
        ?.release_id ?? null;
  }

  adoptProcessRelease(processReleaseId: string, promptReleaseId: string): void {
    const installedPromptReleaseId = this.pinnedPromptReleaseId();
    if (!installedPromptReleaseId || installedPromptReleaseId !== promptReleaseId ||
      !this.hasPromptRelease(promptReleaseId)) {
      throw new Error("Legacy actor prompt release cannot be attributed to the requested process release");
    }
    if (this.state.processReleaseId && this.state.processReleaseId !== processReleaseId) {
      throw new Error("Actor process release changed; reload before attribution");
    }
    this.setState({
      ...this.state, releaseId: undefined, promptReleaseId: installedPromptReleaseId, processReleaseId
    });
  }

  installPromptBundle(bundle: PromptBundle, tenantId: string, processReleaseId: string): void {
    this.sql`INSERT OR REPLACE INTO prompt_bundle
      (release_id, blueprint_id, version, bundle_json, checksum, installed_at)
      VALUES (${bundle.releaseId}, ${bundle.blueprintId}, ${bundle.version}, ${JSON.stringify(bundle)}, ${bundle.checksum}, ${new Date().toISOString()})`;
    this.setState({
      ...this.state, tenantId, blueprintId: bundle.blueprintId, releaseId: undefined,
      promptReleaseId: bundle.releaseId, processReleaseId
    });
  }

  migratePromptBundle(bundle: PromptBundle, tenantId: string, expectedFromReleaseId: string,
    targetProcessReleaseId: string): void {
    if (this.state.processReleaseId && this.state.processReleaseId !== expectedFromReleaseId) {
      throw new Error("Actor release changed; reload before migrating");
    }
    this.installPromptBundle(bundle, tenantId, targetProcessReleaseId);
  }

  async execute(input: string, safeInput: string, modelProfile: string, modelId: string | null, executionId: string,
    outputSchema: ProcessSchema | null = null, persistAssistant = true,
    autonomy: AutonomyLevel = "suggest", toolPolicies: ToolPolicy[] = [],
    dataClassification: DataClassification = "internal"): Promise<{
    output: string; outputPreview: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number;
    turnCount: number; toolApprovalRequired: boolean; inferenceProvider: "workers_ai" | "ai_gateway";
    gatewayId: string | null; gatewayStep: number | null; gatewayCacheStatus: string | null;
    gatewayLogId: string | null;
  }> {
    const promptReleaseId = this.pinnedPromptReleaseId();
    const row = this.sql<{ bundle_json: string }>`SELECT bundle_json FROM prompt_bundle WHERE release_id = ${promptReleaseId}`[0];
    if (!row) throw new Error("Prompt release has not been installed on this agent instance");

    const history = boundedConversationContext(
      this.sql<MemoryRow>`SELECT * FROM governed_memory WHERE status='active' ORDER BY created_at DESC LIMIT 40`
    );
    const durableFacts = boundedDurableFacts(
      this.sql<FactRow>`SELECT * FROM durable_fact
        WHERE status='active' AND expires_at > ${new Date().toISOString()}
        ORDER BY updated_at DESC LIMIT 30`
    );
    const now = new Date().toISOString();
    const userTurnId = crypto.randomUUID();
    this.sql`INSERT INTO governed_memory
      (id, role, content, source_execution_id, status, revision, created_at, updated_at)
      VALUES (${userTurnId}, 'user', ${safeInput}, ${executionId}, 'active', 1, ${now}, ${now})`;
    const result = await runModel(this.env, modelProfile, JSON.parse(row.bundle_json) as PromptBundle, input,
      this.sessionAffinity, { tenantId: this.state.tenantId!, executionId, autonomy, policies: toolPolicies,
        dataClassification },
      history, modelId, durableFacts);
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

  async queueLocalTask(tenantId: string, blueprintId: string, sourceExecutionId: string, label: string) {
    this.assertIdentity(tenantId, blueprintId);
    const taskId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.sql`INSERT INTO actor_local_work
      (id, kind, label, source_execution_id, status, created_at)
      VALUES (${taskId}, 'queue', ${label}, ${sourceExecutionId}, 'queued', ${createdAt})`;
    const sdkReferenceId = await this.queue("completeLocalTask", {
      taskId, tenantId, blueprintId, sourceExecutionId, label, kind: "queue"
    } satisfies ActorLocalTaskPayload, { retry: { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 5_000 } });
    this.sql`UPDATE actor_local_work SET sdk_reference_id=${sdkReferenceId} WHERE id=${taskId}`;
    return { taskId, sdkReferenceId, status: "queued" as const };
  }

  async scheduleLocalFollowUp(
    tenantId: string,
    blueprintId: string,
    sourceExecutionId: string,
    label: string,
    dueAt: string,
  ) {
    this.assertIdentity(tenantId, blueprintId);
    const taskId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const schedule = await this.schedule(new Date(dueAt), "completeLocalTask", {
      taskId, tenantId, blueprintId, sourceExecutionId, label, kind: "schedule"
    } satisfies ActorLocalTaskPayload, {
      idempotent: true,
      retry: { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 30_000 }
    });
    this.sql`INSERT INTO actor_local_work
      (id, kind, label, source_execution_id, status, sdk_reference_id, due_at, created_at)
      VALUES (${taskId}, 'schedule', ${label}, ${sourceExecutionId}, 'scheduled',
        ${schedule.id}, ${dueAt}, ${createdAt})`;
    return { taskId, scheduleId: schedule.id, status: "scheduled" as const, dueAt };
  }

  async completeLocalTask(payload: ActorLocalTaskPayload) {
    this.assertIdentity(payload.tenantId, payload.blueprintId);
    const current = this.sql<{ status: string }>`SELECT status FROM actor_local_work WHERE id=${payload.taskId}`[0];
    if (!current || ["completed", "cancelled"].includes(current.status)) return;
    this.sql`UPDATE actor_local_work SET status='running' WHERE id=${payload.taskId}`;
    try {
      if (payload.kind === "schedule") {
        await emitNotification(this.env, payload.tenantId, {
          eventType: "agent.follow_up_due",
          title: "Durable actor follow-up is due",
          detail: payload.label,
          targetType: "execution",
          targetId: payload.sourceExecutionId
        });
      }
      this.sql`UPDATE actor_local_work SET status='completed', completed_at=${new Date().toISOString()}
        WHERE id=${payload.taskId}`;
    } catch (error) {
      this.sql`UPDATE actor_local_work SET status='failed', completed_at=${new Date().toISOString()}
        WHERE id=${payload.taskId}`;
      throw error;
    }
  }

  async listLocalWork(tenantId: string, blueprintId: string) {
    this.assertIdentity(tenantId, blueprintId);
    const schedules = await this.listSchedules();
    const tasks = this.sql<{
      id: string; kind: "queue" | "schedule"; label: string; source_execution_id: string;
      status: ActorLocalTask["status"]; sdk_reference_id: string | null; due_at: string | null;
      created_at: string; completed_at: string | null;
    }>`SELECT * FROM actor_local_work ORDER BY created_at DESC LIMIT 50`.map((row) => ({
      id: row.id, kind: row.kind, label: row.label, sourceExecutionId: row.source_execution_id,
      status: row.status, sdkReferenceId: row.sdk_reference_id, dueAt: row.due_at,
      createdAt: row.created_at, completedAt: row.completed_at
    }));
    return { tasks, schedules: schedules.map((item) => ({
      id: item.id, type: item.type, callback: item.callback, time: item.time
    })) };
  }

  async cancelLocalSchedule(tenantId: string, blueprintId: string, scheduleId: string) {
    this.assertIdentity(tenantId, blueprintId);
    const task = this.sql<{ id: string; status: string }>`SELECT id, status FROM actor_local_work
      WHERE sdk_reference_id=${scheduleId} AND kind='schedule'`[0];
    if (!task || task.status !== "scheduled") return { cancelled: false };
    const cancelled = await this.cancelSchedule(scheduleId);
    if (cancelled) {
      this.sql`UPDATE actor_local_work SET status='cancelled', completed_at=${new Date().toISOString()}
        WHERE id=${task.id}`;
    }
    return { cancelled };
  }

  listGovernedMemory(tenantId: string, blueprintId: string, limit = 50): GovernedMemoryTurn[] {
    this.assertIdentity(tenantId, blueprintId);
    return this.sql<MemoryRow>`SELECT * FROM governed_memory ORDER BY created_at DESC LIMIT ${Math.min(limit, 100)}`
      .map(memoryRow);
  }

  listDurableFacts(tenantId: string, blueprintId: string, limit = 50): DurableActorFact[] {
    this.assertIdentity(tenantId, blueprintId);
    return this.sql<FactRow>`SELECT * FROM durable_fact ORDER BY updated_at DESC LIMIT ${Math.min(limit, 100)}`
      .map(factRow);
  }

  proposeDurableFact(tenantId: string, blueprintId: string, input: {
    category: DurableActorFact["category"]; content: string; sourceTurnId: string;
    actorId: string; reason: string; expiresAt: string;
  }): DurableActorFact {
    this.assertIdentity(tenantId, blueprintId);
    const source = this.sql<MemoryRow>`SELECT * FROM governed_memory WHERE id=${input.sourceTurnId}`[0];
    if (!source || source.status !== "active") throw new Error("An active source memory turn is required");
    const duplicate = this.sql<{ count: number }>`SELECT COUNT(*) count FROM durable_fact
      WHERE content=${input.content} AND status IN ('proposed','active')`[0]?.count ?? 0;
    if (duplicate) throw new Error("This durable fact is already proposed or active");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.sql`INSERT INTO durable_fact
      (id, category, content, source_turn_id, source_execution_id, status, revision, proposed_by,
       reason, expires_at, created_at, updated_at)
      VALUES (${id}, ${input.category}, ${input.content}, ${input.sourceTurnId}, ${source.source_execution_id},
        'proposed', 1, ${input.actorId}, ${input.reason}, ${input.expiresAt}, ${now}, ${now})`;
    return factRow(this.sql<FactRow>`SELECT * FROM durable_fact WHERE id=${id}`[0]!);
  }

  governDurableFact(tenantId: string, blueprintId: string, factId: string, input: {
    action: "approve" | "correct" | "retire"; expectedRevision: number; actorId: string;
    reason: string; content?: string; expiresAt?: string;
  }): DurableActorFact {
    this.assertIdentity(tenantId, blueprintId);
    const current = this.sql<FactRow>`SELECT * FROM durable_fact WHERE id=${factId}`[0];
    if (!current) throw new Error("Durable fact was not found");
    if (current.revision !== input.expectedRevision) throw new Error("Durable fact changed; reload before trying again");
    if (input.action === "approve" && current.status !== "proposed") throw new Error("Only a proposed fact can be approved");
    if (input.action === "approve") {
      const source = this.sql<{ status: string }>`SELECT status FROM governed_memory
        WHERE id=${current.source_turn_id}`[0];
      if (!source || source.status !== "active") {
        throw new Error("The cited source turn must remain active before this fact can be approved");
      }
    }
    if (input.action === "approve" && new Date(current.expires_at).getTime() <= Date.now()) {
      throw new Error("An expired durable fact cannot be approved");
    }
    if (input.action === "approve") {
      const active = this.sql<{ count: number }>`SELECT COUNT(*) count FROM durable_fact
        WHERE status='active' AND expires_at > ${new Date().toISOString()}`[0]?.count ?? 0;
      if (active >= 20) throw new Error("This actor already has the maximum 20 active durable facts");
    }
    if (input.action === "correct" && current.status === "retired") throw new Error("A retired fact cannot be corrected");
    if (input.action === "retire" && current.status === "retired") return factRow(current);
    const content = input.action === "correct" ? input.content! : current.content;
    const status = input.action === "approve" ? "active" : input.action === "retire" ? "retired" : "proposed";
    const approvedBy = input.action === "approve" ? input.actorId :
      input.action === "correct" ? null : current.approved_by;
    const expiresAt = input.expiresAt ?? current.expires_at;
    const now = new Date().toISOString();
    this.sql`UPDATE durable_fact SET content=${content}, status=${status}, revision=revision+1,
      approved_by=${approvedBy}, reason=${input.reason}, expires_at=${expiresAt}, updated_at=${now}
      WHERE id=${factId} AND revision=${input.expectedRevision}`;
    return factRow(this.sql<FactRow>`SELECT * FROM durable_fact WHERE id=${factId}`[0]!);
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
    if (input.action === "correct") {
      this.sql`UPDATE durable_fact SET status='proposed', approved_by=NULL, revision=revision+1,
        reason=${`Source turn changed: ${input.reason}`}, updated_at=${now}
        WHERE source_turn_id=${turnId} AND status IN ('proposed','active')`;
    } else if (input.action === "quarantine" || input.action === "delete") {
      this.sql`UPDATE durable_fact SET status='retired', revision=revision+1,
        reason=${`Source turn ${input.action}d: ${input.reason}`}, updated_at=${now}
        WHERE source_turn_id=${turnId} AND status IN ('proposed','active')`;
    }
    return memoryRow(this.sql<MemoryRow>`SELECT * FROM governed_memory WHERE id=${turnId}`[0]!);
  }

  async eraseData(tenantId: string, blueprintId: string): Promise<{ turns: number; promptBundles: number }> {
    if (this.state.tenantId !== tenantId || this.state.blueprintId !== blueprintId) {
      throw new Error("Agent retirement identity mismatch");
    }
    const turns = this.sql<{ count: number }>`SELECT COUNT(*) count FROM conversation_turn`[0]?.count ?? 0;
    const governedTurns = this.sql<{ count: number }>`SELECT COUNT(*) count FROM governed_memory`[0]?.count ?? 0;
    const promptBundles = this.sql<{ count: number }>`SELECT COUNT(*) count FROM prompt_bundle`[0]?.count ?? 0;
    this.sql`DELETE FROM conversation_turn`;
    this.sql`DELETE FROM governed_memory`;
    this.sql`DELETE FROM durable_fact`;
    this.sql`DELETE FROM prompt_bundle`;
    this.dequeueAll();
    const schedules = await this.listSchedules();
    await Promise.all(schedules.map((schedule) => this.cancelSchedule(schedule.id)));
    this.sql`DELETE FROM actor_local_work`;
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
    this.sql`DELETE FROM durable_fact WHERE expires_at < ${new Date().toISOString()} OR created_at < ${cutoff}`;
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

export function boundedDurableFacts(rows: FactRow[], maxFacts = 20, maxCharacters = 4_000) {
  const selected: string[] = [];
  let characters = 0;
  for (const row of rows.slice(0, Math.max(1, maxFacts))) {
    const content = row.content.slice(0, 500);
    if (characters + content.length > maxCharacters) break;
    selected.push(`[${row.category}] ${content}`);
    characters += content.length;
  }
  return selected;
}

function memoryRow(row: MemoryRow): GovernedMemoryTurn {
  return {
    id: row.id, role: row.role, content: row.content, sourceExecutionId: row.source_execution_id,
    status: row.status, revision: row.revision, lastReason: row.last_reason,
    lastChangedBy: row.last_changed_by, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function factRow(row: FactRow): DurableActorFact {
  return {
    id: row.id, category: row.category, content: row.content, sourceTurnId: row.source_turn_id,
    sourceExecutionId: row.source_execution_id, status: row.status, revision: row.revision,
    proposedBy: row.proposed_by, approvedBy: row.approved_by, reason: row.reason,
    expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at
  };
}
