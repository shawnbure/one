import { describe, expect, it } from "vitest";
import { validateProcessPackage } from "../src/process-package";

function packageData() {
  return {
    schemaVersion: 1,
    process: {
      name: "Customer request operations",
      description: "Prepare grounded customer responses for accountable review.",
      executionProfile: "conversation",
      modelProfile: "balanced",
      modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      autonomy: "approve",
      tools: ["customer_record_lookup"],
      toolDefinitions: [{
        name: "customer_record_lookup", version: 1, adapterKind: "http", handlerKey: null,
        accessMode: "read", riskLevel: "low", dataClassification: "confidential",
        rateLimitPerMinute: 30,
        inputSchemaJson: '{"type":"object"}', outputSchemaJson: '{"type":"object"}'
      }],
      businessOwner: "Customer Operations", department: "Operations",
      riskLevel: "medium", dataClassification: "confidential"
    },
    behavior: {
      systemPrompt: "Use approved customer facts and prepare a response for review.",
      instructions: ["Use verified facts"], guardrails: ["Never send a response"],
      acceptanceCases: [{
        name: "Missing identity", input: "No customer identifier was supplied.",
        contains: ["missing", "identifier"], prohibited: ["sent"], maxChars: 2000
      }]
    },
    secrets: "excluded"
  };
}

describe("portable process package", () => {
  it("retains bounded solution-pack acceptance evidence", () => {
    const result = validateProcessPackage(packageData());
    expect(result.behavior.acceptanceCases).toEqual([{
      name: "Missing identity", input: "No customer identifier was supplied.",
      contains: ["missing", "identifier"], prohibited: ["sent"], maxChars: 2000
    }]);
    expect(result.process.dataClassification).toBe("confidential");
    expect(result.secrets).toBe("excluded");
  });

  it("rejects malformed or evidence-free portable acceptance cases", () => {
    const empty = packageData();
    empty.behavior.acceptanceCases[0]!.contains = [];
    empty.behavior.acceptanceCases[0]!.prohibited = [];
    expect(() => validateProcessPackage(empty)).toThrow("acceptance case 1");
    const oversized = packageData();
    oversized.behavior.acceptanceCases[0]!.maxChars = 50_000;
    expect(() => validateProcessPackage(oversized)).toThrow("acceptance case 1");
  });
});
