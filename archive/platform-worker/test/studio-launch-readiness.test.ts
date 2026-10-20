import { describe, expect, it } from "vitest";
import {
  getProcessLaunchReadiness,
  publishRelease,
  ProcessLaunchReadinessError
} from "../src/studio";

function environment(row: Record<string, unknown> | null) {
  const calls: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() { calls.push({ sql, bindings }); return row; }
      };
      return statement;
    }
  };
  return { env: { DB } as never, calls };
}

describe("process launch readiness", () => {
  it("requires a same-tenant discovery baseline and owner-approved target", async () => {
    const { env, calls } = environment({
      id: "process-1", baseline_configured: 0, target_configured: 0,
      target_review_due_at: null
    });
    const result = await getProcessLaunchReadiness(env, "tenant-1", "process-1");
    expect(result).toEqual({
      ready: false,
      baselineConfigured: false,
      targetConfigured: false,
      targetCurrent: false,
      targetReviewDueAt: null,
      packPublicationChecks: 0,
      packPublicationChecksResolved: 0,
      blockers: [
        "complete the discovery baseline",
        "have an owner approve a 30-day value target"
      ]
    });
    expect(calls[0]?.sql).toContain("t.tenant_id=b.tenant_id");
    expect(calls[0]?.bindings).toEqual(["process-1", "tenant-1"]);
    expect(() => {
      throw new ProcessLaunchReadinessError(result);
    }).toThrow("complete the discovery baseline; have an owner approve a 30-day value target");
  });

  it("accepts current evidence and rejects an expired target review", async () => {
    const current = environment({
      id: "process-1", baseline_configured: 1, target_configured: 1,
      target_review_due_at: new Date(Date.now() + 86_400_000).toISOString()
    });
    await expect(getProcessLaunchReadiness(current.env, "tenant-1", "process-1"))
      .resolves.toMatchObject({ ready: true, targetCurrent: true, blockers: [] });

    const expired = environment({
      id: "process-1", baseline_configured: 1, target_configured: 1,
      target_review_due_at: "2020-01-01T00:00:00.000Z"
    });
    await expect(getProcessLaunchReadiness(expired.env, "tenant-1", "process-1"))
      .resolves.toMatchObject({
        ready: false,
        baselineConfigured: true,
        targetConfigured: true,
        targetCurrent: false,
        blockers: ["renew the expired value target review"]
      });
  });

  it("blocks only explicitly required solution-pack publication evidence", async () => {
    const env = environment({
      id: "process-1", baseline_configured: 1, target_configured: 1,
      target_review_due_at: new Date(Date.now() + 86_400_000).toISOString(),
      pack_publication_checks: 3, pack_publication_checks_resolved: 2
    });
    await expect(getProcessLaunchReadiness(env.env, "tenant-1", "process-1"))
      .resolves.toMatchObject({
        ready: false,
        packPublicationChecks: 3,
        packPublicationChecksResolved: 2,
        blockers: ["resolve 1 required solution pack publication check"]
      });
    expect(env.calls[0]?.sql).toContain("h.gate_type='publication'");
    expect(env.calls[0]?.sql).toContain("h.tenant_id=b.tenant_id");
  });

  it("does not disclose a process from another tenant", async () => {
    const { env } = environment(null);
    await expect(getProcessLaunchReadiness(env, "tenant-2", "process-1"))
      .rejects.toThrow("Process not found");
  });

  it("blocks publication before evaluation or release mutation", async () => {
    let batchCalled = false;
    const DB = {
      prepare(sql: string) {
        const statement = {
          bind(..._values: unknown[]) { return statement; },
          async first() {
            if (sql.includes("FROM process_releases r")) {
              return { id: "release-1", status: "draft", prompt_release_id: "prompt-1", version: 1,
                model_id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", checksum: "checksum-1",
                review_decision: "approved", review_checksum: "checksum-1",
                review_decided_by: "owner-2", created_by: "builder-1", risk_level: "medium" };
            }
            if (sql.includes("LEFT JOIN tenant_model_policies")) return { enabled: 1 };
            if (sql.includes("baseline_configured")) {
              return {
                id: "process-1", baseline_configured: 1, target_configured: 0,
                target_review_due_at: null
              };
            }
            throw new Error(`Unexpected pre-publication query: ${sql}`);
          }
        };
        return statement;
      },
      async batch() { batchCalled = true; return []; }
    };
    await expect(publishRelease({ DB } as never, "tenant-1", "process-1", "release-1", "owner-1"))
      .rejects.toThrow("have an owner approve a 30-day value target");
    expect(batchCalled).toBe(false);
  });

  it("requires an exact-checksum decision and high-risk author separation before other publication work", async () => {
    function releaseEnvironment(release: Record<string, unknown>) {
      let queries = 0;
      const DB = {
        prepare() {
          const statement = {
            bind(..._values: unknown[]) { return statement; },
            async first() { queries += 1; return release; }
          };
          return statement;
        }
      };
      return { DB, count: () => queries };
    }
    const unreviewed = releaseEnvironment({
      id: "release-1", status: "draft", checksum: "checksum-1", risk_level: "medium"
    });
    await expect(publishRelease({ DB: unreviewed.DB } as never,
      "tenant-1", "process-1", "release-1", "owner-1"))
      .rejects.toThrow("owner review of the exact checksum");
    expect(unreviewed.count()).toBe(1);

    const selfApproved = releaseEnvironment({
      id: "release-1", status: "draft", checksum: "checksum-1", review_checksum: "checksum-1",
      review_decision: "approved", risk_level: "high", review_decided_by: "owner-1", created_by: "owner-1"
    });
    await expect(publishRelease({ DB: selfApproved.DB } as never,
      "tenant-1", "process-1", "release-1", "owner-1"))
      .rejects.toThrow("different owner or administrator");
    expect(selfApproved.count()).toBe(1);
  });
});
