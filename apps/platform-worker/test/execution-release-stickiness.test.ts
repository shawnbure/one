import { beforeEach, describe, expect, it, vi } from "vitest";

const actor = {
  bindTenant: vi.fn(),
  pinnedReleaseId: vi.fn(),
  hasPromptRelease: vi.fn(),
  installPromptBundle: vi.fn(),
  execute: vi.fn()
};

vi.mock("agents", () => ({ getAgentByName: vi.fn(async () => actor) }));
vi.mock("../src/repository", () => ({
  getBlueprint: vi.fn(),
  getBlueprintForRelease: vi.fn(),
  getPromptBundle: vi.fn()
}));

import { getBlueprint, getBlueprintForRelease } from "../src/repository";
import { executeRequest } from "../src/execution";

const base = {
  id: "process-1", name: "Customer Operations", description: "Test",
  executionProfile: "conversation" as const, modelProfile: "balanced", modelId: "@cf/model/new",
  promptReleaseId: "prompt-new", autonomy: "suggest" as const, status: "active" as const,
  tools: [], updatedAt: "now", operatingMode: "active" as const, activeReleaseId: "release-new",
  inputSchemaJson: null, outputSchemaJson: null, toolPolicies: []
};

function environment() {
  const writes: Array<{ sql: string; bindings: unknown[] }> = [];
  const DB = {
    prepare(sql: string) {
      let bindings: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { bindings = values; return statement; },
        async first() {
          if (sql.includes("tenant_operating_controls")) return { mode: "active" };
          return null;
        },
        async all() { return { results: [] }; },
        async run() { writes.push({ sql, bindings }); return { meta: { changes: 1 } }; }
      };
      return statement;
    }
  };
  return { env: { DB, PROCESS_AGENT: {} } as never, writes };
}

describe("durable actor release stickiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getBlueprint).mockResolvedValue(base);
    vi.mocked(getBlueprintForRelease).mockResolvedValue({
      ...base, modelId: "@cf/model/old", promptReleaseId: "prompt-old",
      autonomy: "observe", activeReleaseId: "release-old"
    });
    actor.pinnedReleaseId.mockResolvedValue("release-old");
  });

  it("keeps an existing conversation on its installed release after publication changes", async () => {
    const { env, writes } = environment();
    const result = await executeRequest(env, "tenant-1", {
      blueprintId: "process-1", threadId: "customer-42", input: "Continue this conversation"
    }, "execution-1");

    expect(actor.bindTenant).toHaveBeenCalledWith("tenant-1", "process-1");
    expect(getBlueprintForRelease).toHaveBeenCalledWith(env, "tenant-1", "process-1", "release-old");
    expect(result.status).toBe("completed");
    expect(writes.some(({ sql, bindings }) => sql.includes("INSERT OR IGNORE INTO executions") &&
      bindings.includes("release-old"))).toBe(true);
    expect(actor.execute).not.toHaveBeenCalled();
  });
});
