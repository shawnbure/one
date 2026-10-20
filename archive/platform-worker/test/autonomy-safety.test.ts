import { describe, expect, it } from "vitest";
import { applyAutonomySafetyCap, cappedAutonomy, evaluateAllAutonomySafety } from "../src/autonomy-safety";

describe("automatic autonomy safety fallback", () => {
  it("never allows a cap to increase published autonomy", () => {
    expect(cappedAutonomy("autonomous", "approve")).toBe("approve");
    expect(cappedAutonomy("suggest", "approve")).toBe("suggest");
    expect(cappedAutonomy("observe", "suggest")).toBe("observe");
    expect(cappedAutonomy("guarded", null)).toBe("guarded");
  });

  it("latches unsafe evidence once and does not weaken an existing stricter cap", async () => {
    const writes: Array<{ sql: string; values: unknown[] }> = [];
    const state = {
      id: "process-1", tenant_id: "tenant-1", name: "Customer response", autonomy: "autonomous",
      fallback_enabled: 1, fallback_min_terminal_runs: 5, fallback_success_threshold: 70,
      fallback_window_hours: 24, safety_autonomy_cap: null as string | null,
      safety_cap_reason: null, safety_cap_trigger: null, safety_cap_evidence_id: null,
      safety_cap_triggered_at: null, safety_cap_cleared_at: null, safety_cap_revision: 0,
    };
    const DB = {
      prepare(sql: string) {
        let values: unknown[] = [];
        const statement = {
          bind(...input: unknown[]) { values = input; return statement; },
          async first() { return sql.includes("FROM agent_blueprints") ? { ...state } : null; },
          async all() { return { results: [] }; },
          async run() {
            writes.push({ sql, values });
            if (sql.includes("SET safety_autonomy_cap")) {
              state.safety_autonomy_cap = String(values[0]);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    };
    const env = { DB, PROCESS_QUEUE: { async send() {} } };
    expect(await applyAutonomySafetyCap(env as never, "tenant-1", "process-1", "suggest",
      "unsafe_shadow", "shadow-1", "Unsafe shadow proposal.")).toBe(true);
    expect(state.safety_autonomy_cap).toBe("suggest");
    expect(writes.some(({ sql }) => sql.includes("autonomy.safety_fallback_applied"))).toBe(false);
    const auditWrite = writes.find(({ sql }) => sql.includes("INSERT INTO audit_events"));
    expect(auditWrite?.values).toContain("autonomy.safety_fallback_applied");

    expect(await applyAutonomySafetyCap(env as never, "tenant-1", "process-1", "approve",
      "reliability", "window-1", "Reliability below threshold.")).toBe(false);
    expect(state.safety_autonomy_cap).toBe("suggest");
  });

  it("caps guarded and autonomous processes at approval after bounded reliability failure", async () => {
    const updates: unknown[][] = [];
    const process = {
      id: "process-1", tenant_id: "tenant-1", name: "Reconciliation", autonomy: "guarded",
      fallback_enabled: 1, fallback_min_terminal_runs: 5, fallback_success_threshold: 70,
      fallback_window_hours: 24, safety_autonomy_cap: null, safety_cap_reason: null,
      safety_cap_trigger: null, safety_cap_evidence_id: null, safety_cap_triggered_at: null,
      safety_cap_cleared_at: null, safety_cap_revision: 0,
    };
    const DB = {
      prepare(sql: string) {
        let values: unknown[] = [];
        const statement = {
          bind(...input: unknown[]) { values = input; return statement; },
          async all() {
            if (sql.includes("status IN ('testing','active')")) return { results: [process] };
            if (sql.includes("notification_policies")) return { results: [] };
            return { results: [] };
          },
          async first() {
            if (sql.includes("COUNT(*) terminal_runs")) return { terminal_runs: 5, completed_runs: 2 };
            if (sql.includes("FROM agent_blueprints")) return { ...process };
            return null;
          },
          async run() {
            if (sql.includes("SET safety_autonomy_cap")) updates.push(values);
            return { meta: { changes: 1 } };
          },
        };
        return statement;
      },
    };
    const result = await evaluateAllAutonomySafety({ DB, PROCESS_QUEUE: { async send() {} } } as never,
      new Date("2026-07-23T12:00:00Z"));
    expect(result).toEqual({ evaluated: 1, applied: 1 });
    expect(updates[0]?.slice(0, 4)).toEqual(["approve",
      "2 of 5 terminal runs completed in the configured window (40.0%).",
      "reliability",
      expect.stringContaining(":5")]);
  });
});
