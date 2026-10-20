import { describe, expect, it } from "vitest";
import { SolutionPackHandoffConflict, updateSolutionPackHandoffCheck } from "../src/solution-pack-handoff";

function environment(changes = 1, exists = true) {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  return {
    statements,
    env: {
      DB: {
        prepare(sql: string) {
          const record = { sql, bindings: [] as unknown[] };
          statements.push(record);
          const statement = {
            bind(...bindings: unknown[]) { record.bindings = bindings; return statement; },
            async run() { return { meta: { changes } }; },
            async first() { return exists ? { revision: 2 } : null; }
          };
          return statement;
        }
      }
    }
  };
}

describe("solution pack handoff evidence", () => {
  it("updates one exact tenant/process/check revision with attributable evidence", async () => {
    const { env, statements } = environment();
    const result = await updateSolutionPackHandoffCheck(env as never, "tenant-a", "process-a",
      "check-a", "member-a", {
        status: "complete", evidence: "Data owner approved read-only scope.", expectedRevision: 3
      });
    expect(result).toEqual({ id: "check-a", status: "complete", revision: 4 });
    expect(statements[0]?.bindings).toEqual([
      "complete", "Data owner approved read-only scope.", "member-a",
      expect.any(String), "check-a", "tenant-a", "process-a", 3
    ]);
  });

  it("requires substantive evidence and rejects stale revisions", async () => {
    const { env } = environment();
    await expect(updateSolutionPackHandoffCheck(env as never, "tenant-a", "process-a",
      "check-a", "member-a", {
        status: "complete", evidence: "done", expectedRevision: 1
      })).rejects.toThrow("10 to 1,000");
    const stale = environment(0, true);
    await expect(updateSolutionPackHandoffCheck(stale.env as never, "tenant-a", "process-a",
      "check-a", "member-a", {
        status: "not_applicable", evidence: "Customer confirmed this does not apply.", expectedRevision: 1
      })).rejects.toBeInstanceOf(SolutionPackHandoffConflict);
  });

  it("distinguishes a missing same-tenant check from a conflict", async () => {
    const missing = environment(0, false);
    await expect(updateSolutionPackHandoffCheck(missing.env as never, "tenant-a", "process-a",
      "check-a", "member-a", {
        status: "complete", evidence: "Approved by the accountable owner.", expectedRevision: 1
      })).rejects.toThrow("not found");
  });
});
