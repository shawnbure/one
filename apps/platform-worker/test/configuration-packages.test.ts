import { describe, expect, it } from "vitest";
import { applyConfigurationRestore, ConfigurationRestoreConflict,
  previewConfigurationRestore } from "../src/configuration-packages";

function packageData() {
  return {
    schema: "workrr-configuration/v1",
    exportedAt: "2026-07-23T00:00:00.000Z",
    source: { environment: "development", tenantId: "source-tenant" },
    organization: {
      organizationName: "Example Operations", supportEmail: "support@example.com",
      accentColor: "#1f7a5b", defaultModelProfile: "balanced",
      dataRegion: "Cloudflare global network"
    },
    lifecycle: {
      escalationEmail: "alerts@example.com", maintenanceDayUtc: 0, maintenanceHourUtc: 8,
      recoveryReviewDueAt: "2027-01-01T00:00:00.000Z"
    },
    retention: {
      conversationDays: 90, executionDays: 365, approvalDays: 365,
      notificationDays: 180, helpRequestDays: 365, apiLogDays: 90
    },
    dlpRules: [
      "email", "phone", "ssn", "payment_card", "api_secret", "ip_address"
    ].map((detector) => ({ detector, action: detector === "email" ? "redact" : "block",
      direction: "both", enabled: true })),
    notificationPolicies: [{
      eventType: "approval.pending", channel: "in_app", enabled: true, severity: "warning",
      acknowledgementRequired: true, escalationMinutes: 240, quietHoursEnabled: false,
      quietStartHourUtc: 22, quietEndHourUtc: 7, criticalBypass: true,
      digestMode: "immediate", digestHourUtc: 8
    }, {
      eventType: "execution.failed", channel: "webhook", enabled: true, severity: "critical",
      acknowledgementRequired: false, escalationMinutes: 0, quietHoursEnabled: false,
      quietStartHourUtc: 22, quietEndHourUtc: 7, criticalBypass: true,
      digestMode: "immediate", digestHourUtc: 8
    }],
    exclusions: ["credentials"]
  };
}

function environment() {
  const statements: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      return {
        bind(...values: unknown[]) { bindings = values; return this; },
        async run() { return { meta: { changes: 1 } }; },
        get sql() { return sql; },
        get bindings() { return bindings; }
      };
    },
    async batch(items: Array<{ sql: string; bindings: unknown[] }>) {
      statements.push(...items);
      return items.map(() => ({ meta: { changes: 1 } }));
    }
  };
  return { env: { DB } as never, statements };
}

describe("configuration packages", () => {
  it("validates bounded sections and computes a content checksum independent of export metadata", async () => {
    const first = await previewConfigurationRestore(packageData());
    const second = await previewConfigurationRestore({
      ...packageData(), exportedAt: "2026-07-24T00:00:00.000Z", exclusions: ["different prose"]
    });
    expect(first.checksum).toBe(second.checksum);
    expect(first.counts).toEqual({
      organization: 1, lifecycle: 1, retention: 1, dlpRules: 6, notificationPolicies: 2
    });
    expect(first.warnings.join(" ")).toContain("external notification policies");
  });

  it("rejects incomplete DLP policy and unsupported model configuration", async () => {
    await expect(previewConfigurationRestore({ ...packageData(), dlpRules: [] }))
      .rejects.toThrow("six unique DLP");
    await expect(previewConfigurationRestore({
      ...packageData(), organization: { ...packageData().organization, defaultModelProfile: "arbitrary" }
    })).rejects.toThrow("model profile");
  });

  it("requires exact preview evidence and applies only tenant-scoped non-secret controls", async () => {
    const preview = await previewConfigurationRestore(packageData());
    const { env, statements } = environment();
    await expect(applyConfigurationRestore(env, "destination-tenant", "owner-1", {
      package: packageData(), checksum: "stale", reason: "Customer-approved restore",
      confirmation: "RESTORE CONFIGURATION"
    })).rejects.toBeInstanceOf(ConfigurationRestoreConflict);
    const result = await applyConfigurationRestore(env, "destination-tenant", "owner-1", {
      package: packageData(), checksum: preview.checksum, reason: "Customer-approved restore",
      confirmation: "RESTORE CONFIGURATION"
    });
    expect(result.counts.notificationPolicies).toBe(2);
    const updates = statements.filter(({ sql }) => sql.includes("UPDATE notification_policies"));
    expect(updates).toHaveLength(2);
    expect(updates.find(({ bindings }) => bindings.includes("webhook"))?.bindings[0]).toBe(0);
    expect(JSON.stringify(statements)).not.toContain("destination=");
    expect(JSON.stringify(statements)).not.toContain("legal_hold=");
    expect(statements.every(({ sql }) => !sql.includes("DELETE "))).toBe(true);
    expect(JSON.stringify(statements)).toContain("configuration.restored");
  });
});
