import { describe, expect, it } from "vitest";
import {
  createRubricTemplate,
  exportRubricPackage,
  importRubricPackage,
  listRubricTemplates,
  reviewRubricPackage,
  updateRubricTemplate
} from "../src/evaluation";

function rubricEnvironment(options: {
  count?: number;
  current?: { id: string; name: string; description: string; criteria_json: string; enabled: number } | null;
  templates?: Array<Record<string, unknown>>;
  existingNames?: string[];
  review?: { id: string; status: string; package_json: string } | null;
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
          if (sql.includes("FROM rubric_package_reviews")) return options.review ?? null;
          if (sql.includes("FROM evaluation_rubric_templates")) return options.current ?? null;
          return null;
        },
        async all() {
          reads.push({ sql, values });
          if (sql.includes("SELECT name FROM evaluation_rubric_templates")) {
            return { results: (options.existingNames ?? []).map((name) => ({ name })) };
          }
          return { results: options.templates ?? [] };
        },
        async run() {
          writes.push({ sql, values });
          return { meta: { changes: 1 } };
        }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      for (const statement of statements) await statement.run();
      return [];
    },
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

  it("exports a versioned package without tenant, actor, or database identifiers", async () => {
    const { env } = rubricEnvironment({ templates: [{
      id: "internal-id",
      tenant_id: "tenant-secret",
      name: "Safe response",
      description: "Customer standard",
      criteria_json: JSON.stringify([{ criterion: "Avoid unsupported claims", dimension: "safety", weight: 2 }]),
      enabled: 1,
      created_by: "actor-secret"
    }] });
    const result = await exportRubricPackage(env, "tenant-1");
    expect(result).toMatchObject({
      schema: "workrr-rubrics/v1",
      templates: [{ name: "Safe response", enabled: true,
        criteria: [{ criterion: "Avoid unsupported claims", dimension: "safety", weight: 2 }] }]
    });
    expect(JSON.stringify(result)).not.toContain("internal-id");
    expect(JSON.stringify(result)).not.toContain("tenant-secret");
    expect(JSON.stringify(result)).not.toContain("actor-secret");
  });

  it("imports new templates archived and skips normalized duplicates for safe retries", async () => {
    const { env, writes } = rubricEnvironment({ existingNames: ["Existing standard"] });
    const result = await importRubricPackage(env, "tenant-2", "builder-2", {
      schema: "workrr-rubrics/v1",
      templates: [
        { name: " existing STANDARD ", description: "Duplicate", criteria: [
          { criterion: "Duplicate", dimension: "clarity", weight: 1 }
        ] },
        { name: "Escalation readiness", description: "Portable standard", enabled: true, criteria: [
          { criterion: "States when a human must take over", dimension: "safety", weight: 2 }
        ] }
      ]
    });
    expect(result).toEqual({ imported: 1, skipped: 1, totalTemplates: 2, activationRequired: 1 });
    const insert = writes.find(({ sql }) => sql.includes("INSERT OR IGNORE INTO evaluation_rubric_templates"));
    expect(insert?.sql).toContain("VALUES (?, ?, ?, ?, ?, 0, ?)");
    expect(insert?.values).toEqual(expect.arrayContaining(["tenant-2", "builder-2", "Escalation readiness"]));
  });

  it("rejects oversized and sensitive rubric packages before any write", async () => {
    const full = rubricEnvironment({ existingNames: Array.from({ length: 20 }, (_, index) => `Existing ${index}`) });
    await expect(importRubricPackage(full.env, "tenant-1", "builder-1", {
      schema: "workrr-rubrics/v1",
      templates: [{ name: "One more", criteria: [
        { criterion: "Be useful", dimension: "completeness", weight: 1 }
      ] }]
    })).rejects.toThrow("20-template");
    expect(full.writes).toHaveLength(0);

    const sensitive = rubricEnvironment();
    await expect(importRubricPackage(sensitive.env, "tenant-1", "builder-1", {
      schema: "workrr-rubrics/v1",
      templates: [{ name: "Private contact", description: "sam@example.com", criteria: [
        { criterion: "Be useful", dimension: "completeness", weight: 1 }
      ] }]
    })).rejects.toThrow("cannot contain sensitive values");
    expect(sensitive.writes).toHaveLength(0);
  });

  it("signs v2 exports and queues verified imports for destination approval", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const source = rubricEnvironment({ templates: [{
      name: "Signed standard", description: "Portable and governed",
      criteria_json: JSON.stringify([{ criterion: "Stay grounded", dimension: "groundedness", weight: 2 }]),
      enabled: 1
    }] });
    const pkg = await exportRubricPackage({ ...source.env, RUBRIC_SIGNING_JWK: JSON.stringify(privateJwk),
      RUBRIC_PUBLISHER_NAME: "Trusted FDE standards" } as never, "source-tenant");
    expect(pkg).toMatchObject({ schema: "workrr-rubrics/v2",
      publisher: { name: "Trusted FDE standards" }, templates: [{ name: "Signed standard" }] });
    expect("signature" in pkg && pkg.signature.length).toBeGreaterThan(40);

    const destination = rubricEnvironment();
    const result = await importRubricPackage(destination.env, "destination-tenant", "builder-1", pkg);
    expect(result).toMatchObject({ status: "pending", duplicate: false, imported: 0 });
    const reviewWrite = destination.writes.find(({ sql }) => sql.includes("INSERT OR IGNORE INTO rubric_package_reviews"));
    expect(reviewWrite?.values).toEqual(expect.arrayContaining(["destination-tenant", "Trusted FDE standards", "builder-1"]));
    expect(destination.writes.some(({ sql }) => sql.includes("INSERT OR IGNORE INTO evaluation_rubric_templates"))).toBe(false);
  });

  it("rejects tampered signed packages before retaining review data", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const source = rubricEnvironment({ templates: [{
      name: "Original", description: "", criteria_json: JSON.stringify([
        { criterion: "Be accurate", dimension: "groundedness", weight: 1 }
      ]), enabled: 1
    }] });
    const pkg = await exportRubricPackage({ ...source.env, RUBRIC_SIGNING_JWK: JSON.stringify(privateJwk) } as never, "source");
    const tampered = { ...pkg, templates: [{ ...pkg.templates[0], name: "Changed after signing" }] };
    const destination = rubricEnvironment();
    await expect(importRubricPackage(destination.env, "destination", "builder", tampered))
      .rejects.toThrow("signature verification failed");
    expect(destination.writes).toHaveLength(0);
  });

  it("imports approved signed-package content archived and closes the review", async () => {
    const packageJson = JSON.stringify({ schema: "workrr-rubrics/v2", templates: [{
      name: "Approved standard", description: "", criteria: [
        { criterion: "Include an owner", dimension: "completeness", weight: 1 }
      ]
    }] });
    const { env, writes } = rubricEnvironment({ review: { id: "review-1", status: "pending", package_json: packageJson } });
    const result = await reviewRubricPackage(env, "tenant-1", "owner-1", "review-1", "approved");
    expect(result).toMatchObject({ status: "approved", imported: 1, activationRequired: 1 });
    expect(writes.some(({ sql }) => sql.includes("VALUES (?, ?, ?, ?, ?, 0, ?)"))).toBe(true);
    expect(writes.some(({ sql }) => sql.includes("UPDATE rubric_package_reviews SET status"))).toBe(true);
  });
});
