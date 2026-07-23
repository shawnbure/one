import { describe, expect, it } from "vitest";
import { exportSupportBundle, getManagedLifecycle, HandoffConflict, updateHandoffCheck,
  updateManagedLifecycle } from "../src/lifecycle";

type Write = { sql: string; bindings: unknown[] };

function environment(ownerCount = 1) {
  const writes: Write[] = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("SELECT l.*")) return {
            tenant_id: "tenant-1", organization_name: "Customer", support_owner_id: "owner-1",
            recovery_owner_id: "owner-1", escalation_email: "support@example.com",
            recovery_review_due_at: "2027-01-01T00:00:00.000Z"
          };
          if (sql.includes("(SELECT COUNT(*) FROM agent_blueprints")) return {
            processes: 2, members: 3, connections: 2, knowledge_sources: 1, executions: 10,
            audit_events: 20, retention_policies: 2, open_help_requests: 1, overdue_help_requests: 0
          };
          if (sql.includes("tenant_operating_controls")) return { mode: "active", reason: null };
          if (sql.includes("notification_policies p")) return { count: 0 };
          if (sql.includes("credential_expires_at")) return { count: 0 };
          if (sql.includes("acknowledgement_required=1")) return { count: 0 };
          if (sql.includes("agent_blueprints b")) return { count: 1 };
          if (sql.includes("FROM incidents WHERE")) return { count: 0 };
          if (sql.includes("COUNT(*) count FROM tenant_members")) return { count: ownerCount };
          return null;
        },
        async all() {
          if (sql.includes("FROM tenant_members")) return { results: [
            { id: "owner-1", display_name: "Owner", email: "owner@example.com", role: "owner" }
          ] };
          if (sql.includes("FROM connections")) return { results: [
            { name: "Workers AI", kind: "model_provider", status: "healthy" }
          ] };
          if (sql.includes("FROM notification_policies")) return { results: [
            { event_type: "execution.failed", channel: "in_app", enabled: 1, destination_configured: 0 }
          ] };
          if (sql.includes("FROM incidents")) return { results: [] };
          if (sql.includes("FROM executions")) return { results: [] };
          return { results: [] };
        },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  return { env: { DB, ENVIRONMENT: "development", APP_DOMAIN: "one-dev.workrr.ai",
    ACCESS_TEAM_DOMAIN: "https://workrr-one.cloudflareaccess.com", ACCESS_AUD: "audience" } as never, writes };
}

describe("managed lifecycle", () => {
  it("derives a tenant-scoped environment preflight from operating evidence", async () => {
    const { env } = environment();
    const result = await getManagedLifecycle(env, "tenant-1");
    expect(result.preflight).toMatchObject({ status: "ready", ready: 12, total: 12 });
    expect(result.environment).toEqual({
      name: "development", domain: "one-dev.workrr.ai",
      accessTeamDomain: "https://workrr-one.cloudflareaccess.com"
    });
  });

  it("validates same-tenant owners and writes attributable lifecycle audit evidence", async () => {
    const valid = environment();
    await updateManagedLifecycle(valid.env, "tenant-1", "admin-1", {
      supportOwnerId: "owner-1", recoveryOwnerId: "owner-1", escalationEmail: "support@example.com",
      maintenanceDayUtc: 2, maintenanceHourUtc: 7, recoveryReviewDueAt: "2026-12-01T00:00:00.000Z",
      supportNotes: "Exercise recovery quarterly."
    });
    expect(valid.writes.some(({ sql }) => sql.includes("INSERT INTO tenant_lifecycle_settings"))).toBe(true);
    expect(JSON.stringify(valid.writes)).toContain("lifecycle.settings_updated");

    const invalid = environment(0);
    await expect(updateManagedLifecycle(invalid.env, "tenant-1", "admin-1", {
      supportOwnerId: "other-tenant", recoveryOwnerId: "other-tenant",
      escalationEmail: "support@example.com", maintenanceDayUtc: 2, maintenanceHourUtc: 7,
      recoveryReviewDueAt: null, supportNotes: ""
    })).rejects.toThrow("Lifecycle owners");
    expect(invalid.writes).toHaveLength(0);
  });

  it("requires meaningful, attributable, revision-protected customer handoff evidence", async () => {
    const { env, writes } = environment();
    await expect(updateHandoffCheck(env, "tenant-1", "owner-1", "operator_training", {
      status: "confirmed", evidence: "done", revision: 0
    })).rejects.toThrow("specific evidence");
    await expect(updateHandoffCheck(env, "tenant-1", "owner-1", "unknown", {
      status: "confirmed", evidence: "Operator training completed with the customer.", revision: 0
    })).rejects.toThrow("Unknown handoff");

    const result = await updateHandoffCheck(env, "tenant-1", "owner-1", "operator_training", {
      status: "confirmed",
      evidence: "Operators completed the approval, pause, and recovery walkthrough on July 23.",
      revision: 0
    });
    expect(result.handoff).toMatchObject({ status: "action_required", confirmed: 0, total: 5 });
    expect(writes.some(({ sql, bindings }) => sql.includes("INSERT INTO tenant_handoff_checks") &&
      bindings.includes("owner-1"))).toBe(true);
    expect(JSON.stringify(writes)).toContain("lifecycle.handoff_updated");
  });

  it("rejects stale handoff revisions before writing evidence", async () => {
    const fixture = environment();
    const originalFirst = fixture.env.DB.prepare.bind(fixture.env.DB);
    fixture.env.DB.prepare = ((sql: string) => {
      const statement = originalFirst(sql);
      if (sql.includes("SELECT revision FROM tenant_handoff_checks")) {
        statement.first = async () => ({ revision: 3 });
      }
      return statement;
    }) as typeof fixture.env.DB.prepare;
    await expect(updateHandoffCheck(fixture.env, "tenant-1", "owner-1", "support_handoff", {
      status: "confirmed", evidence: "Support handoff recorded in customer ticket OPS-42.", revision: 2
    })).rejects.toBeInstanceOf(HandoffConflict);
    expect(fixture.writes).toHaveLength(0);
  });

  it("exports operational evidence without destinations, member emails, prompts, or payloads", async () => {
    const { env } = environment();
    const bundle = await exportSupportBundle(env, "tenant-1");
    const serialized = JSON.stringify(bundle);
    expect(bundle).toMatchObject({ schemaVersion: 1, bundleType: "workrr-redacted-support" });
    expect(serialized).not.toContain("owner@example.com");
    expect(bundle.notificationPolicies.every((policy) =>
      !Object.prototype.hasOwnProperty.call(policy, "destination"))).toBe(true);
    expect(serialized).not.toContain("system_prompt");
    expect(serialized).not.toContain("input_preview");
    expect(bundle.preflight).toBeDefined();
    expect(bundle.exclusions).toContain("credentials and tokens");
  });
});
