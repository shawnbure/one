import { describe, expect, it } from "vitest";
import { autonomyPlan } from "../src/autonomy";

const process = {
  autonomy: "suggest" as const,
  operatingMode: "active" as const,
  tools: [] as string[]
};

describe("progressive autonomy policy", () => {
  it("keeps observe mode model-free", () => {
    expect(autonomyPlan({ ...process, autonomy: "observe" })).toMatchObject({
      effective: "observe", disposition: "observed", runModel: false, requiresApproval: false
    });
  });

  it("forces non-observe work through review in approval-only operating mode", () => {
    expect(autonomyPlan({ ...process, autonomy: "autonomous", operatingMode: "approval_only" })).toMatchObject({
      effective: "approve", disposition: "waiting_approval", requiresApproval: true
    });
  });

  it("caps autonomous work at recommendations in read-only operating mode", () => {
    expect(autonomyPlan({ ...process, autonomy: "autonomous", operatingMode: "read_only" })).toMatchObject({
      effective: "suggest", disposition: "recommended", requiresApproval: false
    });
  });

  it("enforces a latched safety cap before tool and operating-mode decisions", () => {
    const plan = autonomyPlan({
      ...process,
      autonomy: "suggest",
      configuredAutonomy: "autonomous",
      safetyAutonomyCap: "suggest",
      safetyCapReason: "A reviewer marked the evaluation unsafe."
    });
    expect(plan).toMatchObject({
      configured: "autonomous", effective: "suggest", disposition: "recommended",
      requiresApproval: false
    });
    expect(plan.explanation).toContain("Automatic safety fallback");
    expect(plan.explanation).toContain("unsafe");
  });

  it("runs a proposal without action authority or accepted memory in shadow mode", () => {
    expect(autonomyPlan({ ...process, autonomy: "autonomous", operatingMode: "shadow" })).toMatchObject({
      effective: "suggest", disposition: "shadowed", runModel: true,
      requiresApproval: false, shadowMode: true
    });
  });

  it("allows guarded read-only work but reviews guarded tool-capable work", () => {
    expect(autonomyPlan({ ...process, autonomy: "guarded" })).toMatchObject({
      disposition: "guarded_safe", requiresApproval: false
    });
    expect(autonomyPlan({ ...process, autonomy: "guarded", tools: ["update_crm"] })).toMatchObject({
      disposition: "waiting_approval", requiresApproval: true
    });
  });

  it("uses typed tool risk and readiness instead of trusting a name", () => {
    const baseTool = {
      id: "tool-1", name: "lookup_customer", version: 1, adapterKind: "http" as const,
      accessMode: "read" as const, riskLevel: "low" as const, connectionId: "connection-1",
      connectionReady: true, dataClassification: "internal" as const, rateLimitPerMinute: 60,
      inputSchemaJson: '{"type":"object"}', outputSchemaJson: '{"type":"object"}'
    };
    expect(autonomyPlan({ ...process, autonomy: "guarded", tools: ["lookup_customer"], toolPolicies: [baseTool] }))
      .toMatchObject({ disposition: "guarded_safe", requiresApproval: false });
    expect(autonomyPlan({ ...process, autonomy: "autonomous", tools: ["lookup_customer"],
      toolPolicies: [{ ...baseTool, connectionReady: false }] }))
      .toMatchObject({ disposition: "waiting_approval", requiresApproval: true });
  });
});
