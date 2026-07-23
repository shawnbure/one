import type { Env } from "./types";

export type ExecutionEvidence = {
  execution: ExecutionRow;
  approvals: ApprovalRow[];
  audit: AuditRow[];
  citations: CitationRow[];
  toolInvocations: ToolInvocationRow[];
  toolActions: ToolActionRow[];
};

type ExecutionRow = {
  id: string; tenant_id: string; blueprint_id: string; blueprint_name: string;
  execution_profile: string; instance_key: string | null; status: string; model: string | null;
  prompt_release_id: string | null; process_release_id: string | null; autonomy: string;
  autonomy_level: string | null; autonomy_disposition: string | null;
  input_contract_status: string | null; output_contract_status: string | null; contract_error: string | null;
  input_tokens: number; output_tokens: number; total_tokens: number; started_at: string; completed_at: string | null;
  error: string | null;
  [key: string]: unknown;
};
type ApprovalRow = {
  id: string; action_name: string; status: string; title: string | null; requested_at: string;
  decided_at: string | null; decided_by: string | null;
  [key: string]: unknown;
};
type AuditRow = {
  actor_id: string; event_type: string; target_type: string; target_id: string;
  detail_json: string; created_at: string;
};
type CitationRow = {
  source_id: string; source_name: string; chunk_id: string; ordinal: number; score: number;
  provenance: string; excerpt: string; created_at: string;
};
type ToolInvocationRow = {
  id: string; tool_name: string; tool_version: number; status: string; execution_mode: string;
  access_mode: string; risk_level: string; adapter_kind: string; input_json: string; output_json: string | null;
  error: string | null; started_at: string; completed_at: string | null;
  [key: string]: unknown;
};
type ToolActionRow = {
  id: string; tool_name: string; handler_key: string | null; status: string; attempt_count: number;
  provider_resource_id: string | null; last_error: string | null; created_at: string;
  completed_at: string | null; input_json: string; output_json: string | null;
  [key: string]: unknown;
};

export async function getExecutionEvidence(env: Env, tenantId: string, executionId: string): Promise<ExecutionEvidence | null> {
  const execution = await env.DB.prepare(`SELECT e.*, b.name blueprint_name,
    COALESCE(e.autonomy_level, b.autonomy) autonomy, b.prompt_release_id
    FROM executions e JOIN agent_blueprints b ON b.id = e.blueprint_id AND b.tenant_id = e.tenant_id
    WHERE e.id = ? AND e.tenant_id = ? LIMIT 1`).bind(executionId, tenantId).first<ExecutionRow>();
  if (!execution) return null;
  const [approvals, audit, citations, toolInvocations, toolActions] = await Promise.all([
    env.DB.prepare("SELECT * FROM approvals WHERE tenant_id = ? AND execution_id = ? ORDER BY requested_at")
      .bind(tenantId, executionId).all<ApprovalRow>(),
    env.DB.prepare(`SELECT actor_id, event_type, target_type, target_id, detail_json, created_at FROM audit_events
      WHERE tenant_id = ? AND ((target_type = 'execution' AND target_id = ?) OR
      (target_type = 'approval' AND target_id IN (SELECT id FROM approvals WHERE tenant_id=? AND execution_id = ?)) OR
      (target_type = 'tool_action' AND target_id IN
        (SELECT id FROM tool_action_dispatches WHERE tenant_id=? AND execution_id=?))) ORDER BY created_at`)
      .bind(tenantId, executionId, tenantId, executionId, tenantId, executionId).all<AuditRow>(),
    env.DB.prepare(`SELECT source_id, source_name, chunk_id, ordinal, score, provenance, excerpt, created_at
      FROM execution_knowledge_citations WHERE tenant_id=? AND execution_id=? ORDER BY ordinal`)
      .bind(tenantId, executionId).all<CitationRow>(),
    env.DB.prepare(`SELECT id, tool_name, tool_version, status, execution_mode, access_mode, risk_level,
      adapter_kind, input_json, output_json, error, started_at, completed_at
      FROM tool_invocations WHERE tenant_id=? AND execution_id=? ORDER BY started_at`)
      .bind(tenantId, executionId).all<ToolInvocationRow>(),
    env.DB.prepare(`SELECT d.*, i.tool_name, i.handler_key, i.input_json, i.output_json
      FROM tool_action_dispatches d JOIN tool_invocations i ON i.id=d.invocation_id AND i.tenant_id=d.tenant_id
      WHERE d.tenant_id=? AND d.execution_id=? ORDER BY d.created_at`)
      .bind(tenantId, executionId).all<ToolActionRow>()
  ]);
  return {
    execution, approvals: approvals.results, audit: audit.results, citations: citations.results,
    toolInvocations: toolInvocations.results, toolActions: toolActions.results
  };
}

