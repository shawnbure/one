import { describe, expect, it } from "vitest";
import { getPlatformVersion } from "../src/platform-version";

function environment(migration: { id: number; name: string; applied_at: string } | null) {
  return {
    ENVIRONMENT: "development",
    APP_DOMAIN: "one-dev.workrr.ai",
    CF_VERSION_METADATA: {
      id: "worker-version-1",
      tag: "dev",
      timestamp: "2026-07-23T17:36:10.337Z",
    },
    DB: {
      prepare(sql: string) {
        expect(sql).toContain("FROM d1_migrations");
        return { async first() { return migration; } };
      },
    },
  };
}

describe("platform deployment compatibility", () => {
  it("proves the exact Worker and schema version when migrations are current", async () => {
    const result = await getPlatformVersion(environment({
      id: 99,
      name: "0099_service_principal_lifecycle.sql",
      applied_at: "2026-07-24 00:30:00",
    }) as never);
    expect(result).toMatchObject({
      applicationRelease: "0.1.0",
      environment: "development",
      domain: "one-dev.workrr.ai",
      worker: { versionId: "worker-version-1", tag: "dev" },
      schema: { status: "current", compatible: true, appliedMigrationId: 99, requiredMigrationId: 99 },
    });
  });

  it("distinguishes a migration requirement from a newer unsupported database", async () => {
    expect((await getPlatformVersion(environment({
      id: 68, name: "0068_provider_acceptance.sql", applied_at: "2026-07-22 12:00:00",
    }) as never)).schema.status).toBe("migration_required");
    expect((await getPlatformVersion(environment({
      id: 100, name: "0100_future.sql", applied_at: "2026-07-24 12:00:00",
    }) as never)).schema.status).toBe("application_upgrade_required");
  });

  it("reports unavailable evidence without making the setup route fail", async () => {
    const env = environment(null);
    env.DB.prepare = () => ({ async first() { throw new Error("table unavailable"); } });
    expect((await getPlatformVersion(env as never)).schema).toMatchObject({
      status: "unavailable",
      compatible: false,
      appliedMigrationId: null,
    });
  });
});
