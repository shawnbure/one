import { describe, expect, it } from "vitest";
import { assertExternalModelAllowed, assertExternalToolAllowed,
  normalizeDataClassification, updateDataEgressPolicy } from "../src/data-governance";

function environment(policy: { external_model_allowed: number; external_tool_allowed: number } | null) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() { return policy; },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    }
  };
  return { env: { DB } as never, writes };
}

describe("tenant data egress governance", () => {
  it("fails closed independently for model and tool handoffs", async () => {
    const { env } = environment({ external_model_allowed: 0, external_tool_allowed: 1 });
    await expect(assertExternalModelAllowed(env, "tenant-1", "confidential"))
      .rejects.toThrow("confidential data is not approved");
    await expect(assertExternalToolAllowed(env, "tenant-1", "confidential")).resolves.toBeUndefined();
    await expect(assertExternalModelAllowed(environment(null).env, "tenant-1", "internal"))
      .rejects.toThrow("internal data is not approved");
  });

  it("rejects unknown classifications before a policy lookup", () => {
    expect(() => normalizeDataClassification("secret")).toThrow("valid process data classification");
  });

  it("updates exactly one tenant revision and emits metadata-only audit evidence", async () => {
    const { env, writes } = environment(null);
    const result = await updateDataEgressPolicy(env, "tenant-1", "owner-1", "confidential", {
      externalModelAllowed: false, externalToolAllowed: true, expectedRevision: 4
    });
    expect(result).toMatchObject({ classification: "confidential", revision: 5,
      externalModelAllowed: false, externalToolAllowed: true });
    expect(writes[0]?.sql).toContain("tenant_id=? AND classification=? AND revision=?");
    expect(writes[0]?.bindings.slice(-3)).toEqual(["tenant-1", "confidential", 4]);
    expect(writes[1]?.sql).toContain("data_egress.policy_updated");
  });
});
