import { describe, expect, it } from "vitest";
import type { ToolPolicy } from "@workrr/contracts";
import { buildExecutionTools, toolExecutionMode } from "../src/tool-runtime";

const policy: ToolPolicy = {
  id: "tool-1",
  name: "lookup_customer",
  version: 1,
  adapterKind: "mock",
  accessMode: "read",
  riskLevel: "low",
  connectionId: null,
  connectionReady: true,
  dataClassification: "internal",
  rateLimitPerMinute: 60,
  inputSchemaJson: '{"type":"object"}',
  outputSchemaJson: '{"type":"object"}'
};

describe("governed tool runtime", () => {
  it("only simulates ready low-risk mock reads", () => {
    expect(toolExecutionMode(policy)).toBe("simulation");
    expect(toolExecutionMode({ ...policy, accessMode: "write" })).toBe("proposal_only");
    expect(toolExecutionMode({ ...policy, riskLevel: "medium" })).toBe("proposal_only");
    expect(toolExecutionMode({ ...policy, connectionReady: false })).toBe("proposal_only");
    expect(toolExecutionMode({ ...policy, adapterKind: "http", connectionId: "conn-1" })).toBe("proposal_only");
  });

  it("does not expose executable tools at advisory autonomy levels", () => {
    const env = {} as Parameters<typeof buildExecutionTools>[0];
    expect(buildExecutionTools(env).tools).toBeUndefined();
    expect(buildExecutionTools(env, {
      tenantId: "demo", executionId: "run-1", autonomy: "suggest", policies: [policy]
    }).tools).toBeUndefined();
  });

  it("bounds the exposed catalog", () => {
    const env = {} as Parameters<typeof buildExecutionTools>[0];
    const policies = Array.from({ length: 24 }, (_, index) => ({
      ...policy, id: `tool-${index}`, name: `lookup_${index}`
    }));
    const runtime = buildExecutionTools(env, {
      tenantId: "demo", executionId: "run-1", autonomy: "guarded", policies
    });
    expect(Object.keys(runtime.tools ?? {})).toHaveLength(20);
  });
});
