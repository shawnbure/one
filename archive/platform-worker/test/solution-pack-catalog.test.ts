import { describe, expect, it } from "vitest";
import { listSolutionPacks, resolveSolutionPack, resolveSolutionPackHandoffChecks } from "../src/solution-pack-catalog";

describe("code-owned solution pack catalog", () => {
  it("exposes safe install metadata without prompt or credential content", () => {
    const catalog = listSolutionPacks();
    expect(catalog).toHaveLength(2);
    expect(catalog.map((item) => item.id)).toEqual([
      "customer-operations",
      "scheduled-reconciliation"
    ]);
    for (const item of catalog) {
      expect(item.installBehavior).toEqual({
        status: "draft",
        operatingMode: "paused",
        credentialsImported: false,
        schedulesEnabled: false,
        publicationGranted: false
      });
      expect(item.process.acceptanceCaseCount).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(item)).not.toContain("systemPrompt");
      expect(JSON.stringify(item)).not.toMatch(/password|apiKey|clientSecret|connectionId/i);
    }
  });

  it("resolves only an exact code-owned id and version", () => {
    const process = resolveSolutionPack("customer-operations", "1.0.0");
    expect(process.process.executionProfile).toBe("conversation");
    expect(process.secrets).toBe("excluded");
    expect(() => resolveSolutionPack("customer-operations", "9.0.0")).toThrow("not found");
    expect(() => resolveSolutionPack("../customer-operations", "1.0.0")).toThrow("not found");
  });

  it("returns an isolated process copy", () => {
    const first = resolveSolutionPack("scheduled-reconciliation", "1.0.0");
    first.process.name = "Mutated";
    expect(resolveSolutionPack("scheduled-reconciliation", "1.0.0").process.name).not.toBe("Mutated");
    const checks = resolveSolutionPackHandoffChecks("scheduled-reconciliation", "1.0.0");
    expect(checks.length).toBeGreaterThanOrEqual(3);
    checks[0]!.description = "Mutated";
    expect(resolveSolutionPackHandoffChecks("scheduled-reconciliation", "1.0.0")[0]?.description).not.toBe("Mutated");
  });
});
