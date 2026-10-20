import { describe, expect, it } from "vitest";
import { completeGovernanceReview, provisionGovernanceReviews } from "../src/governance-reviews";

function environment(review: { review_key: string; cadence_days: number } | null = {
  review_key: "privacy_architecture", cadence_days: 90,
}) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  function prepare(sql: string) {
    let bindings: unknown[] = [];
    const statement = {
      bind(...values: unknown[]) { bindings = values; return statement; },
      async first() { return sql.includes("SELECT review_key") ? review : null; },
      async run() {
        writes.push({ sql, bindings });
        return { meta: { changes: sql.includes("UPDATE tenant_governance_reviews") && review ? 1 : 0 } };
      },
    };
    return statement;
  }
  return {
    env: { DB: { prepare, async batch(items: Array<ReturnType<typeof prepare>>) {
      for (const item of items) await item.run();
      return [];
    } } },
    writes,
  };
}

describe("periodic governance reviews", () => {
  it("provisions four idempotent customer review obligations", async () => {
    const fixture = environment();
    await provisionGovernanceReviews(fixture.env as never, "tenant-1");
    expect(fixture.writes).toHaveLength(4);
    expect(fixture.writes.every(({ sql, bindings }) =>
      sql.includes("INSERT OR IGNORE") && bindings[0] === "tenant-1")).toBe(true);
  });

  it("completes a same-tenant review with bounded attributable evidence", async () => {
    const fixture = environment();
    await expect(completeGovernanceReview(fixture.env as never, "tenant-1", "owner-1",
      "privacy_architecture", {
        evidenceReference: "privacy-report-2026-q3",
        notes: "Reviewed data flows and confirmed the customer retention policy.",
      })).resolves.toEqual({
        reviewKey: "privacy_architecture", evidenceReference: "privacy-report-2026-q3", nextDueInDays: 90,
      });
    expect(fixture.writes[0]?.bindings).toEqual([
      "owner-1", "privacy-report-2026-q3",
      "Reviewed data flows and confirmed the customer retention policy.",
      "tenant-1", "privacy_architecture",
    ]);
  });

  it("rejects missing review ownership evidence and unknown reviews", async () => {
    await expect(completeGovernanceReview(environment().env as never, "tenant-1", "owner-1",
      "privacy_architecture", { evidenceReference: "x", notes: "too short" }))
      .rejects.toThrow("Evidence reference");
    await expect(completeGovernanceReview(environment(null).env as never, "tenant-1", "owner-1",
      "unknown", { evidenceReference: "ticket-123", notes: "Reviewed by the accountable owner." }))
      .rejects.toThrow("not found");
  });
});
