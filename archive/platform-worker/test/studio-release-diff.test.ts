import { describe, expect, it } from "vitest";
import { compareProcessRelease } from "../src/studio";

function environment(rows: Array<Record<string, unknown>>) {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async all() { calls.push({ sql, bindings }); return { results: rows }; }
      };
      return statement;
    }
  };
  return { env: { DB } as never, calls };
}

const active = {
  id: "release-active", version: 1, status: "published", checksum: "active-checksum",
  model_profile: "fast", model_id: "@cf/model-a", autonomy: "suggest",
  data_classification: "internal", system_prompt: "Prepare a grounded response.",
  instructions_json: JSON.stringify(["Use supplied facts"]),
  guardrails_json: JSON.stringify(["Do not invent"]),
  input_schema_json: null, output_schema_json: null,
  tool_policy_json: JSON.stringify([{ name: "lookup", access: "read", risk: "low", connectionReady: 1 }]),
  topology_json: JSON.stringify({ businessSteps: [{ id: "business-1", type: "step", label: "Review request" }] })
};

describe("process release comparison", () => {
  it("derives a bounded human review from same-tenant immutable release evidence", async () => {
    const target = {
      ...active, id: "release-draft", version: 2, status: "draft", checksum: "draft-checksum",
      model_profile: "balanced", model_id: "@cf/model-b", autonomy: "approve",
      system_prompt: "Prepare a grounded response and cite the source.",
      instructions_json: JSON.stringify(["Use supplied facts", "Escalate missing identifiers"]),
      tool_policy_json: JSON.stringify([
        { name: "lookup", access: "read", risk: "low", connectionReady: true },
        { name: "create_case", access: "write", risk: "medium" }
      ]),
      topology_json: JSON.stringify({ businessSteps: [
        { id: "business-1", type: "step", label: "Review request" },
        { id: "business-2", type: "checkpoint", label: "Owner approval" }
      ] })
    };
    const { env, calls } = environment([target, active]);
    const result = await compareProcessRelease(env, "tenant-a", "process-a", "release-draft");
    expect(result.from).toMatchObject({ id: "release-active", version: 1 });
    expect(result.to).toMatchObject({ id: "release-draft", version: 2 });
    expect(result.summary.changedSections).toBe(4);
    expect(result.sections.map((section) => section.key)).toEqual([
      "behavior", "model", "tools", "workflow"
    ]);
    expect(result.sections.find((section) => section.key === "tools")?.changes)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        kind: "added", label: "Tool: create case", before: null
      })]));
    expect(result.sections.find((section) => section.key === "tools")?.changes
      .some((change) => change.label === "Tool: lookup")).toBe(false);
    expect(calls[0]?.bindings).toEqual([
      "tenant-a", "process-a", "release-draft", "tenant-a", "process-a"
    ]);
    expect(calls[0]?.sql).toContain("r.tenant_id=? AND r.blueprint_id=?");
    expect(calls[0]?.sql).toContain("active_release_id");
  });

  it("fails closed when the target release is outside the scoped result", async () => {
    await expect(compareProcessRelease(environment([active]).env,
      "tenant-b", "process-a", "release-outside")).rejects.toThrow("Process release not found");
  });

  it("treats an unreleased process as an initial candidate without inventing a baseline", async () => {
    const target = { ...active, id: "release-first", status: "draft" };
    const result = await compareProcessRelease(environment([target]).env,
      "tenant-a", "process-a", "release-first");
    expect(result.from).toBeNull();
    expect(result.summary.additions).toBeGreaterThan(0);
    expect(result.sections.every((section) =>
      section.changes.every((change) => change.kind === "added"))).toBe(true);
  });
});
