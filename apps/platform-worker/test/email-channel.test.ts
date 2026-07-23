import { describe, expect, it } from "vitest";
import { createEmailRoute, emailExecutionRequest, listEmailReceipts,
  setEmailRouteStatus } from "../src/email-channel";

type Write = { sql: string; bindings: unknown[] };

function environment(options?: { profile?: string; processStatus?: string; route?: boolean }) {
  const writes: Write[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("SELECT execution_profile FROM agent_blueprints")) {
            return { execution_profile: options?.profile || "conversation" };
          }
          if (sql.includes("SELECT r.id, r.blueprint_id")) {
            return options?.route === false ? null : {
              id: "route-1", blueprint_id: "process-1",
              allowed_sender_domains_json: '["customer.com"]',
              execution_profile: options?.profile || "conversation",
              process_status: options?.processStatus || "active"
            };
          }
          if (sql.includes("SELECT id FROM inbound_email_routes")) {
            return options?.route === false ? null : { id: "route-1" };
          }
          return null;
        },
        async all() {
          return { results: [{ id: "receipt-1", execution_id: "execution-1",
            status: "accepted", attachment_count: 0, received_at: "2026-07-23T00:00:00Z" }] };
        },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  return { env: { DB } as never, writes };
}

describe("inbound email process channel", () => {
  it("creates a disabled tenant route with a bounded sender-domain allowlist", async () => {
    const state = environment();
    const result = await createEmailRoute(state.env, "tenant-1", "builder-1", {
      name: " Customer requests ", address: " Requests@Customer.example ",
      blueprintId: "process-1", allowedSenderDomains: ["Customer.com", "@partner.org", "customer.com"]
    });
    expect(result).toMatchObject({
      name: "Customer requests", address: "requests@customer.example", blueprintId: "process-1",
      allowedSenderDomains: ["customer.com", "partner.org"], status: "disabled"
    });
    expect(state.writes.some((write) => write.sql.includes("INSERT INTO inbound_email_routes") &&
      write.bindings.includes("tenant-1"))).toBe(true);
    expect(JSON.stringify(state.writes)).toContain("email_route.created");
  });

  it("refuses entity-sticky routes and activation without an active process", async () => {
    await expect(createEmailRoute(environment({ profile: "entity" }).env, "tenant-1", "builder-1", {
      name: "Entity intake", address: "entity@customer.example", blueprintId: "process-1",
      allowedSenderDomains: ["customer.com"]
    })).rejects.toThrow("entity resolver");
    await expect(setEmailRouteStatus(
      environment({ processStatus: "paused" }).env, "tenant-1", "owner-1", "route-1", "active"
    )).rejects.toThrow("activate the process");
  });

  it("derives sticky identities from trusted envelope/thread evidence without exposing sender addresses", async () => {
    const headers = new Headers({
      references: "<root-message@example.com> <later-message@example.com>",
      "message-id": "<new-message@example.com>"
    });
    const conversation = await emailExecutionRequest(
      "conversation", "process-1", "person@customer.com", headers, "message-hash",
      "Question", "Please review this request.", "email:route:message"
    );
    const sameThread = await emailExecutionRequest(
      "conversation", "process-1", "other@customer.com", headers, "another-hash",
      "Re: Question", "Follow-up.", "email:route:another"
    );
    const consumer = await emailExecutionRequest(
      "consumer", "process-1", "Person@Customer.com", new Headers(), "message-hash",
      "Question", "Please review.", "email:route:consumer"
    );
    expect(conversation.threadId).toBe(sameThread.threadId);
    expect(conversation.threadId).toMatch(/^email-[a-f0-9]{32}$/);
    expect(consumer.consumerId).toMatch(/^email-[a-f0-9]{32}$/);
    expect(JSON.stringify({ conversation, consumer })).not.toContain("person@customer.com");
  });

  it("returns metadata-only receipts with no sender, subject, or message identifiers", async () => {
    const result = await listEmailReceipts(environment().env, "tenant-1", "route-1");
    expect(result[0]).toMatchObject({ id: "receipt-1", status: "accepted" });
    expect(result[0]).not.toHaveProperty("sender_hash");
    expect(result[0]).not.toHaveProperty("message_id_hash");
    expect(result[0]).not.toHaveProperty("subject_checksum");
  });
});
