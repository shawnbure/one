import { describe, expect, it, vi } from "vitest";

vi.mock("../src/execution", () => ({
  assertAsyncExecutionAdmission: vi.fn(async () => ({ deferred: false })),
  sanitizeAsyncExecutionInput: vi.fn(async (_env, _tenant, request) => request),
}));
import { dispatchDueSchedules, nextOccurrence } from "../src/schedules";

function environment(claimChanges = 1) {
  const sent: unknown[] = [];
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const due = {
    id: "schedule-1", tenant_id: "tenant-1", blueprint_id: "process-1", cadence: "daily",
    time_utc: "09:00", weekday_utc: null, input_text: "Review the inbox", identity_key: null,
    next_run_at: "2026-07-22T09:00:00.000Z", execution_profile: "instant",
  };
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async all() { return { results: sql.includes("FROM process_schedules s JOIN") ? [due] : [] }; },
        async run() {
          writes.push({ sql, bindings });
          return { meta: { changes: sql.includes("SET next_run_at") ? claimChanges : 1 } };
        },
      };
      return statement;
    },
    async batch(items: Array<{ run(): Promise<unknown> }>) {
      for (const item of items) await item.run();
      return [];
    },
  };
  return { env: { DB, PROCESS_QUEUE: { async send(job: unknown) { sent.push(job); } } } as never, sent, writes };
}

describe("recurring process schedules", () => {
  it("calculates bounded UTC recurrence without keeping compute alive", () => {
    expect(nextOccurrence("hourly", null, null, new Date("2026-07-22T09:15:00Z"))).toBe("2026-07-22T10:00:00.000Z");
    expect(nextOccurrence("daily", "09:00", null, new Date("2026-07-22T09:15:00Z"))).toBe("2026-07-23T09:00:00.000Z");
    expect(nextOccurrence("weekly", "09:00", 1, new Date("2026-07-22T09:15:00Z"))).toBe("2026-07-27T09:00:00.000Z");
  });

  it("atomically claims a due schedule before handing it to Queue", async () => {
    const { env, sent, writes } = environment();
    const result = await dispatchDueSchedules(env, new Date("2026-07-22T09:15:00Z"));
    expect(result).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ tenantId: "tenant-1", blueprintId: "process-1", input: "Review the inbox" });
    expect(writes.some((write) => write.sql.includes("INSERT OR IGNORE INTO schedule_dispatches"))).toBe(true);
  });

  it("does not duplicate dispatch when another Cron invocation won the claim", async () => {
    const { env, sent } = environment(0);
    expect(await dispatchDueSchedules(env, new Date("2026-07-22T09:15:00Z"))).toEqual([]);
    expect(sent).toHaveLength(0);
  });
});
