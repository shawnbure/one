import { describe, expect, it } from "vitest";
import { disposeProcess, enqueueDueProcessDisposals, requestProcessRetirement,
  transitionProcessRetirement } from "../src/retirement";

type Write = { sql: string; bindings: unknown[] };

function environment(options?: { retirement?: Record<string, unknown>; due?: Array<Record<string, unknown>>;
  instances?: Array<{ instance_key: string }> }) {
  const writes: Write[] = [];
  const jobs: unknown[] = [];
  const workflows: unknown[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("SELECT id, name FROM agent_blueprints")) return { id: "process-1", name: "Invoice Review" };
          if (sql.includes("SELECT id FROM process_retirements")) return null;
          if (sql.includes("SELECT r.*, b.name")) return options?.retirement ?? {
            id: "retirement-1", tenant_id: "tenant-1", blueprint_id: "process-1",
            process_name: "Invoice Review", status: "requested", requested_by: "builder-1", legal_hold: 0
          };
          if (sql.includes("SELECT * FROM process_retirements")) return options?.retirement ?? {
            id: "retirement-1", tenant_id: "tenant-1", blueprint_id: "process-1",
            status: "disposing", legal_hold: 0, delete_execution_payloads: 1,
            delete_approval_content: 1, delete_prompt_content: 0
          };
          return null;
        },
        async all() {
          if (sql.includes("SELECT id, tenant_id FROM process_retirements")) return { results: options?.due ?? [] };
          if (sql.includes("SELECT DISTINCT instance_key")) return { results: options?.instances ?? [] };
          return { results: [] };
        },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  return { env: {
    DB,
    PROCESS_QUEUE: { async send(job: unknown) { jobs.push(job); } },
    PROCESS_DISPOSAL_WORKFLOW: { async create(input: unknown) { workflows.push(input); } }
  } as never, writes, jobs, workflows };
}

describe("governed process retirement", () => {
  it("requires exact process confirmation and immediately closes every ingestion path", async () => {
    const invalid = environment();
    await expect(requestProcessRetirement(invalid.env, "tenant-1", "builder-1", "process-1", {
      reason: "The manual process was replaced by the approved ERP workflow.",
      confirmName: "Wrong name"
    })).rejects.toThrow("exact process name");
    expect(invalid.writes).toHaveLength(0);

    const valid = environment();
    await expect(requestProcessRetirement(valid.env, "tenant-1", "builder-1", "process-1", {
      reason: "The manual process was replaced by the approved ERP workflow.",
      confirmName: "Invoice Review", deleteExecutionPayloads: true, deleteApprovalContent: true,
      deletePromptContent: false
    })).resolves.toMatchObject({ status: "requested", processPaused: true });
    expect(valid.writes.some(({ sql }) => sql.includes("status='paused', operating_mode='paused'"))).toBe(true);
    expect(valid.writes.some(({ sql }) => sql.includes("UPDATE process_schedules SET status='paused'"))).toBe(true);
    expect(valid.writes.some(({ sql }) => sql.includes("UPDATE webhook_endpoints SET status='disabled'"))).toBe(true);
    expect(JSON.stringify(valid.writes)).toContain("process.retirement_requested");
  });

  it("enforces a different approver, legal hold, exact confirmation, and cooling period", async () => {
    const self = environment();
    await expect(transitionProcessRetirement(self.env, "tenant-1", "builder-1", "retirement-1", {
      action: "approve", confirmation: "Invoice Review",
      scheduledFor: new Date(Date.now() + 48 * 60 * 60_000).toISOString()
    })).rejects.toThrow("different administrator");

    const held = environment({ retirement: {
      id: "retirement-1", blueprint_id: "process-1", process_name: "Invoice Review",
      status: "requested", requested_by: "builder-1", legal_hold: 1
    } });
    await expect(transitionProcessRetirement(held.env, "tenant-1", "owner-1", "retirement-1", {
      action: "approve", confirmation: "Invoice Review",
      scheduledFor: new Date(Date.now() + 48 * 60 * 60_000).toISOString()
    })).rejects.toThrow("legal hold");

    const valid = environment();
    await expect(transitionProcessRetirement(valid.env, "tenant-1", "owner-1", "retirement-1", {
      action: "approve", confirmation: "Invoice Review",
      scheduledFor: new Date(Date.now() + 48 * 60 * 60_000).toISOString()
    })).resolves.toMatchObject({ status: "approved" });
    expect(JSON.stringify(valid.writes)).toContain("process.retirement_approved");
  });

  it("claims due disposals once and retains metadata while redacting selected content", async () => {
    const queued = environment({ due: [{ id: "retirement-1", tenant_id: "tenant-1" }] });
    await expect(enqueueDueProcessDisposals(queued.env, new Date())).resolves.toEqual({ queued: 1 });
    expect(queued.jobs).toEqual([]);
    expect(queued.workflows).toEqual([expect.objectContaining({
      params: { tenantId: "tenant-1", retirementId: "retirement-1" }
    })]);

    const disposal = environment();
    await expect(disposeProcess(disposal.env, "tenant-1", "retirement-1"))
      .resolves.toMatchObject({ durableActors: 0, executionPayloads: true, auditRetained: true });
    expect(disposal.writes.some(({ sql }) => sql.includes("input_preview='[disposed]'"))).toBe(true);
    expect(disposal.writes.some(({ sql }) => sql.includes("action_input_json='{\"disposed\":true}'"))).toBe(true);
    expect(disposal.writes.some(({ sql }) => sql.includes("UPDATE audit_events"))).toBe(false);
    expect(JSON.stringify(disposal.writes)).toContain("process.disposed");
  });
});
