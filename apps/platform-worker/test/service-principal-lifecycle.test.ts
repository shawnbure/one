import { describe, expect, it } from "vitest";
import { boundedCredentialExpiry, emitServicePrincipalExpiryAlerts } from "../src/service-principal-lifecycle";

function environment() {
  const alerts = new Set<string>();
  const writes: string[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async all() {
          if (sql.includes("FROM access_service_principals")) return { results: [{
            id: "principal-1", tenant_id: "tenant-1", display_name: "ERP automation",
            credential_expires_at: "2026-07-25T00:00:00.000Z", rotation_owner: "member-1"
          }] };
          if (sql.includes("FROM notification_policies")) return { results: [{
            id: "policy-1", channel: "in_app", severity: "critical"
          }] };
          return { results: [] };
        },
        async run() {
          writes.push(sql);
          if (sql.includes("service_principal_expiry_alerts")) {
            const key = bindings.join(":");
            if (alerts.has(key)) return { meta: { changes: 0 } };
            alerts.add(key);
          }
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
  return { env: { DB } as never, writes };
}

describe("service principal credential lifecycle", () => {
  it("accepts only future expiries within one year", () => {
    const now = new Date("2026-07-23T00:00:00.000Z");
    expect(boundedCredentialExpiry("2026-10-23T00:00:00.000Z", now)).toBe("2026-10-23T00:00:00.000Z");
    expect(() => boundedCredentialExpiry("2026-07-22T00:00:00.000Z", now)).toThrow("future");
    expect(() => boundedCredentialExpiry("2028-01-01T00:00:00.000Z", now)).toThrow("366 days");
  });

  it("emits one accountable warning for an exact principal expiry cycle", async () => {
    const { env, writes } = environment();
    const now = new Date("2026-07-23T00:00:00.000Z");
    expect(await emitServicePrincipalExpiryAlerts(env, now)).toEqual({ considered: 1, emitted: 1 });
    expect(await emitServicePrincipalExpiryAlerts(env, now)).toEqual({ considered: 1, emitted: 0 });
    expect(writes.some((sql) => sql.includes("INSERT OR IGNORE INTO notification_events"))).toBe(true);
  });
});
