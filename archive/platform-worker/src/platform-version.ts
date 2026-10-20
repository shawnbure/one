import schemaCompatibility from "../schema-compatibility.json";
import type { Env } from "./types";

export type SchemaCompatibilityStatus =
  | "current"
  | "migration_required"
  | "application_upgrade_required"
  | "unavailable";

interface AppliedMigration {
  id: number;
  name: string;
  applied_at: string;
}

export async function getPlatformVersion(env: Env) {
  let migration: AppliedMigration | null = null;
  let schemaStatus: SchemaCompatibilityStatus = "unavailable";

  try {
    migration = await env.DB.prepare(
      "SELECT id, name, applied_at FROM d1_migrations ORDER BY id DESC LIMIT 1"
    ).first<AppliedMigration>();
    if (migration?.id === schemaCompatibility.requiredMigrationId &&
      migration.name === schemaCompatibility.requiredMigrationName) {
      schemaStatus = "current";
    } else if (migration && migration.id < schemaCompatibility.requiredMigrationId) {
      schemaStatus = "migration_required";
    } else if (migration) {
      schemaStatus = "application_upgrade_required";
    }
  } catch {
    schemaStatus = "unavailable";
  }

  const metadata = env.CF_VERSION_METADATA;
  return {
    applicationRelease: schemaCompatibility.applicationRelease,
    environment: env.ENVIRONMENT,
    domain: env.APP_DOMAIN,
    worker: {
      versionId: metadata?.id ?? "local-development",
      tag: metadata?.tag ?? null,
      createdAt: metadata?.timestamp ?? null,
    },
    schema: {
      status: schemaStatus,
      compatible: schemaStatus === "current",
      appliedMigrationId: migration?.id ?? null,
      appliedMigrationName: migration?.name ?? null,
      appliedAt: migration?.applied_at ?? null,
      requiredMigrationId: schemaCompatibility.requiredMigrationId,
      requiredMigrationName: schemaCompatibility.requiredMigrationName,
    },
  };
}
