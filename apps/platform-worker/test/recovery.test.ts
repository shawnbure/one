import { describe, expect, it } from "vitest";
import { getRecoveryOperations, RecoveryConflict, updateRecoveryTask, validateRecoveryChange } from "../src/recovery";

type Write = { sql: string; bindings: unknown[] };

function environment(options: { changes?: number; completedProof?: boolean } = {}) {
  const writes: Write[] = [];
  const row = {
    id: "recovery-1", execution_id: "failed-1", blueprint_id: "process-1", process_name: "Customer Operations",
    execution_status: "failed", error: "Provider timeout", contract_error: null,
    input_contract_status: "passed", output_contract_status: "pending",
    assigned_to: "operator-1", assignee_name: "Operator", status: "open",
    due_at: "2026-07-22 00:00:00", revision: 2, resolution: null,
    resolution_execution_id: null, resolved_by_name: null, resolved_at: null,
    created_at: "2026-07-22 00:00:00", updated_at: "2026-07-22 00:00:00"
  };
  const DB = { prepare(sql: string) {
    let bindings: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) { bindings = values; return statement; },
      async all() {
        if (sql.includes("FROM execution_recovery_tasks r")) return { results: [row] };
        if (sql.includes("FROM tenant_members")) return {
          results: [{ id: "operator-1", display_name: "Operator", role: "operator" }]
        };
        return { results: [] };
      },
      async first() {
        if (sql.includes("SELECT r.*")) return {
          id: "recovery-1", execution_id: "failed-1", blueprint_id: "process-1",
          assigned_to: "operator-1", status: "open", revision: 2
        };
        if (sql.includes("FROM tenant_members")) return { id: "operator-1" };
        if (sql.includes("FROM executions WHERE")) return options.completedProof === false ? null : { id: "completed-2" };
        return null;
      },
      async run() {
        writes.push({ sql, bindings });
        return { meta: { changes: options.changes ?? 1 } };
      }
    };
    return statement;
  } };
  return { env: { DB } as never, writes };
}

describe("execution recovery operations", () => {
  it("derives an accountable overdue task and a concrete next action", async () => {
    const result = await getRecoveryOperations(environment().env, "tenant-1");
    expect(result.summary).toMatchObject({ open: 1, overdue: 1 });
    expect(result.tasks[0]).toMatchObject({
      category: "execution_failure", overdue: true, assignee_name: "Operator"
    });
    expect(result.tasks[0].nextAction).toContain("completed replay");
  });

  it("requires completed same-process proof before resolving", async () => {
    await expect(updateRecoveryTask(environment({ completedProof: false }).env,
      "tenant-1", "operator-1", "operator", "recovery-1", {
        action: "resolve", expectedRevision: 2, note: "The repaired flow passed verification.",
        resolutionExecutionId: "completed-2"
      })).rejects.toThrow("completed same-process");

    const valid = environment();
    const result = await updateRecoveryTask(valid.env, "tenant-1", "operator-1", "operator", "recovery-1", {
      action: "resolve", expectedRevision: 2, note: "The repaired flow passed verification.",
      resolutionExecutionId: "completed-2"
    });
    expect(result).toMatchObject({ status: "resolved", resolutionExecutionId: "completed-2", revision: 3 });
    expect(valid.writes[0].bindings).toContain("completed-2");
  });

  it("reserves risk acceptance for owners and detects stale writes", async () => {
    await expect(updateRecoveryTask(environment().env, "tenant-1", "operator-1", "operator", "recovery-1", {
      action: "accept_risk", expectedRevision: 2, note: "Risk is documented and time bounded."
    })).rejects.toThrow("administrator or owner");
    await expect(updateRecoveryTask(environment({ changes: 0 }).env, "tenant-1", "owner-1", "owner", "recovery-1", {
      action: "accept_risk", expectedRevision: 2, note: "Risk is documented and time bounded."
    })).rejects.toBeInstanceOf(RecoveryConflict);
  });

  it("validates ownership, evidence, and optimistic revision inputs", () => {
    expect(() => validateRecoveryChange({ action: "assign", expectedRevision: 1 }))
      .toThrow("owner is required");
    expect(() => validateRecoveryChange({ action: "investigate", expectedRevision: 1, note: "no" }))
      .toThrow("Recovery evidence");
    expect(() => validateRecoveryChange({ action: "resolve", expectedRevision: 1,
      note: "Repair verified" })).toThrow("verification execution");
  });
});
