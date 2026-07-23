import { describe, expect, it } from "vitest";
import { rollbackRelease } from "../src/studio";

function environment(target: Record<string, unknown> = {
  id: "release-old", version: 2, prompt_release_id: "prompt-old", model_profile: "balanced",
  autonomy: "approve", status: "retired", evaluation_status: "passing"
}) {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("SELECT active_release_id")) return { active_release_id: "release-current" };
          if (sql.includes("FROM process_releases WHERE id=?")) return target;
          return null;
        },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; },
        async all() { return { results: [] }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  return { env: { DB } as never, writes };
}

describe("governed release rollback", () => {
  it("restores the exact evaluated bundle and records activation evidence", async () => {
    const { env, writes } = environment();
    const result = await rollbackRelease(env, "tenant-1", "process-1", "release-old", "owner-1", {
      reason: "Current release increased incorrect routing.", confirmVersion: 2
    });
    expect(result).toMatchObject({
      releaseId: "release-old", previousReleaseId: "release-current", version: 2, status: "published"
    });
    expect(writes.some((write) => write.sql.includes("UPDATE agent_blueprints SET prompt_release_id") &&
      write.bindings.includes("prompt-old") && write.bindings.includes("release-current"))).toBe(true);
    expect(writes.some((write) => write.sql.includes("INSERT INTO release_activations") &&
      write.bindings.includes("Current release increased incorrect routing."))).toBe(true);
  });

  it("requires exact version confirmation and passing prior evaluation evidence", async () => {
    const wrongConfirmation = environment();
    await expect(rollbackRelease(wrongConfirmation.env, "tenant-1", "process-1", "release-old", "owner-1", {
      reason: "Restore known stable behavior.", confirmVersion: 3
    })).rejects.toThrow("Enter version 2");
    const failing = environment({
      id: "release-old", version: 2, prompt_release_id: "prompt-old", model_profile: "balanced",
      autonomy: "approve", status: "retired", evaluation_status: "failing"
    });
    await expect(rollbackRelease(failing.env, "tenant-1", "process-1", "release-old", "owner-1", {
      reason: "Restore known stable behavior.", confirmVersion: 2
    })).rejects.toThrow("passing evaluation");
    expect(failing.writes).toHaveLength(0);
  });
});
