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

  it("allows guarded read-only work but reviews guarded tool-capable work", () => {
    expect(autonomyPlan({ ...process, autonomy: "guarded" })).toMatchObject({
      disposition: "guarded_safe", requiresApproval: false
    });
    expect(autonomyPlan({ ...process, autonomy: "guarded", tools: ["update_crm"] })).toMatchObject({
      disposition: "waiting_approval", requiresApproval: true
    });
  });
});
