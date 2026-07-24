import { describe, expect, it } from "vitest";
import { importProcessPackage, validateProcessPackage } from "../src/process-package";

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

  it("persists exact tenant-scoped provenance for a reviewed pack installation", async () => {
    const statements: Array<{ sql: string; bindings: unknown[] }> = [];
    const env = {
      DB: {
        prepare(sql: string) {
          const record = { sql, bindings: [] as unknown[] };
          statements.push(record);
          const statement = {
            bind(...bindings: unknown[]) { record.bindings = bindings; return statement; },
            async first() {
              if (sql.includes("SELECT p.enabled FROM model_catalog")) return { enabled: 1 };
              if (sql.includes("SELECT execution_profile, data_classification")) {
                return { execution_profile: "conversation", data_classification: "confidential" };
              }
              if (sql.includes("SELECT context_tokens FROM model_catalog")) return { context_tokens: 131_072 };
              if (sql.includes("SELECT COALESCE(MAX(version)")) return { version: 1 };
              return null;
            },
            async all() { return { results: [] }; },
            async run() { return { meta: { changes: 1 } }; }
          };
          return statement;
        },
        async batch() { return []; }
      }
    };
    const input = packageData() as ReturnType<typeof packageData> & {
      process: ReturnType<typeof packageData>["process"] & { toolDefinitions?: unknown[] };
    };
    input.process.tools = [];
    delete input.process.toolDefinitions;
    const result = await importProcessPackage(env as never, "tenant-a", "member-a", input, {
      packId: "customer-operations", packVersion: "1.0.0",
      handoffChecks: [{ description: "Connect the approved customer records source.", gate: "publication" }]
    });
    expect(result.status).toBe("draft");
    const provenance = statements.find((item) =>
      item.sql.includes("INSERT INTO process_solution_pack_provenance"));
    expect(provenance?.bindings.slice(1)).toEqual([
      "tenant-a", "customer-operations", "1.0.0", "member-a"
    ]);
    expect(statements.some((item) =>
      item.sql.includes("DELETE FROM process_solution_pack_provenance"))).toBe(false);
    const handoff = statements.find((item) =>
      item.sql.includes("INSERT INTO process_solution_pack_handoff_checks"));
    expect(handoff?.bindings.slice(1)).toEqual([
      "tenant-a", result.id, 1, "Connect the approved customer records source.", "publication"
    ]);
  });

  it("rejects malformed install provenance before creating a process", async () => {
    const statements: string[] = [];
    const env = { DB: { prepare(sql: string) { statements.push(sql); throw new Error("unexpected write"); } } };
    await expect(importProcessPackage(env as never, "tenant-a", "member-a", packageData(), {
      packId: "../unsafe", packVersion: "latest",
      handoffChecks: [{ description: "short", gate: "handoff" }]
    })).rejects.toThrow("installation provenance");
    expect(statements).toHaveLength(0);
  });
});
