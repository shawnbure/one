import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/execution", () => ({ assertAsyncExecutionAdmission: vi.fn() }));
import { assertAsyncExecutionAdmission } from "../src/execution";
import { createWebhookEndpoint, listWebhookReceipts, setWebhookEndpointStatus,
  updateWebhookEndpoint } from "../src/webhook-operations";

type Write = { sql: string; bindings: unknown[] };

function environment(options?: { endpoint?: boolean; process?: boolean; secret?: boolean }) {
  const writes: Write[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("FROM agent_blueprints")) return options?.process === false ? null : { id: "process-1" };
          if (sql.includes("SELECT status FROM webhook_endpoints")) {
            return options?.endpoint === false ? null : { status: "disabled" };
          }
          if (sql.includes("SELECT id, blueprint_id, status")) {
            return options?.endpoint === false ? null :
              { id: "webhook-1", blueprint_id: "process-1", status: "disabled" };
          }
          if (sql.includes("SELECT id, name FROM webhook_endpoints")) {
            return options?.endpoint === false ? null : { id: "webhook-1", name: "Request intake" };
          }
          return null;
        },
        async all() {
          return { results: [{ id: "receipt-1", event_type: "request.created",
            execution_id: "execution-1", execution_status: "completed" }] };
        },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  return { env: { DB, WEBHOOK_INBOX_SECRET: options?.secret === false ? undefined : "secret" } as never, writes };
}

describe("webhook lifecycle operations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a disabled tenant-scoped endpoint with normalized allowlisted events", async () => {
    const state = environment();
    const result = await createWebhookEndpoint(state.env, "tenant-1", "builder-1", {
      name: " Request intake ", blueprintId: "process-1",
      acceptedEvents: ["request.created", "request.created", "request.updated"]
    });
    expect(result).toMatchObject({
      name: "Request intake", blueprintId: "process-1",
      acceptedEvents: ["request.created", "request.updated"], status: "disabled", secretConfigured: true
    });
    expect(state.writes.some((write) => write.sql.includes("INSERT INTO webhook_endpoints") &&
      write.bindings.includes("tenant-1"))).toBe(true);
    expect(JSON.stringify(state.writes)).toContain("webhook.created");
  });

  it("requires disabled configuration, same-tenant processes, and valid event names", async () => {
    const missingProcess = environment({ process: false });
    await expect(createWebhookEndpoint(missingProcess.env, "tenant-1", "builder-1", {
      name: "Request intake", blueprintId: "other-tenant-process", acceptedEvents: ["request.created"]
    })).rejects.toThrow("this tenant");
    const state = environment();
    await expect(updateWebhookEndpoint(state.env, "tenant-1", "builder-1", "webhook-1", {
      name: "Request intake", blueprintId: "process-1", acceptedEvents: ["INVALID EVENT"]
    })).rejects.toThrow("lowercase");
  });

  it("preflights execution admission before activation and never returns idempotency keys in receipts", async () => {
    const state = environment();
    await expect(setWebhookEndpointStatus(state.env, "tenant-1", "owner-1", "webhook-1", "active"))
      .resolves.toEqual({ updated: true, status: "active" });
    expect(assertAsyncExecutionAdmission).toHaveBeenCalledWith(state.env, "tenant-1", "process-1");
    const receiptData = await listWebhookReceipts(state.env, "tenant-1", "webhook-1");
    expect(receiptData.receipts[0]).not.toHaveProperty("idempotency_key");

    const noSecret = environment({ secret: false });
    await expect(setWebhookEndpointStatus(noSecret.env, "tenant-1", "owner-1", "webhook-1", "active"))
      .rejects.toThrow("WEBHOOK_INBOX_SECRET");
  });
});