export function explainExecution(evidence: ExecutionEvidence) {
  const { execution, approvals, citations, toolInvocations, toolActions } = evidence;
  const reasons: Array<{ label: string; detail: string; state: "positive" | "neutral" | "attention" }> = [];
  reasons.push({
    label: executionProfileLabel(execution.execution_profile),
    detail: memoryDetail(execution.execution_profile, execution.instance_key),
    state: "neutral"
  });
  if (execution.prompt_release_id) reasons.push({
    label: "Immutable release selected",
    detail: `Release ${execution.prompt_release_id} supplied the prompt, model profile, autonomy, contracts, and tool policy.`,
    state: "positive"
  });
  if (execution.inference_provider === "ai_gateway") reasons.push({
    label: "Cloudflare AI Gateway handoff",
    detail: `The release used gateway ${String(execution.gateway_id ?? "default")} with response caching bypassed${
      execution.gateway_step === null || execution.gateway_step === undefined
        ? "" : `; route step ${String(execution.gateway_step)} completed the request`
    }.`,
    state: "neutral"
  });
  if (execution.input_contract_status && execution.input_contract_status !== "not_configured") reasons.push({
    label: `Input contract ${execution.input_contract_status.replaceAll("_", " ")}`,
    detail: execution.input_contract_status === "failed" ? "The request did not satisfy the published input boundary."
      : execution.input_contract_status === "passed" ? "The transformed input satisfied the published process contract before inference."
        : "Input contract validation has not reached a terminal result.",
    state: execution.input_contract_status === "failed" ? "attention" : "positive"
  });
  if (citations.length) reasons.push({
    label: "Governed knowledge contributed",
    detail: `${citations.length} bounded citation${citations.length === 1 ? "" : "s"} from ${new Set(citations.map((item) => item.source_id)).size} approved source${new Set(citations.map((item) => item.source_id)).size === 1 ? "" : "s"} supported the result.`,
    state: "positive"
  });
  reasons.push({
    label: autonomyTitle(execution.autonomy_disposition ?? execution.autonomy),
    detail: autonomyDetail(execution.autonomy_disposition ?? execution.autonomy, approvals),
    state: ["waiting_approval", "rejected"].includes(execution.autonomy_disposition ?? "") ? "attention" : "neutral"
  });
  if (toolInvocations.length) {
    const proposed = toolInvocations.filter((item) => item.status === "proposed").length;
    const failed = toolInvocations.filter((item) => item.status === "failed").length;
    reasons.push({
      label: `${toolInvocations.length} governed tool call${toolInvocations.length === 1 ? "" : "s"} evaluated`,
      detail: failed ? `${failed} tool call${failed === 1 ? "" : "s"} failed and no success is inferred.`
        : proposed ? `${proposed} call${proposed === 1 ? " was" : "s were"} proposed for human review; proposal is not execution.`
          : "Each call retained its declared access mode, risk, execution mode, and terminal evidence.",
      state: failed ? "attention" : "neutral"
    });
  }
  if (toolActions.length) {
    const completed = toolActions.filter((item) => item.status === "completed").length;
    reasons.push({
      label: "External action delivery separated",
      detail: `${completed} of ${toolActions.length} approved action${toolActions.length === 1 ? "" : "s"} has provider completion evidence. Queue acceptance alone is not counted as completion.`,
      state: toolActions.some((item) => item.status === "failed") ? "attention" : "neutral"
    });
  }
  if (execution.output_contract_status && execution.output_contract_status !== "not_configured") reasons.push({
    label: `Output contract ${execution.output_contract_status.replaceAll("_", " ")}`,
    detail: execution.output_contract_status === "passed"
      ? "The post-DLP result satisfied the published output boundary before persistence or delivery."
      : execution.output_contract_status === "failed"
        ? "The result was stopped because it did not satisfy the published output boundary."
        : "Output contract validation has not reached a terminal result.",
    state: execution.output_contract_status === "failed" ? "attention" : "positive"
  });
  if (execution.error) reasons.push({
    label: "Terminal error recorded",
    detail: "The execution stopped with an error. Use the timeline and bounded error evidence; do not assume partial work completed.",
    state: "attention"
  });
  return {
    schemaVersion: 1,
    title: outcomeTitle(execution.status),
    summary: outcomeSummary(execution, approvals, toolActions),
    reasons,
    externalImpact: externalImpact(toolInvocations, toolActions),
    nextAction: nextAction(execution, approvals, toolInvocations, toolActions),
    evidenceCompleteness: execution.prompt_release_id && execution.autonomy_disposition ? "complete" : "partial",
    generatedBy: "deterministic_evidence_rules"
  };
}

