import { describe, expect, it } from "vitest";
import {
  createRubricTemplate,
  createRubricPublisherTrust,
  exportRubricPackage,
  expireRubricPublisherKeys,
  importRubricPackage,
  listRubricTemplates,
  reviewRubricPackage,
  reviewRubricKeyRotation,
  updateRubricTemplate
} from "../src/evaluation";

function rubricEnvironment(options: {
  count?: number;
  current?: { id: string; name: string; description: string; criteria_json: string; enabled: number } | null;
  templates?: Array<Record<string, unknown>>;
  existingNames?: string[];
  review?: { id: string; status: string; package_json: string; publisher_name?: string; publisher_key_id?: string } | null;
  trust?: Record<string, unknown> | null;
  rotation?: Record<string, unknown> | null;
  expiring?: Array<{ id: string; tenant_id: string; publisher_key_id: string }>;
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
          if (sql.includes("FROM rubric_key_rotations")) return options.rotation ?? null;
          if (sql.includes("FROM rubric_publisher_trust")) return options.trust ?? null;
          if (sql.includes("FROM evaluation_rubric_templates")) return options.current ?? null;
          return null;
        },
        async all() {
          reads.push({ sql, values });
          if (sql.includes("SELECT name FROM evaluation_rubric_templates")) {
            return { results: (options.existingNames ?? []).map((name) => ({ name })) };
          }
          if (sql.includes("FROM rubric_publisher_trust") && sql.includes("expires_at")) {
            return { results: options.expiring ?? [] };
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

  it("auto-approves only an exact active trusted key and still archives templates", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const source = rubricEnvironment({ templates: [{
      name: "Trusted standard", description: "", criteria_json: JSON.stringify([
        { criterion: "Stay safe", dimension: "safety", weight: 1 }
      ]), enabled: 1
    }] });
    const pkg = await exportRubricPackage({ ...source.env, RUBRIC_SIGNING_JWK: JSON.stringify(privateJwk),
      RUBRIC_PUBLISHER_NAME: "Trusted publisher" } as never, "source");
    if (pkg.schema !== "workrr-rubrics/v2") throw new Error("Expected signed package");
    const destination = rubricEnvironment({ trust: { id: "trust-1", policy: "auto_approve" } });
    const result = await importRubricPackage(destination.env, "tenant-1", "builder-1", pkg);
    expect(result).toMatchObject({ status: "approved", autoApproved: true, imported: 1, activationRequired: 1 });
    expect(destination.writes.some(({ sql }) => sql.includes("VALUES (?, ?, ?, ?, ?, 0, ?)"))).toBe(true);
    expect(destination.writes.some(({ sql }) => sql.includes("'approved'"))).toBe(true);
    const trustRead = destination.reads.find(({ sql }) => sql.includes("FROM rubric_publisher_trust"));
    expect(trustRead?.values).toEqual(["tenant-1", pkg.publisher.keyId, pkg.publisher.publicKey.x]);
  });

  it("retains blocked-publisher evidence without creating templates", async () => {
    const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const source = rubricEnvironment({ templates: [{
      name: "Blocked standard", description: "", criteria_json: JSON.stringify([
        { criterion: "Be clear", dimension: "clarity", weight: 1 }
      ]), enabled: 1
    }] });
    const pkg = await exportRubricPackage({ ...source.env, RUBRIC_SIGNING_JWK: JSON.stringify(privateJwk) } as never, "source");
    const destination = rubricEnvironment({ trust: { id: "trust-block", policy: "block" } });
    const result = await importRubricPackage(destination.env, "tenant-1", "builder-1", pkg);
    expect(result).toMatchObject({ status: "rejected", autoApproved: false, imported: 0 });
    expect(destination.writes.some(({ sql }) => sql.includes("evaluation_rubric_templates"))).toBe(false);
    expect(destination.writes.some(({ sql }) => sql.includes("'rejected'"))).toBe(true);
  });

  it("creates tenant-scoped trust only from a verified retained package", async () => {
    const packageJson = JSON.stringify({ publisher: { publicKey: { x: "public-key-x" } } });
    const review = { id: "review-2", status: "pending", package_json: packageJson,
      publisher_name: "Publisher", publisher_key_id: "key-id" };
    const { env, writes } = rubricEnvironment({ review });
    const result = await createRubricPublisherTrust(env, "tenant-2", "owner-2", "review-2", "manual");
    expect(result).toMatchObject({ publisherName: "Publisher", keyId: "key-id", policy: "manual" });
    expect(writes.some(({ values }) => values.includes("tenant-2") && values.includes("public-key-x"))).toBe(true);
  });

  it("verifies a previous-key successor proof and retains a tenant rotation for approval", async () => {
    const previousPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const successorPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const previousJwk = await crypto.subtle.exportKey("jwk", previousPair.privateKey);
    const successorJwk = await crypto.subtle.exportKey("jwk", successorPair.privateKey);
    const source = rubricEnvironment({ templates: [{
      name: "Rotated standard", description: "", criteria_json: JSON.stringify([
        { criterion: "Remain accurate", dimension: "groundedness", weight: 1 }
      ]), enabled: 1
    }] });
    const pkg = await exportRubricPackage({
      ...source.env,
      RUBRIC_SIGNING_JWK: JSON.stringify(successorJwk),
      RUBRIC_PREVIOUS_SIGNING_JWK: JSON.stringify(previousJwk),
      RUBRIC_SIGNING_VALID_FROM: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      RUBRIC_SIGNING_EXPIRES_AT: new Date(Date.now() + 366 * 24 * 60 * 60_000).toISOString(),
      RUBRIC_PUBLISHER_NAME: "Managed standards"
    } as never, "source");
    expect(pkg).toMatchObject({ schema: "workrr-rubrics/v3",
      publisher: { name: "Managed standards", rotation: { previousKeyId: expect.any(String), proof: expect.any(String) } } });
    if (pkg.schema !== "workrr-rubrics/v3") throw new Error("Expected v3 package");
    const destination = rubricEnvironment({ trust: {
      id: "old-trust", policy: "manual", publisher_name: "Managed standards",
      publisher_key_id: pkg.publisher.rotation?.previousKeyId,
      public_key_x: previousJwk.x, valid_from: null, expires_at: null
    } });
    await expect(importRubricPackage(destination.env, "tenant-1", "builder-1", pkg))
      .resolves.toMatchObject({ status: "pending" });
    expect(destination.writes.some(({ sql }) => sql.includes("INSERT OR IGNORE INTO rubric_key_rotations"))).toBe(true);
    const reviewWrite = destination.writes.find(({ sql }) => sql.includes("INSERT OR IGNORE INTO rubric_package_reviews"));
    expect(reviewWrite?.values.at(-1)).toEqual(expect.any(String));
  });

  it("rejects a tampered successor proof and requires tenant review before key rollover", async () => {
    const previousPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const successorPair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    const previousJwk = await crypto.subtle.exportKey("jwk", previousPair.privateKey);
    const successorJwk = await crypto.subtle.exportKey("jwk", successorPair.privateKey);
    const source = rubricEnvironment({ templates: [{
      name: "Standard", description: "", criteria_json: JSON.stringify([
        { criterion: "Be safe", dimension: "safety", weight: 1 }
      ]), enabled: 1
    }] });
    const pkg = await exportRubricPackage({ ...source.env,
      RUBRIC_SIGNING_JWK: JSON.stringify(successorJwk),
      RUBRIC_PREVIOUS_SIGNING_JWK: JSON.stringify(previousJwk),
      RUBRIC_SIGNING_VALID_FROM: new Date().toISOString(),
      RUBRIC_SIGNING_EXPIRES_AT: new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString()
    } as never, "source");
    if (pkg.schema !== "workrr-rubrics/v3") throw new Error("Expected v3 package");
    const trust = { id: "old-trust", policy: "auto_approve", publisher_name: "Workrr publisher",
      publisher_key_id: pkg.publisher.rotation?.previousKeyId, public_key_x: previousJwk.x,
      valid_from: null, expires_at: null };
    const tampered = { ...pkg, publisher: { ...pkg.publisher,
      rotation: { ...pkg.publisher.rotation!, proof: `${pkg.publisher.rotation!.proof.slice(0, -2)}aa` } } };
    await expect(importRubricPackage(rubricEnvironment({ trust }).env, "tenant-1", "builder-1", tampered))
      .rejects.toThrow();

    const rotation = { id: "rotation-1", status: "pending", publisher_name: "Workrr publisher",
      predecessor_trust_id: "old-trust", predecessor_key_id: "old-key", successor_key_id: "new-key",
      successor_public_key_x: successorJwk.x, predecessor_policy: "manual", predecessor_status: "active",
      predecessor_expires_at: null, valid_from: new Date().toISOString(),
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60_000).toISOString() };
    const review = rubricEnvironment({ rotation });
    await expect(reviewRubricKeyRotation(review.env, "tenant-1", "owner-1", "rotation-1", "approved",
      { overlapDays: 7, note: "Approved scheduled publisher rollover." }))
      .resolves.toMatchObject({ status: "approved", overlapDays: 7 });
    expect(review.writes.some(({ sql }) => sql.includes("INSERT INTO rubric_publisher_trust"))).toBe(true);
    expect(review.writes.some(({ sql }) => sql.includes("superseded_by_trust_id"))).toBe(true);
  });

  it("suspends expired publisher keys with tenant audit evidence", async () => {
    const state = rubricEnvironment({ expiring: [{ id: "trust-1", tenant_id: "tenant-1", publisher_key_id: "key-1" }] });
    await expect(expireRubricPublisherKeys(state.env, new Date("2026-07-23T00:00:00Z")))
      .resolves.toEqual({ expired: 1 });
    expect(state.writes.some(({ sql }) => sql.includes("status='suspended'"))).toBe(true);
    expect(JSON.stringify(state.writes)).toContain("evaluation_rubric_publisher.expired");
  });
});
