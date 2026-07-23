import { describe, expect, it } from "vitest";
import { createDraftRelease } from "../src/studio";

function environment() {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("LEFT JOIN tenant_model_policies")) return { enabled: 1 };
          if (sql.includes("SELECT execution_profile")) return { execution_profile: "instant" };
          if (sql.includes("COALESCE(MAX(version)")) return { version: 3 };
          return null;
        },
        async all() { return { results: [] }; },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      return Promise.all(statements.map((statement) => statement.run()));
    }
  };
  return { env: { DB } as never, writes };
}

describe("release model pinning", () => {
  it("snapshots the exact profile model into the immutable release", async () => {
    const { env, writes } = environment();
    await createDraftRelease(env, "tenant-1", "process-1", "builder-1", {
      systemPrompt: "Handle the request.",
      instructions: [],
      guardrails: [],
      modelProfile: "balanced",
      autonomy: "approve"
    });
    const release = writes.find(({ sql }) => sql.includes("INSERT INTO process_releases"));
    expect(release?.bindings).toContain("@cf/meta/llama-3.3-70b-instruct-fp8-fast");
    expect(release?.bindings.some((value) => typeof value === "string" &&
      value.includes('"modelId":"@cf/meta/llama-3.3-70b-instruct-fp8-fast"'))).toBe(true);
  });

  it("rejects an exact model outside the platform allowlist", async () => {
    const { env, writes } = environment();
    await expect(createDraftRelease(env, "tenant-1", "process-1", "builder-1", {
      systemPrompt: "Handle the request.",
      instructions: [],
      guardrails: [],
      modelProfile: "balanced",
      modelId: "@cf/example/unapproved",
      autonomy: "approve"
    })).rejects.toThrow("supported Cloudflare Workers AI model");
    expect(writes).toHaveLength(0);
  });

  it("rejects a model whose governed profile does not match", async () => {
    const { env, writes } = environment();
    await expect(createDraftRelease(env, "tenant-1", "process-1", "builder-1", {
      systemPrompt: "Handle the request.",
      instructions: [],
      guardrails: [],
      modelProfile: "fast",
      modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      autonomy: "approve"
    })).rejects.toThrow("requires the balanced model profile");
    expect(writes).toHaveLength(0);
  });

  it("permits an alternative Cloudflare-hosted model within its governed profile", async () => {
    const { env, writes } = environment();
    await createDraftRelease(env, "tenant-1", "process-1", "builder-1", {
      systemPrompt: "Analyze the bounded request.",
      instructions: [],
      guardrails: [],
      modelProfile: "reasoning",
      modelId: "@cf/qwen/qwen3-30b-a3b-fp8",
      autonomy: "suggest"
    });
    const release = writes.find(({ sql }) => sql.includes("INSERT INTO process_releases"));
    expect(release?.bindings).toContain("@cf/qwen/qwen3-30b-a3b-fp8");
  });
});
