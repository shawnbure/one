// @ts-expect-error Vitest executes in Node; the Worker package intentionally omits Node ambient types.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseStarterKit, validateStarterKit } from "../src/discovery";

const complete = {
  version: 1,
  topology: ["Trigger", "Agent", "Approval", "Outcome"],
  currentSteps: ["Read request", "Perform work"],
  futureSteps: ["Validate request", "Prepare governed result"],
  discoveryQuestions: ["Who owns this?", "What is the exception route?"],
  systems: ["System of record"],
  exceptions: ["Missing identity"],
  successMetrics: ["Cycle time"],
  privacy: { sensitivity: "confidential", conversationRetentionDays: 30 },
  schedule: null,
  adapterInstructions: ["Start with read-only access"],
  testCases: [
    { name: "Missing input", input: "No identifier", contains: ["missing"], prohibited: ["completed"] },
    { name: "Routine input", input: "Record R-1", contains: ["R-1"], prohibited: ["invented"] },
  ],
};

describe("implementation-ready process starter catalog", () => {
  it("contains all six aggressive MVP customer patterns", () => {
    const base = readFileSync(new URL("../migrations/0006_process_discovery.sql", import.meta.url), "utf8");
    const expansion = readFileSync(new URL("../migrations/0066_process_starter_kits.sql", import.meta.url), "utf8");
    for (const id of [
      "template-customer-ops", "template-document-intake", "template-knowledge-assistant",
      "template-lead-qualification", "template-approved-external-action",
      "template-scheduled-reconciliation",
    ]) expect(`${base}\n${expansion}`).toContain(`'${id}'`);
  });

  it("accepts a complete starter and rejects a visually plausible but unusable shell", () => {
    const parsed = parseStarterKit(JSON.stringify(complete));
    expect(() => validateStarterKit(parsed)).not.toThrow();
    const incomplete = parseStarterKit(JSON.stringify({
      version: 1, topology: ["Agent"], testCases: [{ name: "Only case", input: "hello" }],
    }));
    expect(() => validateStarterKit(incomplete)).toThrow("Process starter is incomplete");
  });

  it("normalizes privacy and schedule boundaries before snapshotting", () => {
    const parsed = parseStarterKit(JSON.stringify({
      ...complete,
      privacy: { sensitivity: "secret", conversationRetentionDays: 99_999 },
      schedule: { recommended: "daily", enabledByDefault: true },
    }));
    expect(parsed.privacy).toEqual({ sensitivity: "internal", conversationRetentionDays: 90 });
    expect(parsed.schedule).toEqual({ recommended: "daily", enabledByDefault: true });
  });
});
