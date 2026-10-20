import { describe, expect, it } from "vitest";
import { getBlueprint } from "../src/repository";

describe("MCP release readiness overlay", () => {
  it("revalidates a snapshotted MCP tool against its live tenant connector and capability", async () => {
    let query = "";
    const policy = {
      id: "mcp-tool-1", name: "tool_workrr_lookup", version: 1, adapterKind: "mcp",
      handlerKey: "mcp.mcp-1.tool_workrr_lookup", accessMode: "read", riskLevel: "low",
      connectionId: "mcp-1", connectionReady: true, dataClassification: "internal",
      rateLimitPerMinute: 30, inputSchemaJson: '{"type":"object"}',
      outputSchemaJson: '{"type":"object"}', description: "Lookup", owner: "Operations"
    };
    const DB = { prepare(sql: string) {
      query = sql;
      return {
        bind() { return this; },
        async first() {
          return {
            id: "process-1", tenant_id: "tenant-1", name: "Lookup", description: "Lookup",
            execution_profile: "instant", model_profile: "balanced", model_id: "@cf/model",
            prompt_release_id: "prompt-1", resolved_prompt_release_id: "prompt-1",
            resolved_release_id: "release-1", autonomy: "guarded", resolved_autonomy: "guarded",
            status: "active", tools_json: "[]", updated_at: "now", operating_mode: "active",
            tool_policy_json: JSON.stringify([policy])
          };
        }
      };
    } };
    const result = await getBlueprint({ DB } as never, "tenant-1", "process-1");
    expect(result?.toolPolicies[0]).toMatchObject({ adapterKind: "mcp", connectionReady: true });
    expect(query).toContain("FROM mcp_connectors mc");
    expect(query).toContain("mc.tenant_id=b.tenant_id");
    expect(query).toContain("mt.enabled=1 AND mt.available=1");
    expect(query).toContain("'mcp.' || mc.id || '.' || mt.ai_tool_name");
  });
});
