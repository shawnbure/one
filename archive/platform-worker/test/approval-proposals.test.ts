import { describe, expect, it } from "vitest";
import { ApprovalProposalConflict, reviseApprovalProposal } from "../src/approval-proposals";

function environment(revision = 1, withTool = false) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const approval = {
    id: "approval-1", execution_id: "run-1", status: "pending", revision,
    output_preview: "Original proposal", tool_policy_json: withTool ? JSON.stringify([{
      id: "tool-1", name: "create_event", version: 1, adapterKind: "microsoft",
      handlerKey: "microsoft.calendar.event.create", accessMode: "write", riskLevel: "medium",
      connectionId: "connection-1", connectionReady: true, dataClassification: "internal",
      rateLimitPerMinute: 10, inputSchemaJson: JSON.stringify({
        type: "object", required: ["subject"], properties: { subject: { type: "string", minLength: 3 } },
        additionalProperties: false
      }), outputSchemaJson: "{\"type\":\"object\"}"
    }]) : "[]",
    process_release_id: "release-1", output_schema_json: null
  };
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() { return sql.includes("FROM approvals a JOIN executions") ? approval : null; },
        async all() {
          if (sql.includes("FROM dlp_rules")) return { results: [] };
          if (sql.includes("FROM tool_invocations")) return { results: withTool ? [{
            id: "invocation-1", tool_id: "tool-1", tool_name: "create_event", tool_version: 1,
            handler_key: "microsoft.calendar.event.create", access_mode: "write",
            risk_level: "medium", input_json: "{\"subject\":\"Old meeting\"}"
          }] : [] };
          return { results: [] };
        },
        async run() {
          writes.push({ sql, bindings });
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<{ meta: { changes: number } }> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  };
  return { env: { DB } as never, writes };
}

describe("approval proposal revisions", () => {
  it("DLP-protects a correction and records checksummed revision evidence without approving", async () => {
    const { env, writes } = environment();
    const result = await reviseApprovalProposal(env, "tenant-1", "reviewer-1", "approval-1", {
      expectedRevision: 1,
      proposedOutput: "Contact the owner at 602-555-0182.",
      reason: "Corrected the escalation contact."
    });
    expect(result).toMatchObject({ id: "approval-1", revision: 2, toolEdits: 0 });
    expect(writes.some(({ sql, bindings }) => sql.includes("UPDATE executions SET output_preview") &&
      bindings.includes("Contact the owner at [REDACTED_PHONE]."))).toBe(true);
    const audit = writes.find(({ sql }) => sql.includes("approval.proposal_edited"));
    expect(audit).toBeTruthy();
    expect(JSON.stringify(audit)).toContain("beforeChecksum");
    expect(JSON.stringify(audit)).not.toContain("Contact the owner");
    expect(writes.some(({ sql }) => sql.includes("SET status='approved'"))).toBe(false);
  });

  it("rejects a stale displayed revision before changing proposal evidence", async () => {
    const { env, writes } = environment(2);
    await expect(reviseApprovalProposal(env, "tenant-1", "reviewer-1", "approval-1", {
      expectedRevision: 1, proposedOutput: "Stale correction", reason: "Based on an old review."
    })).rejects.toBeInstanceOf(ApprovalProposalConflict);
    expect(writes).toHaveLength(0);
  });

  it("validates corrected tool input and replaces its provider idempotency identity", async () => {
    const { env, writes } = environment(1, true);
    await expect(reviseApprovalProposal(env, "tenant-1", "reviewer-1", "approval-1", {
      expectedRevision: 1,
      toolEdits: [{ invocationId: "invocation-1", input: { subject: "Correct meeting" } }],
      reason: "Corrected the approved calendar subject."
    })).resolves.toMatchObject({ revision: 2, toolEdits: 1 });
    const update = writes.find(({ sql }) => sql.includes("UPDATE tool_invocations SET input_json"));
    expect(update?.bindings[0]).toBe("{\"subject\":\"Correct meeting\"}");
    expect(String(update?.bindings[1])).toMatch(/^[a-f0-9]{64}$/);
    expect(String(update?.bindings[1])).not.toContain("Old meeting");
  });
});
