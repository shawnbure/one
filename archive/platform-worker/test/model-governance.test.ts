import { describe, expect, it } from "vitest";
import { assertTenantModelAllowed, updateTenantModelPolicy } from "../src/model-governance";

function environment(rows: {
  model?: unknown;
  policy?: unknown;
  active?: number;
  actors?: number;
  remaining?: number;
}) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  return {
    env: {
      DB: {
        prepare(sql: string) {
          let bindings: unknown[] = [];
          const statement = {
            bind(...values: unknown[]) { bindings = values; return statement; },
            async first() {
              if (sql.includes("LEFT JOIN tenant_model_policies")) return rows.policy ?? null;
              if (sql.includes("SELECT model_id FROM model_catalog")) return rows.model ?? null;
              if (sql.includes("FROM agent_blueprints")) return { count: rows.active ?? 0 };
              if (sql.includes("WITH latest_execution")) return { count: rows.actors ?? 0 };
              if (sql.includes("COUNT(*) count FROM tenant_model_policies")) return { count: rows.remaining ?? 1 };
              return null;
            },
            async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; },
          };
          return statement;
        },
      },
    },
    writes,
  };
}

describe("tenant Workers AI model policy", () => {
  it("allows only an explicitly enabled active catalog model", async () => {
    await expect(assertTenantModelAllowed(environment({ policy: { enabled: 1 } }).env as never,
      "tenant-1", "@cf/model")).resolves.toBeUndefined();
    await expect(assertTenantModelAllowed(environment({ policy: { enabled: 0 } }).env as never,
      "tenant-1", "@cf/model")).rejects.toThrow("not approved");
  });

  it("refuses to strand active releases or known durable actors", async () => {
    await expect(updateTenantModelPolicy(environment({
      model: { model_id: "@cf/model" }, active: 1, actors: 2,
    }).env as never, "tenant-1", "owner-1", "@cf/model", false))
      .rejects.toThrow("1 active process release(s) and 2 known durable actor(s)");
  });

  it("keeps at least one approved model and records valid changes", async () => {
    await expect(updateTenantModelPolicy(environment({
      model: { model_id: "@cf/model" }, remaining: 0,
    }).env as never, "tenant-1", "owner-1", "@cf/model", false))
      .rejects.toThrow("At least one");

    const fixture = environment({ model: { model_id: "@cf/model" } });
    await expect(updateTenantModelPolicy(fixture.env as never, "tenant-1", "owner-1",
      "@cf/model", true)).resolves.toEqual({ modelId: "@cf/model", enabled: true });
    expect(fixture.writes[0]?.bindings).toEqual(["tenant-1", "@cf/model", 1, "owner-1"]);
  });
});
