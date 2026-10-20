import { describe, expect, it } from "vitest";
import { getDeploymentVerification } from "../src/deployment-verification";

function environment(options?: {
  principals?: Array<Record<string, unknown>>;
  smoke?: Record<string, unknown> | null;
}) {
  const DB = {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async all() {
          return { results: sql.includes("FROM access_service_principals")
            ? options?.principals ?? [] : [] };
        },
        async first() {
          return sql.includes("FROM audit_events deleted") ? options?.smoke ?? null : null;
        }
      };
    }
  };
  return { DB } as never;
}

describe("deployment verification evidence", () => {
  it("requires an active least-privilege operator service principal", async () => {
    const result = await getDeploymentVerification(environment(), "tenant-1");
    expect(result.status).toBe("principal_required");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "service-principal", ready: false }),
      expect.objectContaining({ id: "live-smoke", ready: false })
    ]));
  });

  it("recognizes a recent complete service-principal smoke cycle", async () => {
    const completedAt = new Date(Date.now() - 60_000).toISOString();
    const result = await getDeploymentVerification(environment({
      principals: [{ id: "machine-1", display_name: "Dev smoke", role: "operator",
        status: "active", last_seen_at: completedAt }],
      smoke: { fixture_id: "fixture-1", principal_id: "machine-1", principal_name: "Dev smoke",
        started_at: new Date(Date.now() - 120_000).toISOString(), completed_at: completedAt }
    }), "tenant-1");
    expect(result).toMatchObject({
      status: "verified", activeOperatorPrincipals: 1, lastVerifiedAt: completedAt,
      lastVerifiedBy: "Dev smoke"
    });
    expect(result.checks.every((check) => check.ready)).toBe(true);
  });

  it("expires smoke evidence after thirty days without erasing its history", async () => {
    const completedAt = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const result = await getDeploymentVerification(environment({
      principals: [{ id: "machine-1", display_name: "Dev smoke", role: "operator",
        status: "active", last_seen_at: completedAt }],
      smoke: { fixture_id: "fixture-1", principal_id: "machine-1", principal_name: "Dev smoke",
        started_at: completedAt, completed_at: completedAt }
    }), "tenant-1");
    expect(result.status).toBe("verification_due");
    expect(result.lastVerifiedAt).toBe(completedAt);
    expect(result.checks.find((check) => check.id === "live-smoke")?.ready).toBe(false);
  });
});