export function exportRedactedExecutionEvidence(evidence: ExecutionEvidence) {
  const explanation = explainExecution(evidence);
  const { execution, approvals, audit, citations, toolInvocations, toolActions } = evidence;
  return {
    schemaVersion: 1,
    exportType: "workrr-redacted-execution-evidence",
    generatedAt: new Date().toISOString(),
    execution: {
      id: execution.id, processId: execution.blueprint_id, processName: execution.blueprint_name,
      status: execution.status, executionProfile: execution.execution_profile,
      durableAffinityPresent: Boolean(execution.instance_key), model: execution.model,
      inferenceProvider: execution.inference_provider ?? "workers_ai",
      gateway: execution.inference_provider === "ai_gateway" ? {
        id: execution.gateway_id ?? "default",
        routeStep: execution.gateway_step ?? null,
        cacheStatus: execution.gateway_cache_status ?? null,
        logReferencePresent: Boolean(execution.gateway_log_id)
      } : null,
      promptReleaseId: execution.prompt_release_id, processReleaseId: execution.process_release_id,
      autonomyLevel: execution.autonomy_level ?? execution.autonomy,
      autonomyDisposition: execution.autonomy_disposition,
      inputContractStatus: execution.input_contract_status,
      outputContractStatus: execution.output_contract_status,
      errorPresent: Boolean(execution.error),
      usage: { inputTokens: execution.input_tokens, outputTokens: execution.output_tokens, totalTokens: execution.total_tokens },
      startedAt: execution.started_at, completedAt: execution.completed_at
    },
    explanation,
    approvals: approvals.map((item) => ({
      id: item.id, action: item.action_name, status: item.status, requestedAt: item.requested_at,
      decidedAt: item.decided_at, decisionActorPresent: Boolean(item.decided_by)
    })),
    knowledge: citations.map((item) => ({
      sourceId: item.source_id, sourceName: item.source_name, ordinal: item.ordinal,
      score: item.score, provenance: item.provenance
    })),
    tools: toolInvocations.map((item) => ({
      id: item.id, name: item.tool_name, version: item.tool_version, status: item.status,
      executionMode: item.execution_mode, accessMode: item.access_mode, riskLevel: item.risk_level,
      adapterKind: item.adapter_kind, errorPresent: Boolean(item.error)
    })),
    actions: toolActions.map((item) => ({
      id: item.id, toolName: item.tool_name, status: item.status, attempts: item.attempt_count,
      providerResourcePresent: Boolean(item.provider_resource_id), errorPresent: Boolean(item.last_error),
      completedAt: item.completed_at
    })),
    audit: audit.map((item) => ({
      eventType: item.event_type, targetType: item.target_type, targetId: item.target_id, createdAt: item.created_at
    })),
    exclusions: [
      "tenant identifiers", "member identities", "input and output content", "error text",
      "tool inputs and outputs", "approval descriptions and notes", "knowledge excerpts",
      "durable actor identity keys", "credentials and tokens"
    ]
  };
}

