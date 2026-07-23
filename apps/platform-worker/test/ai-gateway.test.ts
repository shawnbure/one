import { describe, expect, it } from "vitest";
import { getAiGatewaySetting, requireAiGatewaySetting, updateAiGatewaySetting } from "../src/ai-gateway";

function environment(options: { enabled?: number; active?: number } = {}) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const setting = {
    gateway_id: "customer-ai", enabled: options.enabled ?? 0, collect_logs: 0,
    evidence_reference: null, updated_by: "system", updated_at: "2026-07-23"
  };
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) { bindings = values; return this; },
        async first() {
          if (sql.includes("COUNT(*) count")) return { count: options.active ?? 0 };
          if (sql.includes("FROM tenant_ai_gateway_settings")) return setting;
          return null;
        },
        async run() {
          writes.push({ sql, bindings });
          if (sql.includes("INSERT INTO tenant_ai_gateway_settings")) {
            setting.gateway_id = String(bindings[1]);
            setting.enabled = Number(bindings[2]);
            setting.collect_logs = Number(bindings[3]);
            setting.evidence_reference = bindings[4] as null;
          }
          return { meta: { changes: 1 } };
        }
      };
    }
  };
  return { env: { DB } as never, writes };
}

describe("tenant AI Gateway handoff", () => {
  it("is disabled by default and fails closed at runtime", async () => {
    const fixture = environment();
    await expect(getAiGatewaySetting(fixture.env, "tenant-1")).resolves.toMatchObject({
      gatewayId: "customer-ai", enabled: false
    });
    await expect(requireAiGatewaySetting(fixture.env, "tenant-1"))
      .rejects.toThrow("not enabled");
  });

  it("requires bounded gateway identity and attributable review evidence", async () => {
    const fixture = environment();
    await expect(updateAiGatewaySetting(fixture.env, "tenant-1", "owner-1", {
      gatewayId: "Customer Gateway", enabled: true, evidenceReference: "privacy-review-42"
    })).rejects.toThrow("Gateway ID");
    await expect(updateAiGatewaySetting(fixture.env, "tenant-1", "owner-1", {
      gatewayId: "customer-ai", enabled: true, evidenceReference: "short"
    })).rejects.toThrow("review evidence");
  });

  it("records a secret-free policy and refuses to strand active external releases", async () => {
    const fixture = environment();
    await expect(updateAiGatewaySetting(fixture.env, "tenant-1", "owner-1", {
      gatewayId: "customer-ai", enabled: true, collectLogs: true,
      evidenceReference: "privacy-and-billing-review-42"
    })).resolves.toMatchObject({ enabled: true, collectLogs: true });
    expect(fixture.writes[0]?.bindings).toEqual([
      "tenant-1", "customer-ai", 1, 1, "privacy-and-billing-review-42", "owner-1"
    ]);

    const active = environment({ enabled: 1, active: 2 });
    await expect(updateAiGatewaySetting(active.env, "tenant-1", "owner-1", { enabled: false }))
      .rejects.toThrow("active process release");
  });
});
