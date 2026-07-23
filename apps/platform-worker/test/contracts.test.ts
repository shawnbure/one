import { describe, expect, it } from "vitest";
import { ContractViolationError, normalizeProcessSchema, outputContractInstruction,
  validateContractInput, validateContractOutput } from "../src/contracts";

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["requestId", "priority"],
  properties: {
    requestId: { type: "string", minLength: 1 },
    priority: { type: "string", enum: ["normal", "high"] }
  }
};

describe("process release contracts", () => {
  it("normalizes a bounded object schema and validates compact JSON input", () => {
    const normalized = normalizeProcessSchema(JSON.stringify(schema), "input");
    const result = validateContractInput('{\n "requestId": "req-1", "priority": "high"\n}', normalized);
    expect(result).toEqual({ value: '{"requestId":"req-1","priority":"high"}', status: "passed" });
  });

  it("rejects invalid input with bounded actionable issues", () => {
    expect(() => validateContractInput('{"requestId":"","priority":"urgent","extra":true}', schema))
      .toThrow(ContractViolationError);
    try { validateContractInput('{"requestId":"","priority":"urgent","extra":true}', schema); }
    catch (error) {
      expect(error).toBeInstanceOf(ContractViolationError);
      expect((error as ContractViolationError).direction).toBe("input");
      expect((error as ContractViolationError).issues.length).toBeLessThanOrEqual(8);
    }
  });

  it("accepts a fenced model JSON object but stores normalized JSON", () => {
    expect(validateContractOutput('```json\n{"requestId":"req-2","priority":"normal"}\n```', schema).value)
      .toBe('{"requestId":"req-2","priority":"normal"}');
  });

  it("rejects schemas that are not object-rooted or use recursive references", () => {
    expect(() => normalizeProcessSchema({ type: "array", items: { type: "string" } }, "input"))
      .toThrow("root type must be object");
    expect(() => normalizeProcessSchema({ type: "object", properties: { loop: { $ref: "#/$defs/self" } } }, "output"))
      .toThrow("cannot use");
  });

  it("adds the output contract as an explicit unambiguous model boundary", () => {
    const prompt = outputContractInstruction("Classify this request", schema);
    expect(prompt).toContain("Return only one JSON object");
    expect(prompt).toContain("--- OUTPUT CONTRACT ---");
    expect(prompt).toContain('"priority"');
  });
});
