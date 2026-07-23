import { describe, expect, it } from "vitest";
import { bootstrapCustomer, BootstrapConflict, type CustomerBootstrapManifest } from "../src/onboarding";

const template = {
  id: "template-customer-ops",
  execution_profile: "conversation",
  model_profile: "balanced",
  autonomy: "approve",
  system_prompt: "Assist customer operations.",
  instructions_json: '["Use verified facts"]',
  guardrails_json: '["Require approval"]',
  tools_json: '["lookup_customer"]'
};

function bootstrapEnvironment() {
  let run: Record<string, unknown> | null = null;
  let processId: string | null = null;
  let release: Record<string, unknown> | null = null;
  let memberId = "member-admin";
  let settings: Record<string, unknown> | null = null;
  let processInsertions = 0;
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];

  function prepare(sql: string) {
    let bindings: unknown[] = [];
    const statement = {
      sql,
      bind(...values: unknown[]) { bindings = values; return statement; },
      async first() {
        if (sql.includes("SELECT * FROM tenant_bootstrap_runs")) return run;
        if (sql.includes("SELECT tenant_id, status, member_id")) return run;
        if (sql.includes("FROM tenant_settings")) return settings;
        if (sql.includes("COUNT(*) count FROM tenant_members")) return { count: 1 };
        if (sql.includes("COUNT(*) count FROM agent_blueprints")) return { count: processId ? 1 : 0 };
        if (sql.includes("COUNT(*) count FROM connections")) return { count: 1 };
        if (sql.includes("COUNT(*) count FROM retention_policies")) return { count: 1 };
        if (sql.includes("SELECT * FROM process_templates")) return template;
        if (sql.includes("SELECT id FROM agent_blueprints")) return processId ? { id: processId } : null;
        if (sql.includes("SELECT id, prompt_release_id")) return release ? {
          id: release.releaseId, prompt_release_id: release.promptReleaseId, version: release.version,
          checksum: release.checksum, status: release.status
        } : null;
        if (sql.includes("SELECT execution_profile FROM agent_blueprints")) return processId ? { execution_profile: "conversation" } : null;
        if (sql.includes("MAX(version)")) return { version: 1 };
        if (sql.includes("SELECT id FROM tenant_members")) return { id: memberId };
        return null;
      },
      async all() { return { results: [] }; },
      async run() {
        statements.push({ sql, bindings });
        if (sql.includes("INSERT INTO tenant_bootstrap_runs")) {
          run = { tenant_id: bindings[0], idempotency_key: bindings[1], manifest_checksum: bindings[2], status: "started",
            member_id: null, process_id: null, started_at: "now", completed_at: null, last_error: null };
        } else if (sql.includes("INSERT INTO tenant_settings")) {
          settings = { tenant_id: bindings[0], organization_name: bindings[1], support_email: bindings[2],
            accent_color: bindings[3], default_model_profile: bindings[4], data_region: bindings[5], initialized_at: bindings[6] };
        } else if (sql.includes("INSERT INTO tenant_members")) {
          memberId = String(bindings[0]);
        } else if (sql.includes("INSERT INTO agent_blueprints")) {
          processId = String(bindings[0]);
          processInsertions += 1;
        } else if (sql.includes("INSERT INTO process_releases")) {
          release = { releaseId: bindings[0], promptReleaseId: bindings[4], version: 1, checksum: bindings[8], status: "draft" };
        } else if (sql.includes("SET status = 'completed'")) {
          run = { ...run!, status: "completed", member_id: bindings[0], process_id: bindings[1],
            completed_at: bindings[2], last_error: null };
        } else if (sql.includes("SET status = 'failed'")) {
          run = { ...run!, status: "failed", last_error: bindings[0] };
        }
        return { meta: { changes: 1 } };
      }
    };
    return statement;
  }
  const DB = { prepare, async batch(items: Array<ReturnType<typeof prepare>>) {
    for (const item of items) await item.run();
    return items.map(() => ({ meta: { changes: 1 } }));
  } };
  return { env: { DB }, state: () => ({ run, processId, release, memberId, processInsertions, statements }) };
}

const manifest: CustomerBootstrapManifest = {
  idempotencyKey: "launch-1",
  organizationName: "Northstar Components",
  supportEmail: "ai-ops@northstar.example",
  accentColor: "#256f55",
  defaultModelProfile: "balanced",
  dataRegion: "Cloudflare global network",
  member: { email: "operator@northstar.example", name: "Operations Owner", role: "operator" },
  firstProcess: {
    templateId: "template-customer-ops",
    name: "Customer Request Operations",
    purpose: "Prepare customer responses for approval.",
    businessOwner: "Customer Operations",
    department: "Operations",
    riskLevel: "medium",
    baseline: { volumePerMonth: 500, minutesPerItem: 10, hourlyCost: 40, errorRate: 0.05 }
  }
};

describe("customer launch bootstrap", () => {
  it("provisions one paused process baseline and returns the same result on retry", async () => {
    const { env, state } = bootstrapEnvironment();
    const first = await bootstrapCustomer(env as never, "tenant-1", "member-admin", manifest);
    expect(first.launch).toMatchObject({ status: "completed", alreadyCompleted: false });
    expect(state().processInsertions).toBe(1);
    expect(state().release).toMatchObject({ status: "draft" });
    const blueprintWrite = state().statements.find((item) => item.sql.includes("INSERT INTO agent_blueprints"));
    expect(blueprintWrite?.sql).toContain("'paused'");
    expect(state().statements.some((item) => item.sql.includes("INSERT INTO connections"))).toBe(true);
    expect(state().statements.filter((item) => item.sql.includes("INSERT INTO retention_policies"))).toHaveLength(2);
    expect(state().statements.some((item) => item.sql.includes("INSERT OR IGNORE INTO tenant_budgets"))).toBe(true);
    expect(state().statements.some((item) => item.sql.includes("INSERT OR IGNORE INTO tenant_operating_controls"))).toBe(true);
    expect(state().statements.some((item) => item.sql.includes("'incident.emergency_stop'"))).toBe(true);

    const retry = await bootstrapCustomer(env as never, "tenant-1", "member-admin", manifest);
    expect(retry.launch).toMatchObject({ status: "completed", alreadyCompleted: true, processId: state().processId });
    expect(state().processInsertions).toBe(1);
  });

  it("rejects a different launch manifest after the baseline is established", async () => {
    const { env } = bootstrapEnvironment();
    await bootstrapCustomer(env as never, "tenant-1", "member-admin", manifest);
    await expect(bootstrapCustomer(env as never, "tenant-1", "member-admin", {
      ...manifest, firstProcess: { ...manifest.firstProcess, name: "Different Process" }
    })).rejects.toBeInstanceOf(BootstrapConflict);
  });
});
