import { describe, expect, it } from "vitest";
import { listApprovalWorkload } from "../src/approval-workload";

describe("approval workload", () => {
  it("loads bounded tenant-scoped reviewer capacity against the effective delegate", async () => {
    let sql = "";
    let bindings: unknown[] = [];
    const expected = [{
      id: "owner-1", email: "owner@example.com", display_name: "Owner", role: "owner",
      effective_id: "reviewer-1", effective_email: "reviewer@example.com",
      effective_display_name: "Reviewer", effective_role: "reviewer", delegated: 1,
      pending_count: 3, overdue_count: 1, due_soon_count: 1, oldest_minutes: 180,
    }];
    const env = {
      DB: {
        prepare(value: string) {
          sql = value;
          return {
            bind(...values: unknown[]) {
              bindings = values;
              return this;
            },
            async all() { return { results: expected }; },
          };
        },
      },
    } as never;

    await expect(listApprovalWorkload(env, "tenant-1")).resolves.toEqual(expected);
    expect(bindings).toEqual(["tenant-1", "tenant-1"]);
    expect(sql).toContain("a.tenant_id=? AND a.status='pending'");
    expect(sql).toContain("lower(a.assigned_to)=lower(e.effective_email)");
    expect(sql).toContain("LIMIT 50");
  });
});

