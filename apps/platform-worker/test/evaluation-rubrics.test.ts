import { describe, expect, it } from "vitest";
import { createRubricTemplate, listRubricTemplates, updateRubricTemplate } from "../src/evaluation";

function rubricEnvironment(options: {
  count?: number;
  current?: { id: string; name: string; description: string; criteria_json: string; enabled: number } | null;
  templates?: Array<Record<string, unknown>>;
} = {}) {
  const writes: Array<{ sql: string; values: unknown[] }> = [];
  const reads: Array<{ sql: string; values: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let values: unknown[] = [];
      const statement = {
        bind(...next: unknown[]) { values = next; return statement; },
        async first() {
          reads.push({ sql, values });
          if (sql.includes("COUNT(*)")) return { count: options.count ?? 0 };
          if (sql.includes("FROM evaluation_rubric_templates")) return options.current ?? null;
          return null;
        },
        async all() {
          reads.push({ sql, values });
          return { results: options.templates ?? [] };
        },
        async run() {
          writes.push({ sql, values });
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    }
  };
  return { env: { DB } as never, writes, reads };
}

describe("tenant evaluation rubric templates", () => {
  it("creates a bounded reusable template with normalized criteria", async () => {
    const { env, writes } = rubricEnvironment();
    const result = await createRubricTemplate(env, "tenant-1", "builder-1", {
      name: "  Reliable handoff  ",
      description: "  Shared customer standard  ",
      criteria: [
        { criterion: " Includes the next owner ", dimension: "completeness", weight: 2.04 },
        { criterion: "Avoids unsupported claims", dimension: "safety", weight: 25 }
      ]
    });
    expect(result).toMatchObject({ name: "Reliable handoff", description: "Shared customer standard", enabled: 1 });
    expect(result.criteria).toEqual([
      { criterion: "Includes the next owner", dimension: "completeness", weight: 2 },
      { criterion: "Avoids unsupported claims", dimension: "safety", weight: 10 }
    ]);
    expect(writes[0]?.values).toEqual(expect.arrayContaining(["tenant-1", "builder-1", "Reliable handoff"]));
  });

  it("scopes reads and updates to the authenticated tenant", async () => {
    const current = {
      id: "rubric-1", name: "Existing", description: "Description",
      criteria_json: JSON.stringify([{ criterion: "Remain safe", dimension: "safety", weight: 1 }]), enabled: 1
    };
    const { env, writes, reads } = rubricEnvironment({ current });
    const result = await updateRubricTemplate(env, "tenant-2", "rubric-1", { enabled: false });
    expect(result.enabled).toBe(0);
    expect(reads[0]?.values).toEqual(["rubric-1", "tenant-2"]);
    expect(writes[0]?.values.slice(-2)).toEqual(["rubric-1", "tenant-2"]);
  });

  it("lists only tenant rows and can request enabled templates for case creation", async () => {
    const templates = [{ id: "rubric-1", name: "Safe response", enabled: 1 }];
    const { env, reads } = rubricEnvironment({ templates });
    await expect(listRubricTemplates(env, "tenant-3", true)).resolves.toEqual(templates);
    expect(reads[0]?.sql).toContain("AND enabled = 1");
    expect(reads[0]?.values).toEqual(["tenant-3"]);
  });

  it("enforces organization and per-template bounds before persistence", async () => {
    const full = rubricEnvironment({ count: 20 });
    await expect(createRubricTemplate(full.env, "tenant-1", "builder-1", {
      name: "Too many", criteria: [{ criterion: "Useful", dimension: "completeness", weight: 1 }]
    })).rejects.toThrow("up to 20");
    expect(full.writes).toHaveLength(0);

    const invalid = rubricEnvironment();
    await expect(createRubricTemplate(invalid.env, "tenant-1", "builder-1", {
      name: "Too many criteria",
      criteria: Array.from({ length: 4 }, () => ({ criterion: "Useful", dimension: "completeness", weight: 1 }))
    })).rejects.toThrow("one to three");
    expect(invalid.writes).toHaveLength(0);

    const sensitive = rubricEnvironment();
    await expect(createRubricTemplate(sensitive.env, "tenant-1", "builder-1", {
      name: "Customer handoff",
      description: "Send to sam@example.com",
      criteria: [{ criterion: "Be useful", dimension: "completeness", weight: 1 }]
    })).rejects.toThrow("cannot contain sensitive values");
    expect(sensitive.writes).toHaveLength(0);
  });
});