function executionProfileLabel(profile: string) {
  if (profile === "instant") return "Instant agent selected";
  if (profile === "workflow") return "Durable Workflow selected";
  return "Durable actor selected";
}
function memoryDetail(profile: string, instanceKey: string | null) {
  if (profile === "instant") return "The request ran without sticky conversational memory.";
  if (profile === "workflow") return "Cloudflare Workflow checkpoints owned multi-step durability; the Worker did not stay running.";
  return instanceKey ? `State was isolated to this ${profile.replaceAll("_", " ")} identity.`
    : "The durable profile was recorded, but no actor affinity key is present in this evidence.";
}
function autonomyTitle(disposition: string) {
  return ({
    observed: "Observe mode stopped before inference", shadowed: "Shadow proposal only", recommended: "Suggestion only",
    waiting_approval: "Human approval required", guarded_safe: "Guarded policy allowed completion",
    autonomous: "Published policy allowed autonomous completion", approved: "Human approval recorded",
    rejected: "Human rejection recorded"
  } as Record<string, string>)[disposition] ?? `Autonomy policy: ${disposition.replaceAll("_", " ")}`;
}
function autonomyDetail(disposition: string, approvals: ApprovalRow[]) {
  if (disposition === "waiting_approval") return `${approvals.filter((item) => item.status === "pending").length} exact proposal(s) remain unexecuted in the Work Inbox.`;
  if (disposition === "rejected") return "The proposed outcome was declined and is not treated as an external action.";
  if (disposition === "observed") return "The input was recorded for observation with no model tokens consumed.";
  if (disposition === "shadowed") return "The model proposal was retained for comparison only; it authorized no action and did not enter accepted assistant memory.";
  if (disposition === "recommended") return "The result is guidance; no external action was authorized.";
  return "The effective autonomy disposition was snapshotted from the published runtime policy.";
}
function outcomeTitle(status: string) {
  return ({
    completed: "This run completed", failed: "This run failed safely",
    waiting_approval: "This run is waiting for a person", queued: "This run is queued",
    running: "This run is still operating", blocked: "This run was blocked safely",
    deferred: "This run was deferred by an operating control"
  } as Record<string, string>)[status] ?? `This run is ${status.replaceAll("_", " ")}`;
}
function outcomeSummary(execution: ExecutionRow, approvals: ApprovalRow[], actions: ToolActionRow[]) {
  if (execution.status === "waiting_approval") {
    return `${approvals.filter((item) => item.status === "pending").length || 1} bounded proposal(s) require a human decision before consequential work can continue.`;
  }
  if (execution.status === "failed") return "Workrr preserved the failure evidence and does not infer that unfinished work succeeded.";
  if (execution.status === "completed" && actions.length) {
    return `The AI run completed; ${actions.filter((item) => item.status === "completed").length} of ${actions.length} separately approved external action(s) show provider completion.`;
  }
  if (execution.status === "completed") return "The AI run reached its terminal result within the published release and control boundary.";
  return "The current status is non-terminal; review the timeline before taking another action.";
}
function externalImpact(invocations: ToolInvocationRow[], actions: ToolActionRow[]) {
  if (actions.some((item) => item.status === "completed")) return "Provider completion evidence exists for a separately approved action.";
  if (actions.length) return "An approved action exists, but provider completion is not yet proven.";
  if (invocations.some((item) => item.status === "proposed")) return "A tool action was proposed, not executed.";
  if (invocations.some((item) => item.status === "simulated")) return "Tool behavior was simulated; no external system was contacted.";
  return "No external action evidence is attached to this execution.";
}
function nextAction(execution: ExecutionRow, approvals: ApprovalRow[], invocations: ToolInvocationRow[], actions: ToolActionRow[]) {
  if (execution.autonomy_disposition === "shadowed") {
    return "Record the actual human outcome and compare it with this proposal before considering a higher autonomy level.";
  }
  if (execution.output_contract_status === "failed" || execution.input_contract_status === "failed") {
    return "Compare the payload shape with the published process contract, correct the boundary, and run the release evaluation before replay.";
  }
  if (execution.status === "waiting_approval" || approvals.some((item) => item.status === "pending")) {
    return "Open the Work Inbox, inspect the exact proposal and evidence, then approve, reject, request information, or escalate.";
  }
  if (actions.some((item) => item.status === "failed")) {
    return "Inspect the approved-action error and retry only after the provider condition is corrected; Workrr will reuse the original idempotency identity.";
  }
  if (invocations.some((item) => item.status === "failed")) {
    return "Inspect the failed tool evidence and connection readiness before replaying the execution.";
  }
  if (execution.status === "blocked") {
    return "Inspect the contract, data-protection, and admission-control evidence; change the blocked condition before replaying.";
  }
  if (execution.status === "deferred") {
    return "Review the operating-control reason and retry only when its concurrency, budget, or timing boundary allows the work.";
  }
  if (execution.status === "failed") return "Inspect the terminal timeline, correct the recorded failure condition, then use Replay safely.";
  if (["queued", "running"].includes(execution.status)) return "Wait for the terminal event; do not start a duplicate run.";
  return "No corrective action is required. Use this evidence when reviewing value, quality, or a future release.";
}
