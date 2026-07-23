import { describe, expect, it } from "vitest";
import { buildModelInventory } from "../src/governance";

const now = Date.parse("2026-07-23T12:00:00.000Z");

describe("Workers AI model readiness evidence", () => {
  it("groups exact models and uses the newest successful evidence", () => {
    const models = buildModelInventory([
      { model_profile: "balanced", model_id: "@cf/model-a",
        model_last_success_at: "2026-07-20T12:00:00.000Z" },
      { model_profile: "balanced", model_id: "@cf/model-a", evaluation_status: "passing",
        evaluated_at: "2026-07-22T12:00:00.000Z" }
    ], now);
    expect(models).toEqual([expect.objectContaining({
      modelId: "@cf/model-a", processes: 2, ready: true,
      lastVerifiedAt: "2026-07-22T12:00:00.000Z", evidence: "passing evaluation"
    })]);
  });

  it("expires evidence after thirty days and never treats legacy aliases as verified", () => {
    const models = buildModelInventory([
      { model_profile: "fast", model_id: "@cf/model-b",
        model_last_success_at: "2026-06-20T12:00:00.000Z" },
      { model_profile: "reasoning", model_id: null,
        model_last_success_at: "2026-07-22T12:00:00.000Z" }
    ], now);
    expect(models.map(({ ready }) => ready)).toEqual([false, false]);
  });
});
