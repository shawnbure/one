import { describe, expect, it } from "vitest";
import { addApprovalMessage, assignApproval } from "../src/approval-collaboration";
import { decideApproval } from "../src/tool-actions";

type Write = { sql: string; bindings: unknown[] };

function environment(options?: { member?: Record<string, unknown> | null; approval?: Record<string, unknown> | null }) {
  const writes: Write[] = [];
  const member = options?.member === undefined
    ? { id: "member-2", email: "reviewer@example.com", display_name: "Reviewer", role: "reviewer" }
    : options.member;
  const approval = options?.approval === undefined
    ? { id: "approval-1", execution_id: "run-1", title: "Review action", status: "pending",
      review_state: "decision_pending", escalation_level: 0 }
    : options.approval;
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("FROM tenant_members")) return member;
          if (sql.includes("FROM approvals")) return approval;
          return null;
        },
        async all() { return { results: [] }; },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const statement of statements) await statement.run();
      return [];
    }
  };
  return { env: { DB } as never, writes };
}

describe("approval collaboration", () => {
  it("canonicalizes assignment to an active eligible tenant member", async () => {
    const { env, writes } = environment();
    const result = await assignApproval(env, "tenant-1", "actor-1", "approval-1", "member-2");
    expect(result).toEqual({ updated: true, assignedTo: "reviewer@example.com", displayName: "Reviewer" });
    expect(writes.some(({ sql, bindings }) =>
      sql.includes("UPDATE approvals SET assigned_to") && bindings.includes("reviewer@example.com"))).toBe(true);
    expect(JSON.stringify(writes)).toContain("assignedMemberId");
  });

  it("rejects arbitrary or cross-tenant assignees before changing the review item", async () => {
    const { env, writes } = environment({ member: null });
    await expect(assignApproval(env, "tenant-1", "actor-1", "approval-1", "outside@example.com"))
      .rejects.toThrow("active administrator");
    expect(writes).toHaveLength(0);
  });

  it("pauses a decision for requested information and records an attributable message", async () => {
    const { env, writes } = environment();
    const result = await addApprovalMessage(env, "tenant-1", "reviewer-1", "reviewer@example.com",
      "reviewer", "approval-1", "information_request", "Confirm the customer-approved time zone.");
    expect(result.reviewState).toBe("information_requested");
    expect(result.message).toMatchObject({
      author_email: "reviewer@example.com", kind: "information_request",
      body: "Confirm the customer-approved time zone."
    });
    expect(writes.some(({ sql, bindings }) =>
      sql.includes("UPDATE approvals SET review_state") && bindings.includes("information_requested"))).toBe(true);
  });

  it("requires an outstanding request before accepting an information response", async () => {
    const { env, writes } = environment();
    await expect(addApprovalMessage(env, "tenant-1", "operator-1", "operator@example.com",
      "operator", "approval-1", "information_response", "UTC is confirmed."))
      .rejects.toThrow("no outstanding information request");
    expect(writes).toHaveLength(0);
  });

  it("cannot approve while requested information remains unanswered", async () => {
    const { env, writes } = environment({ approval: {
      id: "approval-1", execution_id: "run-1", title: "Review action", status: "pending",
      review_state: "information_requested", escalation_level: 0
    } });
    await expect(decideApproval(env, "tenant-1", "reviewer-1", "approval-1", "approved", 1))
      .rejects.toThrow("must be answered");
    expect(writes).toHaveLength(0);
  });

  it("enforces role-specific collaboration actions", async () => {
    const { env } = environment();
    await expect(addApprovalMessage(env, "tenant-1", "builder-1", "builder@example.com",
      "builder", "approval-1", "information_request", "Need more data"))
      .rejects.toThrow("cannot submit");
    await expect(addApprovalMessage(env, "tenant-1", "viewer-1", "viewer@example.com",
      "viewer", "approval-1", "comment", "Attempted comment"))
      .rejects.toThrow("cannot submit");
  });

  it("caps escalation at level three", async () => {
    const { env } = environment({ approval: {
      id: "approval-1", execution_id: "run-1", title: "Review action", status: "pending",
      review_state: "escalated", escalation_level: 3
    } });
    const result = await addApprovalMessage(env, "tenant-1", "operator-1", "operator@example.com",
      "operator", "approval-1", "escalation", "SLA breached.");
    expect(result.reviewState).toBe("escalated");
    expect(result.escalationLevel).toBe(3);
  });
});
