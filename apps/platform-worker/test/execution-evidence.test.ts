import { describe, expect, it } from "vitest";
import { explainExecution, exportRedactedExecutionEvidence, type ExecutionEvidence } from "../src/execution-evidence";

function evidence(overrides: Partial<ExecutionEvidence["execution"]> = {}): ExecutionEvidence {
  return {
    execution: {
      id: "execution-1", tenant_id: "secret-tenant", blueprint_id: "process-1",
      blueprint_name: "Customer Operations", execution_profile: "conversation",
      instance_key: "process-1:thread:sensitive-customer", status: "waiting_approval",
      model: "@cf/model", prompt_release_id: "prompt-v3", process_release_id: "release-v3",
      autonomy: "approve", autonomy_level: "approve", autonomy_disposition: "waiting_approval",
      input_contract_status: "passed", output_contract_status: "pending", contract_error: null,
      input_tokens: 120, output_tokens: 30, total_tokens: 150,
      started_at: "2026-07-23T10:00:00Z", completed_at: null, error: null,
      input_preview: "customer private input", output_preview: "customer private output",
      ...overrides
    },
    approvals: [{
      id: "approval-1", action_name: "send_message", status: "pending", title: "Sensitive approval title",
      requested_at: "2026-07-23T10:00:02Z", decided_at: null, decided_by: null,
      description: "private approval description", decision_note: "private decision note"
    }],
    audit: [{
      actor_id: "private-person-id", event_type: "approval.requested", target_type: "approval",
      target_id: "approval-1", detail_json: "{\"private\":\"audit detail\"}", created_at: "2026-07-23T10:00:02Z"
    }],
    citations: [{
      source_id: "source-1", source_name: "Approved handbook", chunk_id: "chunk-private", ordinal: 0,
      score: 0.91, provenance: "Employee handbook / policy", excerpt: "private knowledge excerpt",
      created_at: "2026-07-23T10:00:01Z"
    }],
    toolInvocations: [{
      id: "tool-1", tool_name: "send_message", tool_version: 2, status: "proposed",
      execution_mode: "proposal_only", access_mode: "write", risk_level: "high",
      adapter_kind: "microsoft", input_json: "{\"secret\":\"SENSITIVE_TOOL_INPUT_921\"}",
      output_json: "{\"secret\":\"SENSITIVE_TOOL_OUTPUT_384\"}",
      error: null, started_at: "2026-07-23T10:00:02Z", completed_at: "2026-07-23T10:00:03Z"
    }],
    toolActions: []
  };
}

describe("deterministic execution explanation", () => {
  it("explains durable affinity, approval state, proposals, impact, and a safe next action", () => {
    const result = explainExecution(evidence());
    expect(result).toMatchObject({
      title: "This run is waiting for a person",
      evidenceCompleteness: "complete",
      generatedBy: "deterministic_evidence_rules",
      externalImpact: "A tool action was proposed, not executed."
    });
    expect(result.reasons.map((item) => item.label)).toEqual(expect.arrayContaining([
      "Durable actor selected", "Immutable release selected", "Input contract passed",
      "Governed knowledge contributed", "Human approval required", "1 governed tool call evaluated"
    ]));
    expect(result.nextAction).toContain("Work Inbox");
  });

  it("prioritizes a failed contract boundary over a generic replay recommendation", () => {
    const result = explainExecution(evidence({
      status: "failed", autonomy_disposition: "recommended", input_contract_status: "passed",
      output_contract_status: "failed", contract_error: "private schema mismatch", error: "private failure"
    }));
    expect(result.title).toBe("This run failed safely");
    expect(result.nextAction).toContain("published process contract");
    expect(result.reasons.find((item) => item.label === "Output contract failed")?.state).toBe("attention");
  });

  it("gives a safe, specific recovery path when an operating boundary blocks a run", () => {
    const blockedEvidence = evidence({
      status: "blocked", autonomy_disposition: "recommended",
      input_contract_status: "passed", output_contract_status: "pending"
    });
    blockedEvidence.approvals = [];
    const result = explainExecution(blockedEvidence);
    expect(result.title).toBe("This run was blocked safely");
    expect(result.nextAction).toContain("data-protection");
    expect(result.nextAction).toContain("before replaying");
  });
});

describe("redacted execution evidence export", () => {
  it("preserves control evidence without payloads, identities, excerpts, actor keys, or error text", () => {
    const exported = exportRedactedExecutionEvidence(evidence({
      error: "private terminal error", contract_error: "private contract error"
    }));
    const serialized = JSON.stringify(exported);
    for (const secret of [
      "secret-tenant", "sensitive-customer", "customer private input", "customer private output",
      "private terminal error", "private contract error", "private approval description",
      "private decision note", "private-person-id", "audit detail", "private knowledge excerpt",
      "SENSITIVE_TOOL_INPUT_921", "SENSITIVE_TOOL_OUTPUT_384", "chunk-private"
    ]) expect(serialized).not.toContain(secret);
    expect(exported).toMatchObject({
      schemaVersion: 1, exportType: "workrr-redacted-execution-evidence",
      execution: { id: "execution-1", processId: "process-1", errorPresent: true }
    });
    expect(exported.approvals[0]).toMatchObject({ id: "approval-1", action: "send_message", status: "pending" });
    expect(exported.tools[0]).toMatchObject({ name: "send_message", status: "proposed", riskLevel: "high" });
    expect(exported.exclusions).toContain("input and output content");
  });
});
