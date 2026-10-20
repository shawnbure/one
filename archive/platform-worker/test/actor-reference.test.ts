import { describe, expect, it } from "vitest";
import { publicActorReference, publicExecutionResult, publicExecutionRow } from "../src/actor-reference";

describe("browser-safe durable actor references", () => {
  it("describes tenant-scoped affinity without returning the Durable Object name", () => {
    const raw = "v2:tenant:customer-a:process-1:thread:northstar-renewal";
    const result = publicExecutionRow({
      id: "12345678-aaaa-bbbb-cccc-123456789abc",
      execution_profile: "conversation",
      instance_key: raw,
      status: "completed",
    });
    expect(result).toMatchObject({
      actor_ref: "actor-12345678aaaa",
      actor_type: "conversation",
      actor_isolation: "tenant_scoped_v2",
    });
    expect(result).not.toHaveProperty("instance_key");
    expect(JSON.stringify(result)).not.toContain("northstar-renewal");
    expect(JSON.stringify(result)).not.toContain("customer-a");
  });

  it("keeps instant and Workflow results explicitly non-durable", () => {
    expect(publicActorReference("execution-1", "instant", null)).toEqual({
      actorRef: null,
      actorType: null,
      actorIsolation: null,
    });
  });

  it("redacts synchronous execution results before returning them to a client", () => {
    const result = publicExecutionResult({
      executionId: "execution-sensitive",
      instanceKey: "process-1:entity:customer-secret",
      profile: "entity",
      status: "completed",
      startedAt: "2026-07-24T00:00:00Z",
    });
    expect(result).toMatchObject({
      actorRef: "actor-executionsen",
      actorType: "entity",
      actorIsolation: "legacy_guarded_v1",
    });
    expect(result).not.toHaveProperty("instanceKey");
    expect(JSON.stringify(result)).not.toContain("customer-secret");
  });
});
