import { describe, expect, it } from "vitest";
import { acknowledgeNotification, escalateUnacknowledgedNotifications } from "../src/notification-response";
import { enqueueDueNotificationDeliveries, nextDeliveryTime } from "../src/notifications";

type Write = { sql: string; bindings: unknown[] };

function environment(options?: { event?: Record<string, unknown> | null; due?: Array<Record<string, unknown>>;
  claimChanges?: number }) {
  const writes: Write[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() { return options?.event === undefined
          ? { id: "event-1", acknowledged_at: null, channel: "in_app", acknowledgement_required: 1 }
          : options.event; },
        async all() { return { results: options?.due ?? [] }; },
        async run() {
          writes.push({ sql, bindings });
          const changes = sql.includes("SET escalated_at") ? (options?.claimChanges ?? 1) : 1;
          return { meta: { changes } };
        }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    }
  };
  return { env: { DB } as never, writes };
}

describe("notification human response", () => {
  it("acknowledges only in-app response tasks with attributable evidence", async () => {
    const { env, writes } = environment();
    const result = await acknowledgeNotification(env, "tenant-1", "operator-1", "event-1", "Recovery owner engaged.");
    expect(result).toMatchObject({ acknowledged: true, duplicate: false });
    expect(writes.some(({ sql, bindings }) => sql.includes("acknowledged_at") &&
      bindings.includes("operator-1") && bindings.includes("Recovery owner engaged."))).toBe(true);
    expect(JSON.stringify(writes)).toContain("notification.acknowledged");

    const external = environment({ event: {
      id: "event-2", acknowledged_at: null, channel: "webhook", acknowledgement_required: 0
    } });
    await expect(acknowledgeNotification(external.env, "tenant-1", "operator-1", "event-2"))
      .rejects.toThrow("not an acknowledgement task");
    expect(external.writes).toHaveLength(0);
  });

  it("claims overdue alerts once before emitting escalation evidence", async () => {
    const due = [{
      id: "event-1", tenant_id: "tenant-1", event_type: "execution.failed", title: "Execution failed",
      detail: "Failure", target_type: "execution", target_id: "run-1", owner_id: "owner-1",
      escalation_minutes: 60
    }];
    const claimed = environment({ due });
    await expect(escalateUnacknowledgedNotifications(claimed.env, new Date("2026-07-23T12:00:00Z")))
      .resolves.toEqual({ escalated: 1 });
    expect(claimed.writes.some(({ sql }) => sql.includes("INSERT INTO notification_events"))).toBe(true);
    expect(JSON.stringify(claimed.writes)).toContain("notification.escalated");

    const duplicate = environment({ due, claimChanges: 0 });
    await expect(escalateUnacknowledgedNotifications(duplicate.env, new Date("2026-07-23T12:00:00Z")))
      .resolves.toEqual({ escalated: 0 });
    expect(duplicate.writes.filter(({ sql }) => sql.includes("INSERT INTO notification_events"))).toHaveLength(0);
  });
});

describe("notification quiet hours", () => {
  it("defers noncritical delivery until the UTC quiet window ends and permits critical bypass", () => {
    const policy = { id: "policy-1", channel: "email", severity: "warning", quiet_hours_enabled: 1,
      quiet_start_hour_utc: 22, quiet_end_hour_utc: 7, critical_bypass: 1 };
    expect(nextDeliveryTime(policy, new Date("2026-07-23T23:34:00Z")).toISOString())
      .toBe("2026-07-24T07:00:00.000Z");
    expect(nextDeliveryTime({ ...policy, severity: "critical" }, new Date("2026-07-23T23:34:00Z")).toISOString())
      .toBe("2026-07-23T23:34:00.000Z");
    expect(nextDeliveryTime({ ...policy, quiet_hours_enabled: 0, digest_mode: "hourly", digest_hour_utc: 8 },
      new Date("2026-07-23T12:34:00Z")).toISOString()).toBe("2026-07-23T13:00:00.000Z");
    expect(nextDeliveryTime({ ...policy, quiet_hours_enabled: 0, digest_mode: "daily", digest_hour_utc: 8 },
      new Date("2026-07-23T12:34:00Z")).toISOString()).toBe("2026-07-24T08:00:00.000Z");
  });

  it("claims a due external delivery before queueing it", async () => {
    const sends: unknown[] = [];
    const DB = {
      prepare(sql: string) {
        const statement = {
          bind() { return statement; },
          async all() { return { results: [{ id: "event-1", tenant_id: "tenant-1", policy_id: "policy-1",
            title: "Failure", detail: "Reason", event_type: "execution.failed", severity: "critical",
            target_type: "execution", target_id: "run-1", channel: "email", digest_mode: "immediate" }] }; },
          async run() { return { meta: { changes: sql.includes("delivery_queued_at=?") ? 1 : 0 } }; }
        };
        return statement;
      }
    };
    const env = { DB, PROCESS_QUEUE: { async send(value: unknown) { sends.push(value); } } } as never;
    await expect(enqueueDueNotificationDeliveries(env, new Date("2026-07-23T12:00:00Z")))
      .resolves.toEqual({ queued: 1 });
    expect(sends).toEqual([{ kind: "notification_delivery", tenantId: "tenant-1",
      eventId: "event-1", channel: "email" }]);
  });

  it("combines due email events into one attributable digest delivery", async () => {
    const writes: Write[] = [];
    const sends: Array<Record<string, unknown>> = [];
    const rows = ["one", "two"].map((id) => ({ id, tenant_id: "tenant-1", policy_id: "policy-1",
      title: `Alert ${id}`, detail: `Detail ${id}`, event_type: "execution.failed", severity: "warning",
      target_type: "execution", target_id: id, channel: "email", digest_mode: "hourly" }));
    const DB = {
      prepare(sql: string) {
        let bindings: unknown[] = [];
        const statement = {
          bind(...values: unknown[]) { bindings = values; return statement; },
          async all() { return { results: rows }; },
          async run() {
            writes.push({ sql, bindings });
            return { meta: { changes: sql.includes("SET digest_batch_id=?") ? 2 : 1 } };
          }
        };
        return statement;
      },
      async batch(statements: Array<{ run(): Promise<unknown> }>) {
        return Promise.all(statements.map((statement) => statement.run()));
      }
    };
    const env = { DB, PROCESS_QUEUE: { async send(value: Record<string, unknown>) { sends.push(value); } } } as never;
    await expect(enqueueDueNotificationDeliveries(env, new Date("2026-07-23T12:00:00Z")))
      .resolves.toEqual({ queued: 1 });
    expect(writes.some(({ sql, bindings }) => sql.includes("'notification.digest'") &&
      bindings.includes("Workrr digest · 2 notifications"))).toBe(true);
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ kind: "notification_delivery", tenantId: "tenant-1",
      channel: "email" });
    expect(sends[0]?.digestBatchId).toBeTruthy();
  });
});
